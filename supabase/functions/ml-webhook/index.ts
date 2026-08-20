// deno-lint-ignore-file no-explicit-any
// Webhook ML: registra ventas pagadas y captura los gastos REALES de ML para la
// ganancia neta: comisión (marketplace_fee: %, costo fijo e IVA) y envío que paga el
// vendedor vía ML (0 en Flex/self_service — ese va manual; list_cost-cost en Mercado
// Envíos a su cargo). Modos: normal; { reprocess }; { backfill_fees, max }; { inspect_order }.
//
// v14 (2026-08-19): las ventas que entraban por una publicación DE CATÁLOGO creaban
// la orden SIN ÍTEMS — sin costo, sin ganancia y sin descontar stock (órdenes 249 y
// 282). Esas publicaciones las crea ML colgadas de una ficha nuestra y no están en
// ml_item_mapping. Ahora se resuelven por catalog_product_id, que es lo que ambas
// comparten. Modo nuevo { backfill_catalog_ids: true } para completar el dato.
//
// v12 (2026-08-04): si ML vendió MÁS unidades de las que RF Store tenía en stock, el
// descuento se clavaba en 0 en silencio. Ahora se avisa al admin: es la señal de que la
// publicación y el producto están desalineados (típico: stock cargado a mano en ML sobre
// un producto que en RF está en 0, o dos fichas distintas para el mismo artículo).
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

