// deno-lint-ignore-file no-explicit-any
// Recibe notifications de ML. Responde 200 inmediato y procesa async.
// Tipos de topic: orders_v2, items, questions, messages, shipments.
//
// Cuando entra una venta ML pagada:
//   1) busca cada item vendido en ml_item_mapping (ml_item_id -> variant de RF)
//   2) descuenta variants.stock de ESE variant (dispara trigger variants_stock_to_ml
//      que sincroniza el stock nuevo de vuelta a la publicación de ML)
//   3) registra la orden en `orders` con channel='ml' + ml_order_id, y sus order_items
//   4) crea una notificación admin 'ml_sale' con el resumen de la venta
//
// Modos de invocación:
//   1) Notificación de ML  -> body { topic, resource, ... }  (lo normal)
//   2) Reproceso (cron)    -> body { reprocess: true, max?, since_hours? }
//      Reintenta eventos orders_v2 en error/pending. Idempotente (dedup por
//      orders.ml_order_id). Se auto-cura cuando ML/reconexión quedan OK.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ML_CLIENT_ID = Deno.env.get('ML_CLIENT_ID')!;
const ML_CLIENT_SECRET = Deno.env.get('ML_CLIENT_SECRET')!;
const ML_API_BASE = 'https://api.mercadolibre.com';
const ML_TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

async function getToken(): Promise<string> {
  const { data: cred } = await supabase.from('ml_credentials').select('*').order('id', { ascending: false }).limit(1).maybeSingle();
  if (!cred) throw new Error('no_creds');
  if (new Date(cred.expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
    const r = await fetch(ML_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: ML_CLIENT_ID, client_secret: ML_CLIENT_SECRET, refresh_token: cred.refresh_token }).toString() });
    const data: any = await r.json();
    if (!r.ok) throw new Error(`refresh: ${JSON.stringify(data)}`);
    const exp = new Date(Date.now() + (Number(data.expires_in) - 30) * 1000).toISOString();
    await supabase.from('ml_credentials').update({ access_token: data.access_token, refresh_token: data.refresh_token ?? cred.refresh_token, expires_at: exp }).eq('id', cred.id);
    return data.access_token;
  }
  return cred.access_token;
}

