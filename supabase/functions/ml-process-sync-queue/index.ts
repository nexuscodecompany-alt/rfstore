// deno-lint-ignore-file no-explicit-any
// Procesa pending de ml_sync_queue: update_stock, update_price, pause, reactivate, close
// REACTIVACION (2026-06-17, refinada): solo se reactiva una publicacion pausada si
// ML mismo indica que la pauso por STOCK (sub_status incluye 'out_of_stock') y NO
// tiene flags de moderacion. Gateado por app_settings.ml_auto_reactivate_enabled.
//
// v6 (2026-06-24):
//  - update_price: si ML tiene el item MODERADO (under_review / forbidden / banned / etc.)
//    el precio esta BLOQUEADO ('item.price.not_modifiable') -> se SALTEA y se loguea
//    'skipped_moderated' (no error, no reintento infinito).
//  - se loguea el CUERPO del error de ML (no solo el status).
//  - reintentos con backoff para errores transitorios (red / 5xx / 429); los 4xx quedan en error.
//
// v7 (2026-06-26):
//  - update_price: ML SI permite cambiar el currency_id de una publicacion activa (verificado
//    empiricamente con PUT /items -> 200). La logica anterior que forzaba la moneda actual era
//    incorrecta y hacia que bajar el umbral USD no tuviera efecto sobre lo ya publicado.
//    Ahora se empuja SIEMPRE la moneda OBJETIVO (la que dicta el umbral). Si ML rechaza el
//    cambio de moneda (algunos items con ventas pueden bloquearlo), se hace FALLBACK a la
//    moneda actual del item convirtiendo el precio con el dolar, para no fallar la operacion.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const ML_CLIENT_ID = Deno.env.get('ML_CLIENT_ID')!;
const ML_CLIENT_SECRET = Deno.env.get('ML_CLIENT_SECRET')!;
const ML_TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';
const ML_API_BASE = 'https://api.mercadolibre.com';
const MAX_PER_RUN = 20;
const MAX_ATTEMPTS = 3;
// sub_status de ML que indican moderacion/infraccion/baneo: NUNCA editar / reactivar.
const MODERATION_SUBSTATUS = ['under_review', 'banned', 'forbidden', 'freezed', 'deleted', 'suspended', 'waiting_for_patch'];

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

async function getToken(): Promise<string> {
  const { data: cred } = await supabase.from('ml_credentials').select('*').order('id', { ascending: false }).limit(1).maybeSingle();
  if (!cred) throw new Error('no_ml_credentials');
  if (new Date(cred.expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
    const resp = await fetch(ML_TOKEN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: ML_CLIENT_ID, client_secret: ML_CLIENT_SECRET, refresh_token: cred.refresh_token }).toString(),
    });
    const data: any = await resp.json();
    if (!resp.ok) throw new Error(`refresh: ${JSON.stringify(data)}`);
    const exp = new Date(Date.now() + (Number(data.expires_in) - 30) * 1000).toISOString();
    await supabase.from('ml_credentials').update({ access_token: data.access_token, refresh_token: data.refresh_token ?? cred.refresh_token, expires_at: exp }).eq('id', cred.id);
    return data.access_token;
  }
  return cred.access_token;
}