async function mlGet(path: string, token: string, extra: Record<string, string> = {}): Promise<any> {
  const r = await fetch(`${ML_API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...extra } });
  const t = await r.text();
  try { return { ok: r.ok, status: r.status, data: JSON.parse(t) }; } catch { return { ok: r.ok, status: r.status, data: { raw: t } }; }
}

// Comisión total que ML descuenta (incluye %, costo fijo e IVA).
function mlCommission(order: any): number {
  let c = 0;
  for (const p of order?.payments ?? []) c += Number(p?.marketplace_fee) || 0;
  if (c === 0) for (const oi of order?.order_items ?? []) c += (Number(oi?.sale_fee) || 0) * (Number(oi?.quantity) || 1);
  return c;
}

// Envío que paga el vendedor vía ML. 0 en Flex/self_service (lo maneja por su cuenta).
async function mlShipping(order: any, token: string): Promise<number> {
  const shipId = order?.shipping?.id;
  if (!shipId) return 0;
  const sr = await mlGet(`/shipments/${shipId}`, token, { 'x-format-new': 'true' });
  if (!sr.ok) return 0;
  const s = sr.data ?? {};
  const type = s?.logistic?.type ?? s?.logistic_type ?? '';
  if (type === 'self_service') return 0;
  const lt = s?.lead_time ?? {};
  const listCost = Number(lt.list_cost ?? s?.shipping_option?.list_cost) || 0;
  const buyerCost = Number(lt.cost ?? s?.shipping_option?.cost) || 0;
  return Math.max(0, listCost - buyerCost);
}

/**
 * Encuentra el producto de RF que corresponde a una publicación de ML.
 *
 * Camino normal: la publicación está en ml_item_mapping.
 *
 * Camino de CATÁLOGO: las publicaciones de catálogo las crea ML colgadas de una
 * ficha nuestra y NO están en el mapeo, así que hasta ahora esas ventas entraban
 * sin ítems — sin costo, sin ganancia y sin descontar stock (órdenes 249 y 282).
 * El vínculo entre las dos es `catalog_product_id`: ambas apuntan al mismo
 * producto de catálogo. Se resuelve por ahí y, de paso, se guarda el dato en la
 * ficha padre para que la próxima venta salga por el camino normal.
 */
async function resolverMapeo(
  mlItemId: string,
  token: string
): Promise<{ variant_id: string; product_id: string } | null> {
  const { data: directo } = await supabase
    .from('ml_item_mapping')
    .select('variant_id, product_id')
    .eq('ml_item_id', mlItemId)
    .maybeSingle();
  if (directo?.variant_id) return directo as any;

  // No está mapeada: puede ser de catálogo.
  const r = await mlGet(`/items/${mlItemId}`, token);
  const catalogId = r.ok ? (r.data?.catalog_product_id ?? null) : null;
  if (!catalogId) return null;

  // 1) ¿Alguna ficha nuestra ya tiene guardado ese catalog_product_id?
  const { data: porCatalogo } = await supabase
    .from('ml_item_mapping')
    .select('variant_id, product_id, ml_item_id, status')
    .eq('catalog_product_id', catalogId)
    .neq('ml_item_id', mlItemId)
    // La activa manda; si no hay, sirve cualquiera: el producto de RF es el mismo.
    .order('status', { ascending: true })
    .limit(1);
  if (porCatalogo && porCatalogo.length > 0 && porCatalogo[0].variant_id) {
    console.log(`[ml-webhook] ${mlItemId} resuelta por catálogo ${catalogId} → ${porCatalogo[0].ml_item_id}`);
    return porCatalogo[0] as any;
  }

  // 2) Todavía sin backfill: preguntamos a ML cuáles de nuestras publicaciones
  //    comparten ese producto de catálogo. Es el caso raro y se autocorrige,
  //    porque abajo guardamos el dato.
  const s = await mlGet(`/sites/MLU/search?catalog_product_id=${catalogId}&seller_id=${r.data?.seller_id ?? ''}`, token);
  const candidatas: string[] = (s.ok ? (s.data?.results ?? []) : [])
    .map((x: any) => x?.id)
    .filter((id: string) => id && id !== mlItemId);
  if (candidatas.length === 0) return null;

  const { data: porCandidata } = await supabase
    .from('ml_item_mapping')
    .select('variant_id, product_id, ml_item_id')
    .in('ml_item_id', candidatas)
    .limit(1);
  if (!porCandidata || porCandidata.length === 0 || !porCandidata[0].variant_id) return null;

  // Autocuración: la próxima venta de catálogo de este producto ya no necesita
  // ninguna llamada a la API.
  await supabase.from('ml_item_mapping')
    .update({ catalog_product_id: catalogId })
    .eq('ml_item_id', porCandidata[0].ml_item_id);

  console.log(`[ml-webhook] ${mlItemId} resuelta vía búsqueda de catálogo ${catalogId}`);
  return porCandidata[0] as any;
}

/**
 * Completa catalog_product_id en el mapeo. Usa el multiget de ML (20 ids por
 * llamada) para no hacer 1.548 requests sueltos.
 * Modo: { backfill_catalog_ids: true, max: 400 }
 */
async function backfillCatalogIds(max: number, token: string): Promise<{ revisados: number; con_catalogo: number; errores: number }> {
  const { data: filas } = await supabase
    .from('ml_item_mapping')
    .select('ml_item_id')
    .is('catalog_product_id', null)
    .neq('status', 'closed')
    .limit(max);
  const ids = (filas ?? []).map((f: any) => f.ml_item_id).filter(Boolean);
  let conCatalogo = 0, errores = 0;

  for (let i = 0; i < ids.length; i += 20) {
    const lote = ids.slice(i, i + 20);
    const r = await mlGet(`/items?ids=${lote.join(',')}&attributes=id,catalog_product_id`, token);
    if (!r.ok) { errores += lote.length; continue; }
    for (const entry of r.data ?? []) {
      const body = entry?.body ?? entry;
      const id = body?.id;
      const cat = body?.catalog_product_id ?? null;
      if (!id || !cat) continue;
      await supabase.from('ml_item_mapping').update({ catalog_product_id: cat }).eq('ml_item_id', id);
      conCatalogo++;
    }
  }
  return { revisados: ids.length, con_catalogo: conCatalogo, errores };
}

async function notifyAdminOnce(type: string, mlOrderId: string, payload: Record<string, unknown>) {
  const { data: existing } = await supabase.from('admin_notifications').select('id').eq('type', type).is('read_at', null).filter('payload->>ml_order_id', 'eq', mlOrderId).limit(1).maybeSingle();
  if (existing) return;
  await supabase.from('admin_notifications').insert({ type, payload: { ml_order_id: mlOrderId, ...payload } });
}

async function processOrderV2(resource: string, token: string): Promise<{ ok: boolean; error?: string }> {
  const mlOrderIdFromResource = resource.split('/').pop() ?? resource;
  const orderResp = await mlGet(resource, token);
  if (!orderResp.ok) {
    await notifyAdminOnce('ml_order_unfetchable', mlOrderIdFromResource, { resource, http_status: orderResp.status, detail: orderResp.data, message: 'Llegó una venta de Mercado Libre pero no pudimos leer el detalle de la orden. Revisá la venta en ML y verificá el stock manualmente.' });
    return { ok: false, error: `fetch_order: ${orderResp.status}` };
  }
  const order = orderResp.data;
  if (!order?.id) return { ok: false, error: 'no_order_id' };
  const mlOrderId = String(order.id);
  if (order.status !== 'paid' && order.status !== 'confirmed') return { ok: true };

  const { data: existing } = await supabase.from('orders').select('id').eq('ml_order_id', mlOrderId).maybeSingle();
  if (existing) return { ok: true };

  const { data: rateRow } = await supabase.from('app_settings').select('value').eq('key', 'usd_uyu_rate_cache').maybeSingle();
  const usdRate = Number((rateRow?.value as any)?.rate) || 0;
  const toUsd = (amount: number, currency?: string) => currency === 'UYU' && usdRate > 0 ? Math.round((amount / usdRate) * 100) / 100 : amount;

  const resolved: { variant_id: string; qty: number; unitPrice: number; cost: number; title: string }[] = [];
  const unmapped: { ml_item_id: string; title: string; qty: number }[] = [];
  for (const oi of order.order_items ?? []) {
    const mlItemId = oi?.item?.id;
    const qty = Number(oi?.quantity) || 0;
    const unitPrice = toUsd(Number(oi?.unit_price) || 0, oi?.currency_id ?? order.currency_id);
    const title = oi?.item?.title ?? mlItemId ?? 'item';
    if (!mlItemId || !qty) continue;
    const mapping = await resolverMapeo(mlItemId, token);
    if (!mapping?.variant_id) { unmapped.push({ ml_item_id: mlItemId, title, qty }); continue; }
    const { data: prod } = await supabase.from('products').select('price_usd').eq('id', mapping.product_id).maybeSingle();
    const cost = Number(prod?.price_usd) || 0;
    resolved.push({ variant_id: mapping.variant_id, qty, unitPrice, cost, title });
  }

  const total = toUsd(Number(order.total_amount ?? 0), order.currency_id);
  const mlCurrency = order.currency_id ?? 'USD';
  const totalOriginal = Number(order.total_amount ?? 0);
  const commissionUsd = toUsd(mlCommission(order), order.currency_id);
  const shippingUsd = toUsd(await mlShipping(order, token), order.currency_id);

  const { data: inserted, error: insErr } = await supabase.from('orders').insert({
    // v13: una venta de ML ya viene COBRADA por ML, no espera confirmación de
    // nadie, así que entra directamente como 'Concretado'. Antes entraba con
    // 'pagado', un estado que el selector del panel no ofrece: el <select> caía
    // en la primera opción y las 130 ventas de ML figuraban como "Cotización".
    customer_id: null, address_id: null, total_amount: total, status: 'Concretado', payment_method: null, payment_status: 'paid', channel: 'ml', ml_order_id: mlOrderId, ml_pack_id: order.pack_id ? String(order.pack_id) : null, ml_currency: mlCurrency, total_original: totalOriginal, fx_rate: mlCurrency === 'UYU' && usdRate > 0 ? usdRate : 1, ml_commission_usd: commissionUsd, ml_shipping_cost_usd: shippingUsd, paid_at: order.date_closed ?? new Date().toISOString(),
  } as any).select('id').single();
  if (insErr || !inserted) { console.warn('orders insert ml_order:', insErr?.message); return { ok: false, error: `insert_order: ${insErr?.message ?? 'no_id'}` }; }
  const orderId = inserted.id;

  // Si RF Store tenía MENOS stock del que se vendió en ML, el descuento se clavaba en 0 en
  // silencio y nadie se enteraba de que las dos puntas estaban desalineadas (caso real
  // 2026-08-04: MLU694332351 con stock cargado a mano en ML sobre un producto en 0 en RF).
  const shortfalls: { title: string; vendido: number; habia_en_rf: number }[] = [];
  for (const it of resolved) {
    await supabase.from('order_items').insert({ order_id: orderId, variant_id: it.variant_id, quantity: it.qty, price: it.unitPrice, cost_usd: it.cost });
    const { data: variant } = await supabase.from('variants').select('stock').eq('id', it.variant_id).single();
    if (variant) {
      const before = Number(variant.stock);
      if (before < it.qty) shortfalls.push({ title: it.title, vendido: it.qty, habia_en_rf: before });
      await supabase.from('variants').update({ stock: Math.max(0, before - it.qty) }).eq('id', it.variant_id);
    }
  }

  const message = unmapped.length > 0
    ? `Venta en Mercado Libre registrada, pero ${unmapped.length} item(s) no están vinculados a un producto de RF Store: revisá el stock a mano.`
    : shortfalls.length > 0
      ? `Venta en Mercado Libre: ML vendió más unidades de las que RF Store tenía (${shortfalls.map(s => `${s.title}: vendió ${s.vendido}, había ${s.habia_en_rf}`).join('; ')}). La publicación y el producto están desalineados: revisá el stock.`
      : 'Venta en Mercado Libre: stock descontado automáticamente.';

  await notifyAdminOnce('ml_sale', mlOrderId, { total, items: resolved.map(r => ({ title: r.title, qty: r.qty })), unmapped, shortfalls, needs_manual_stock: unmapped.length > 0 || shortfalls.length > 0, message });
  return { ok: true };
}

// Backfill de comisión/envío: SOLO completa órdenes ML que están en 0 (las que entraron
// antes de que ML calculara el marketplace_fee). NUNCA pisa un valor ya cargado (manual
// o automático) ni lo vuelve a 0. Respeta packs: si algún hermano del pack ya tiene
// comisión, no toca el resto (para no duplicar el total consolidado a mano).
async function backfillFees(max: number, token: string): Promise<{ updated: number; errors: number; skipped: number }> {
  const { data: rows } = await supabase.from('orders')
    .select('id, ml_order_id, ml_currency, fx_rate, ml_pack_id')
    .eq('channel', 'ml').not('ml_order_id', 'is', null)
    .or('ml_commission_usd.is.null,ml_commission_usd.eq.0')
    .order('id', { ascending: false }).limit(max);
  let updated = 0, errors = 0, skipped = 0;
  for (const row of rows ?? []) {
    try {
      if ((row as any).ml_pack_id) {
        const { data: pack } = await supabase.from('orders').select('ml_commission_usd').eq('ml_pack_id', (row as any).ml_pack_id);
        if ((pack ?? []).some((p: any) => Number(p.ml_commission_usd) > 0)) { skipped++; continue; }
      }
      const r = await mlGet(`/orders/${(row as any).ml_order_id}`, token);
      if (!r.ok) { errors++; continue; }
      const order = r.data;
      const fx = Number((row as any).fx_rate) || 1;
      const isUyu = ((row as any).ml_currency ?? order.currency_id) === 'UYU';
      const toUsd = (amount: number) => isUyu && fx > 0 ? Math.round((amount / fx) * 100) / 100 : amount;
      const newComm = toUsd(mlCommission(order));
      const newShip = toUsd(await mlShipping(order, token));
      const upd: any = {};
      if (newComm > 0) upd.ml_commission_usd = newComm;
      if (newShip > 0) upd.ml_shipping_cost_usd = newShip;
      if (Object.keys(upd).length > 0) { await supabase.from('orders').update(upd).eq('id', (row as any).id); updated++; }
      else skipped++;
    } catch { errors++; }
  }
  return { updated, errors, skipped };
}

async function processItemNotification(resource: string, token: string): Promise<{ ok: boolean; error?: string }> {
  const r = await mlGet(resource, token);
  if (!r.ok) return { ok: false, error: `fetch_item: ${r.status}` };
  const item = r.data;
  if (!item?.id) return { ok: false, error: 'no_item_id' };
  const { data: mapping } = await supabase.from('ml_item_mapping').select('id, status, last_known_stock').eq('ml_item_id', item.id).maybeSingle();
  if (!mapping) return { ok: true };
  const newStatus = item.status === 'active' ? 'active' : item.status === 'paused' ? 'paused' : item.status === 'closed' ? 'closed' : mapping.status;
  if (newStatus !== mapping.status) { await supabase.from('ml_item_mapping').update({ status: newStatus, last_synced_at: new Date().toISOString() }).eq('id', mapping.id); }
  return { ok: true };
}

async function processEvent(eventId: number, event: any) {
  try {
    const token = await getToken();
    let result: { ok: boolean; error?: string } = { ok: true };
    if (event.topic === 'orders_v2') result = await processOrderV2(event.resource, token);
    else if (event.topic === 'items') result = await processItemNotification(event.resource, token);
    await supabase.from('ml_webhook_events').update({ processing_status: result.ok ? 'done' : 'error', processed_at: new Date().toISOString(), error: result.error ?? null }).eq('id', eventId);
  } catch (e: any) {
    await supabase.from('ml_webhook_events').update({ processing_status: 'error', processed_at: new Date().toISOString(), error: e?.message }).eq('id', eventId);
  }
}

async function reprocessErrors(max = 25, sinceHours = 72): Promise<{ reprocessed: number }> {
  const sinceIso = new Date(Date.now() - sinceHours * 3600 * 1000).toISOString();
  const { data: rows } = await supabase.from('ml_webhook_events').select('id, payload, topic, resource, processing_status').eq('topic', 'orders_v2').neq('processing_status', 'done').gte('received_at', sinceIso).order('received_at', { ascending: true }).limit(max);
  let n = 0;
  for (const row of rows ?? []) {
    const event = (row.payload && (row.payload as any).resource) ? row.payload : { topic: row.topic, resource: row.resource };
    await processEvent(row.id as number, event); n++;
  }
  return { reprocessed: n };
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('ok', { status: 200 });
  let body: any = {};
  try { body = await req.json(); } catch { return new Response('ok', { status: 200 }); }

  if (body?.reprocess === true) {
    const res = await reprocessErrors(Number(body.max) || 25, Number(body.since_hours) || 72);
    return new Response(JSON.stringify(res), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (body?.backfill_fees === true) {
    const token = await getToken();
    const res = await backfillFees(Number(body.max) || 50, token);
    return new Response(JSON.stringify(res), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (body?.backfill_catalog_ids === true) {
    const token = await getToken();
    const res = await backfillCatalogIds(Number(body.max) || 400, token);
    return new Response(JSON.stringify(res), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (body?.inspect_order) {
    try {
      const token = await getToken();
      const r = await mlGet(`/orders/${body.inspect_order}`, token);
      const o: any = r.data ?? {};
      const commission = mlCommission(o);
      const shipping = await mlShipping(o, token);
      return new Response(JSON.stringify({ ok: r.ok, http: r.status, currency_id: o.currency_id, total_amount: o.total_amount, status: o.status, commission, shipping, net: Number(o.total_amount ?? 0) - commission - shipping }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (e: any) { return new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
  }

  const { data: row } = await supabase.from('ml_webhook_events').insert({ topic: body.topic ?? 'unknown', resource: body.resource ?? null, application_id: body.application_id?.toString() ?? null, user_id: body.user_id?.toString() ?? null, sent_at: body.sent ?? null, payload: body, processing_status: 'pending' }).select('id').single();
  if (row?.id) { /* @ts-ignore */ EdgeRuntime.waitUntil(processEvent(row.id, body)); }
  return new Response('ok', { status: 200 });
});