async function mlGet(path: string, token: string): Promise<any> {
  const r = await fetch(`${ML_API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  const t = await r.text();
  try { return { ok: r.ok, status: r.status, data: JSON.parse(t) }; } catch { return { ok: r.ok, status: r.status, data: { raw: t } }; }
}

// Crea una notificación admin si no hay ya una sin leer para la misma orden+tipo.
async function notifyAdminOnce(type: string, mlOrderId: string, payload: Record<string, unknown>) {
  const { data: existing } = await supabase
    .from('admin_notifications')
    .select('id')
    .eq('type', type)
    .is('read_at', null)
    .filter('payload->>ml_order_id', 'eq', mlOrderId)
    .limit(1)
    .maybeSingle();
  if (existing) return;
  await supabase.from('admin_notifications').insert({ type, payload: { ml_order_id: mlOrderId, ...payload } });
}

async function processOrderV2(resource: string, token: string): Promise<{ ok: boolean; error?: string }> {
  // resource ej: '/orders/2000001234567890'
  const mlOrderIdFromResource = resource.split('/').pop() ?? resource;
  const orderResp = await mlGet(resource, token);

  if (!orderResp.ok) {
    // No pudimos leer la orden (ej: 403 PolicyAgent si falta el permiso "Ventas y envíos",
    // o si el token quedó en otra cuenta). No perdemos la venta: avisamos al admin (una vez)
    // y dejamos el evento en 'error' para que el cron de reproceso lo reintente.
    await notifyAdminOnce('ml_order_unfetchable', mlOrderIdFromResource, {
      resource,
      http_status: orderResp.status,
      detail: orderResp.data,
      message: 'Llegó una venta de Mercado Libre pero no pudimos leer el detalle de la orden. Revisá la venta en ML y verificá el stock manualmente.',
    });
    return { ok: false, error: `fetch_order: ${orderResp.status}` };
  }

  const order = orderResp.data;
  if (!order?.id) return { ok: false, error: 'no_order_id' };
  const mlOrderId = String(order.id);

  // Solo procesar ordenes con pago aprobado (otros estados son intermedios o cancelados)
  if (order.status !== 'paid' && order.status !== 'confirmed') {
    return { ok: true }; // skip: no es venta efectiva (incluye cancelled/payment_required)
  }

  // Idempotencia: si ya la registramos, no repetir (no re-descontar stock)
  const { data: existing } = await supabase.from('orders').select('id').eq('ml_order_id', mlOrderId).maybeSingle();
  if (existing) return { ok: true };

  // Resolver cada item vendido a su variant de RF Store
  const resolved: { variant_id: string; qty: number; unitPrice: number; title: string }[] = [];
  const unmapped: { ml_item_id: string; title: string; qty: number }[] = [];
  for (const oi of order.order_items ?? []) {
    const mlItemId = oi?.item?.id;
    const qty = Number(oi?.quantity) || 0;
    const unitPrice = Number(oi?.unit_price) || 0;
    const title = oi?.item?.title ?? mlItemId ?? 'item';
    if (!mlItemId || !qty) continue;
    const { data: mapping } = await supabase.from('ml_item_mapping').select('variant_id').eq('ml_item_id', mlItemId).maybeSingle();
    if (!mapping?.variant_id) { unmapped.push({ ml_item_id: mlItemId, title, qty }); continue; }
    resolved.push({ variant_id: mapping.variant_id, qty, unitPrice, title });
  }

  // Registrar la orden en rfstore con canal explícito (sin abusar de mp_payment_id).
  const total = Number(order.total_amount ?? 0);
  const { data: inserted, error: insErr } = await supabase.from('orders').insert({
    customer_id: null,
    address_id: null,
    total_amount: total,
    status: 'pagado',
    payment_method: null,
    payment_status: 'paid',
    channel: 'ml',
    ml_order_id: mlOrderId,
    ml_pack_id: order.pack_id ? String(order.pack_id) : null,
    paid_at: order.date_closed ?? new Date().toISOString(),
  } as any).select('id').single();
  if (insErr || !inserted) {
    console.warn('orders insert ml_order:', insErr?.message);
    return { ok: false, error: `insert_order: ${insErr?.message ?? 'no_id'}` };
  }
  const orderId = inserted.id;

  // Por cada item mapeado: registrar order_item y descontar stock del variant
  // (el descuento dispara el trigger que sincroniza el stock a la publicación ML).
  for (const it of resolved) {
    await supabase.from('order_items').insert({ order_id: orderId, variant_id: it.variant_id, quantity: it.qty, price: it.unitPrice });
    const { data: variant } = await supabase.from('variants').select('stock').eq('id', it.variant_id).single();
    if (variant) {
      const newStock = Math.max(0, Number(variant.stock) - it.qty);
      await supabase.from('variants').update({ stock: newStock }).eq('id', it.variant_id);
    }
  }

  // Notificar la venta al admin (con resumen). Si hubo items sin vínculo, se marcan
  // para revisión manual del stock.
  await notifyAdminOnce('ml_sale', mlOrderId, {
    total,
    items: resolved.map(r => ({ title: r.title, qty: r.qty })),
    unmapped,
    needs_manual_stock: unmapped.length > 0,
    message: unmapped.length > 0
      ? `Venta en Mercado Libre registrada, pero ${unmapped.length} item(s) no están vinculados a un producto de RF Store: revisá el stock a mano.`
      : 'Venta en Mercado Libre: stock descontado automáticamente.',
  });

  return { ok: true };
}

async function processItemNotification(resource: string, token: string): Promise<{ ok: boolean; error?: string }> {
  // resource ej: '/items/MLU1418177938'
  const r = await mlGet(resource, token);
  if (!r.ok) return { ok: false, error: `fetch_item: ${r.status}` };
  const item = r.data;
  if (!item?.id) return { ok: false, error: 'no_item_id' };
  const { data: mapping } = await supabase.from('ml_item_mapping').select('id, status, last_known_stock').eq('ml_item_id', item.id).maybeSingle();
  if (!mapping) return { ok: true }; // no nos importa
  const newStatus = item.status === 'active' ? 'active' : item.status === 'paused' ? 'paused' : item.status === 'closed' ? 'closed' : mapping.status;
  if (newStatus !== mapping.status) {
    await supabase.from('ml_item_mapping').update({ status: newStatus, last_synced_at: new Date().toISOString() }).eq('id', mapping.id);
  }
  return { ok: true };
}

async function processEvent(eventId: number, event: any) {
  try {
    const token = await getToken();
    const topic = event.topic;
    const resource = event.resource;

    let result: { ok: boolean; error?: string } = { ok: true };
    if (topic === 'orders_v2') result = await processOrderV2(resource, token);
    else if (topic === 'items') result = await processItemNotification(resource, token);
    else result = { ok: true }; // questions/messages/shipments/otros: solo log

    await supabase.from('ml_webhook_events').update({
      processing_status: result.ok ? 'done' : 'error',
      processed_at: new Date().toISOString(),
      error: result.error ?? null,
    }).eq('id', eventId);
  } catch (e: any) {
    await supabase.from('ml_webhook_events').update({
      processing_status: 'error', processed_at: new Date().toISOString(), error: e?.message,
    }).eq('id', eventId);
  }
}

// Reintenta eventos orders_v2 que quedaron sin procesar. Idempotente.
async function reprocessErrors(max = 25, sinceHours = 72): Promise<{ reprocessed: number }> {
  const sinceIso = new Date(Date.now() - sinceHours * 3600 * 1000).toISOString();
  const { data: rows } = await supabase
    .from('ml_webhook_events')
    .select('id, payload, topic, resource, processing_status')
    .eq('topic', 'orders_v2')
    .neq('processing_status', 'done')
    .gte('received_at', sinceIso)
    .order('received_at', { ascending: true })
    .limit(max);
  let n = 0;
  for (const row of rows ?? []) {
    const event = (row.payload && (row.payload as any).resource) ? row.payload : { topic: row.topic, resource: row.resource };
    await processEvent(row.id as number, event);
    n++;
  }
  return { reprocessed: n };
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('ok', { status: 200 });
  let body: any = {};
  try { body = await req.json(); } catch { return new Response('ok', { status: 200 }); }

  // Modo reproceso (lo dispara el cron). No registra evento nuevo.
  if (body?.reprocess === true) {
    const res = await reprocessErrors(Number(body.max) || 25, Number(body.since_hours) || 72);
    return new Response(JSON.stringify(res), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // Notificación normal de ML: registrar inmediatamente y devolver 200.
  const { data: row } = await supabase.from('ml_webhook_events').insert({
    topic: body.topic ?? 'unknown',
    resource: body.resource ?? null,
    application_id: body.application_id?.toString() ?? null,
    user_id: body.user_id?.toString() ?? null,
    sent_at: body.sent ?? null,
    payload: body,
    processing_status: 'pending',
  }).select('id').single();

  if (row?.id) {
    // @ts-ignore EdgeRuntime
    EdgeRuntime.waitUntil(processEvent(row.id, body));
  }

  return new Response('ok', { status: 200 });
});