let _fxCache: { rate: number; at: number } | null = null;
async function getFxRate(): Promise<number> {
  if (_fxCache && Date.now() - _fxCache.at < 5 * 60 * 1000) return _fxCache.rate;
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/get-fx-rate`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } });
  if (!resp.ok) throw new Error(`fx_rate_fetch_failed: ${resp.status}`);
  const j: any = await resp.json();
  const rate = Number(j.rate);
  if (!rate || rate <= 0) throw new Error('invalid_fx_rate');
  _fxCache = { rate, at: Date.now() };
  return rate;
}

async function mlReq(path: string, method: string, token: string, body?: any): Promise<{ ok: boolean; status: number; data: any }> {
  const r = await fetch(`${ML_API_BASE}${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let d: any = {};
  try { d = JSON.parse(t); } catch { d = { raw: t }; }
  return { ok: r.ok, status: r.status, data: d };
}

function isRetryable(status: number): boolean {
  return status === 0 || status === 429 || status >= 500;
}
function isModerated(st: any, sub: string[]): boolean {
  return MODERATION_SUBSTATUS.some(f => sub.includes(f)) || st === 'under_review' || st === 'closed' || st === 'inactive';
}

async function logSync(row: any): Promise<void> {
  try { await supabase.from('ml_sync_log').insert(row); } catch (_e) { /* log best-effort */ }
}

async function processItem(item: any, token: string, settings: Map<string, any>): Promise<{ ok: boolean; error?: string; retryable?: boolean }> {
  const { data: mapping } = await supabase.from('ml_item_mapping').select('id, ml_item_id, status, last_known_stock, auto_paused_stock, product_id').eq('variant_id', item.variant_id).in('status', ['active', 'paused']).maybeSingle();
  if (!mapping) return { ok: false, error: 'no_active_mapping' };
  const mlItemId = mapping.ml_item_id;
  const source = (item.payload as any)?.source ?? null;

  const reactivateEnabled = settings.get('ml_auto_reactivate_enabled') === true;

  let externalCode: string | null = null;
  if (mapping.product_id) {
    const { data: prod } = await supabase.from('products').select('external_code').eq('id', mapping.product_id).maybeSingle();
    externalCode = prod?.external_code ?? null;
  }
  const baseLog = { ml_item_id: mlItemId, variant_id: item.variant_id, external_code: externalCode, operation: item.operation, old_ml_status: mapping.status, source };

  const threshold = Number(settings.get('ml_stock_threshold') ?? 0);

  switch (item.operation) {
    case 'update_stock': {
      const { data: v } = await supabase.from('variants').select('stock').eq('id', item.variant_id).single();
      if (!v) return { ok: false, error: 'variant_not_found' };
      const stock = Number(v.stock);

      if (stock <= threshold) {
        if (mapping.status === 'paused') {
          await supabase.from('ml_item_mapping').update({ auto_paused_stock: true, last_known_stock: stock, last_synced_at: new Date().toISOString() }).eq('id', mapping.id);
          await logSync({ ...baseLog, action: 'already_paused', new_ml_status: 'paused', stock, result: 'ok' });
          return { ok: true };
        }
        const r = await mlReq(`/items/${mlItemId}`, 'PUT', token, { status: 'paused' });
        if (!r.ok) { await logSync({ ...baseLog, action: 'pause', new_ml_status: mapping.status, stock, result: 'error', error: `pause: ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}` }); return { ok: false, error: `pause: ${r.status}`, retryable: isRetryable(r.status) }; }
        await supabase.from('ml_item_mapping').update({ status: 'paused', auto_paused_stock: true, last_known_stock: stock, last_synced_at: new Date().toISOString() }).eq('id', mapping.id);
        await logSync({ ...baseLog, action: 'paused', new_ml_status: 'paused', stock, result: 'ok' });
        return { ok: true };
      }

      if (mapping.status === 'paused') {
        if (!reactivateEnabled) {
          await supabase.from('ml_item_mapping').update({ last_known_stock: stock, last_synced_at: new Date().toISOString() }).eq('id', mapping.id);
          await logSync({ ...baseLog, action: 'skipped_reactivate_disabled', new_ml_status: 'paused', stock, result: 'ok' });
          return { ok: true };
        }
        const itq = await mlReq(`/items/${mlItemId}?attributes=status,sub_status`, 'GET', token);
        const mlStatus = itq.data?.status;
        const subStatus: string[] = Array.isArray(itq.data?.sub_status) ? itq.data.sub_status.map((s: any) => String(s)) : [];
        const pausedByStock = itq.ok && mlStatus === 'paused' && subStatus.includes('out_of_stock') && !isModerated(mlStatus, subStatus);
        if (!pausedByStock) {
          await supabase.from('ml_item_mapping').update({ last_known_stock: stock, last_synced_at: new Date().toISOString() }).eq('id', mapping.id);
          await logSync({ ...baseLog, action: 'skipped_not_stock_pause', new_ml_status: 'paused', stock, result: 'ok', error: itq.ok ? `ml_status=${mlStatus} sub=${JSON.stringify(subStatus)}` : `get_item_${itq.status}` });
          return { ok: true };
        }
        const ra = await mlReq(`/items/${mlItemId}`, 'PUT', token, { status: 'active', available_quantity: stock });
        if (!ra.ok) { await logSync({ ...baseLog, action: 'reactivate', new_ml_status: 'paused', stock, result: 'error', error: `reactivate: ${ra.status}: ${JSON.stringify(ra.data).slice(0, 150)}` }); return { ok: false, error: `reactivate: ${ra.status}`, retryable: isRetryable(ra.status) }; }
        await supabase.from('ml_item_mapping').update({ status: 'active', auto_paused_stock: false, last_known_stock: stock, last_synced_at: new Date().toISOString() }).eq('id', mapping.id);
        await logSync({ ...baseLog, action: 'reactivated', new_ml_status: 'active', stock, result: 'ok' });
        return { ok: true };
      }

      const r = await mlReq(`/items/${mlItemId}`, 'PUT', token, { available_quantity: stock });
      if (!r.ok) {
        // si falla por moderacion lo veremos en el body; igual se loguea.
        await logSync({ ...baseLog, action: 'qty_update', new_ml_status: 'active', stock, result: 'error', error: `update_qty: ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}` });
        return { ok: false, error: `update_qty: ${r.status}`, retryable: isRetryable(r.status) };
      }
      await supabase.from('ml_item_mapping').update({ last_known_stock: stock, last_synced_at: new Date().toISOString() }).eq('id', mapping.id);
      await logSync({ ...baseLog, action: 'qty_updated', new_ml_status: 'active', stock, result: 'ok' });
      return { ok: true };
    }
    case 'update_price': {
      const newPrice = Number((item.payload as any)?.new_price);
      const targetCurrency = (item.payload as any)?.currency_id;
      if (!newPrice || !targetCurrency) return { ok: false, error: 'missing_price_payload' };

      // Estado actual del item. Si ML lo tiene moderado (under_review/forbidden/banned/...),
      // el precio esta BLOQUEADO ('item.price.not_modifiable') -> saltar, no es editable.
      const cq = await mlReq(`/items/${mlItemId}?attributes=status,sub_status,currency_id`, 'GET', token);
      const st = cq.data?.status;
      const sub: string[] = Array.isArray(cq.data?.sub_status) ? cq.data.sub_status.map((s: any) => String(s)) : [];
      if (cq.ok && isModerated(st, sub)) {
        await logSync({ ...baseLog, action: 'skipped_moderated', new_ml_status: st, result: 'ok', error: `status=${st} sub=${JSON.stringify(sub)}` });
        return { ok: true };
      }

      const itemCur: string | null = cq.ok ? cq.data?.currency_id ?? null : null;

      // Intento 1: empujar en la moneda OBJETIVO (la que dicta el umbral USD). ML SI permite
      // cambiar currency_id de una publicacion activa (verificado: PUT /items -> 200).
      let pushCurrency: string = targetCurrency;
      let pushPrice: number = newPrice;
      let r = await mlReq(`/items/${mlItemId}`, 'PUT', token, { price: pushPrice, currency_id: pushCurrency });

      // Fallback: si ML rechaza el cambio de moneda (p.ej. items con ventas que la bloquean),
      // reintentar en la moneda ACTUAL del item, convirtiendo el precio con el dolar.
      if (!r.ok && itemCur && itemCur !== targetCurrency && (r.status === 400 || r.status === 403)) {
        const firstErr = JSON.stringify(r.data).slice(0, 200);
        const fx = await getFxRate();
        if (itemCur === 'UYU' && targetCurrency === 'USD') pushPrice = Math.round(newPrice * fx);
        else if (itemCur === 'USD' && targetCurrency === 'UYU') pushPrice = Math.round((newPrice / fx) * 100) / 100;
        pushCurrency = itemCur;
        r = await mlReq(`/items/${mlItemId}`, 'PUT', token, { price: pushPrice, currency_id: pushCurrency });
        if (r.ok) {
          await supabase.from('ml_item_mapping').update({ last_known_price_uyu: pushPrice, last_synced_at: new Date().toISOString() }).eq('id', mapping.id);
          await logSync({ ...baseLog, action: 'price_updated_currency_fallback', new_ml_status: mapping.status, result: 'ok', error: `target ${targetCurrency} rechazado (${firstErr}); push ${pushCurrency} ${pushPrice}` });
          return { ok: true };
        }
      }

      if (!r.ok) {
        const body = JSON.stringify(r.data).slice(0, 300);
        await logSync({ ...baseLog, action: 'price_update', new_ml_status: mapping.status, result: 'error', error: `update_price: ${r.status}: ${body}` });
        return { ok: false, error: `update_price: ${r.status}: ${body}`, retryable: isRetryable(r.status) };
      }
      await supabase.from('ml_item_mapping').update({ last_known_price_uyu: pushPrice, last_synced_at: new Date().toISOString() }).eq('id', mapping.id);
      await logSync({ ...baseLog, action: 'price_updated', new_ml_status: mapping.status, result: 'ok', error: `${pushCurrency} ${pushPrice}` });
      return { ok: true };
    }
    case 'pause': {
      const r = await mlReq(`/items/${mlItemId}`, 'PUT', token, { status: 'paused' });
      if (!r.ok) { await logSync({ ...baseLog, action: 'pause', new_ml_status: mapping.status, result: 'error', error: `pause: ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}` }); return { ok: false, error: `pause: ${r.status}`, retryable: isRetryable(r.status) }; }
      await supabase.from('ml_item_mapping').update({ status: 'paused', auto_paused_stock: false, last_synced_at: new Date().toISOString() }).eq('id', mapping.id);
      await logSync({ ...baseLog, action: 'paused', new_ml_status: 'paused', result: 'ok' });
      return { ok: true };
    }
    case 'reactivate': {
      if (!reactivateEnabled) {
        await logSync({ ...baseLog, action: 'skipped_reactivate_disabled', new_ml_status: mapping.status, result: 'ok' });
        return { ok: true };
      }
      const r = await mlReq(`/items/${mlItemId}`, 'PUT', token, { status: 'active' });
      if (!r.ok) { await logSync({ ...baseLog, action: 'reactivate', new_ml_status: mapping.status, result: 'error', error: `reactivate: ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}` }); return { ok: false, error: `reactivate: ${r.status}`, retryable: isRetryable(r.status) }; }
      await supabase.from('ml_item_mapping').update({ status: 'active', auto_paused_stock: false, last_synced_at: new Date().toISOString() }).eq('id', mapping.id);
      await logSync({ ...baseLog, action: 'reactivated', new_ml_status: 'active', result: 'ok' });
      return { ok: true };
    }
    case 'close': {
      const r = await mlReq(`/items/${mlItemId}`, 'PUT', token, { status: 'closed' });
      if (!r.ok) { await logSync({ ...baseLog, action: 'close', new_ml_status: mapping.status, result: 'error', error: `close: ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}` }); return { ok: false, error: `close: ${r.status}`, retryable: isRetryable(r.status) }; }
      await supabase.from('ml_item_mapping').update({ status: 'closed', last_synced_at: new Date().toISOString() }).eq('id', mapping.id);
      await logSync({ ...baseLog, action: 'closed', new_ml_status: 'closed', result: 'ok' });
      return { ok: true };
    }
    default:
      return { ok: false, error: `unknown_operation: ${item.operation}` };
  }
}

async function run() {
  const t0 = Date.now();
  const stats = { taken: 0, ok: 0, failed: 0, retried: 0, errors: [] as any[] };

  const { data: pending } = await supabase.from('ml_sync_queue')
    .select('id, operation, product_id, variant_id, ml_item_id, payload, attempts')
    .in('operation', ['update_stock', 'update_price', 'update_both', 'pause', 'reactivate', 'close'])
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .order('id', { ascending: true })
    .limit(MAX_PER_RUN);

  if (!pending || pending.length === 0) return { ok: true, ...stats, message: 'nothing_to_do' };

  const ids = pending.map(p => p.id);
  await supabase.from('ml_sync_queue').update({ status: 'processing' }).in('id', ids);

  const { data: settingsRows } = await supabase.from('app_settings').select('key, value').in('key', ['ml_stock_threshold', 'ml_auto_reactivate_enabled']);
  const settings = new Map((settingsRows ?? []).map((r: any) => [r.key, r.value]));

  let token: string;
  try { token = await getToken(); }
  catch (e: any) {
    await supabase.from('ml_sync_queue').update({ status: 'pending', last_error: `setup: ${e?.message}` }).in('id', ids);
    return { ok: false, error: e?.message };
  }

  for (const item of pending) {
    stats.taken++;
    const attempts = (item.attempts ?? 0) + 1;
    try {
      const r = await processItem(item, token, settings);
      if (r.ok) {
        await supabase.from('ml_sync_queue').update({ status: 'done', processed_at: new Date().toISOString(), attempts }).eq('id', item.id);
        stats.ok++;
      } else if (r.retryable && attempts < MAX_ATTEMPTS) {
        await supabase.from('ml_sync_queue').update({ status: 'pending', attempts, last_error: r.error, scheduled_for: new Date(Date.now() + 60000 * attempts).toISOString() }).eq('id', item.id);
        stats.retried++;
      } else {
        await supabase.from('ml_sync_queue').update({ status: 'error', processed_at: new Date().toISOString(), last_error: r.error, attempts }).eq('id', item.id);
        stats.failed++;
        stats.errors.push({ id: item.id, op: item.operation, error: r.error });
      }
    } catch (e: any) {
      if (attempts < MAX_ATTEMPTS) {
        await supabase.from('ml_sync_queue').update({ status: 'pending', attempts, last_error: `exc: ${e?.message}`, scheduled_for: new Date(Date.now() + 60000 * attempts).toISOString() }).eq('id', item.id);
        stats.retried++;
      } else {
        await supabase.from('ml_sync_queue').update({ status: 'error', processed_at: new Date().toISOString(), last_error: `exc: ${e?.message}`, attempts }).eq('id', item.id);
        stats.failed++;
      }
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  await supabase.from('app_settings').upsert({ key: 'ml_sync_last_run', value: { ...stats, elapsed_s: Number(elapsed), at: new Date().toISOString() } as any, updated_at: new Date().toISOString() });
  return { ok: true, ...stats, elapsed_s: Number(elapsed) };
}

Deno.serve(async (_req: Request) => {
  // @ts-ignore EdgeRuntime
  EdgeRuntime.waitUntil(run());
  return new Response(JSON.stringify({ ok: true, started: true }), { status: 202, headers: { 'Content-Type': 'application/json' } });
});
