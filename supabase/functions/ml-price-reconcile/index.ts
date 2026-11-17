// deno-lint-ignore-file no-explicit-any
// ml-price-reconcile (v1, 2026-11-17): el precio de Mercado Libre es ESPEJO del sistema.
//
// Compara el precio REAL que tiene cada publicacion en ML contra el que le corresponde
// segun costo + margen de ML + IVA (misma formula que ml-reprice-active) y, si no
// coincide, encola un update_price en ml_sync_queue (ml-process-sync-queue lo empuja en
// ~1 min). Antes el sistema solo comparaba contra su propio espejo y nunca se enteraba de:
//   - precios cambiados desde ML (Suunto Race 2 vendido a 478 en vez de 511), ni de
//   - reprecios salteados por estar la publicacion under_review (DVR62 a 96 en vez de 117).
//
// Modos (body.mode):
//   'pending' -> publicaciones anotadas en ml_price_check (aviso items_prices de ML, via
//                trigger). Cron cada minuto: es el camino de tiempo real.
//   'full'    -> todas las publicaciones vivas. Cron cada 15 min: red de seguridad.
//   'items'   -> body.item_ids (manual / pruebas).
// body.dry_run = true: no encola nada, devuelve lo que haria.
//
// Reglas:
//   - Solo se corrigen publicaciones active/paused en ML. under_review/inactive tienen el
//     precio bloqueado por ML: se cuentan como 'blocked' y el barrido las reintenta solo
//     cuando vuelven (eso arregla el reprecio perdido de las moderadas).
//   - USD: tiene que coincidir exacto. UYU: tolerancia 1 % (el precio depende del dolar del
//     dia; misma tolerancia que ml_reprice_fx_tick, si no se re-editarian ~140 por centesimos).
//   - Moneda distinta a la que corresponde = desvio (se corrige moneda y precio).
//   - Freno anti-bucle: maximo MAX_FIXES_PER_DAY correcciones por publicacion en 24 h. Si
//     ML (o alguien) lo vuelve a cambiar mas veces, se deja de pelear y queda 'capped' en el
//     reporte para que lo mire un humano.
//   - Publicaciones de catalogo (no estan en ml_item_mapping): se resuelven a la ficha padre
//     por item_relations; ML espeja el precio de la padre a la de catalogo.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const ML_CLIENT_ID = Deno.env.get('ML_CLIENT_ID')!;
const ML_CLIENT_SECRET = Deno.env.get('ML_CLIENT_SECRET')!;
const ML_API = 'https://api.mercadolibre.com';
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const UYU_TOLERANCE_PCT = 1;
// Igual que isModerated() de ml-process-sync-queue: si el procesador lo va a saltear, no
// tiene sentido encolarlo (quedaria en bucle hasta el tope diario).
const MODERATION_SUBSTATUS = ['under_review', 'banned', 'forbidden', 'freezed', 'deleted', 'suspended', 'waiting_for_patch'];
function isModerated(st: string, sub: string[] | undefined): boolean {
  if (st === 'under_review' || st === 'closed' || st === 'inactive') return true;
  return (sub ?? []).some((s) => MODERATION_SUBSTATUS.includes(String(s)));
}
const MAX_FIXES_PER_DAY = 6;
const SOURCE = 'price_reconcile';

// ---------- Formula de precio: COPIA EXACTA de ml-reprice-active v20. Si se cambia alli,
// ---------- cambiarla aca (o el reconciliador va a "corregir" contra la formula vieja).
function marginOverrideOf(prod: any): number | null {
  const raw = prod?.ml_margin_override_percent;
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  return isNaN(n) ? null : n;
}
function resolveMlMargin(cfg: any, cost: number, categoryId: string | null, subcategoryId: string | null, fallback: number): number {
  if (!cfg || typeof cfg !== 'object') return fallback;
  const subOv = cfg.subcategory_overrides || {};
  const catOv = cfg.category_overrides || {};
  if (subcategoryId && subOv[subcategoryId] != null) return Number(subOv[subcategoryId]);
  if (categoryId && catOv[categoryId] != null) return Number(catOv[categoryId]);
  const tiers = Array.isArray(cfg.tiers) ? cfg.tiers : [];
  for (const t of tiers) { if (t.max == null) return Number(t.pct); if (cost <= Number(t.max)) return Number(t.pct); }
  return fallback;
}
function computePriceAndCurrency(cost: number, markup: number, iva: number, fx: number, threshold: number): { price: number; currency_id: 'USD' | 'UYU' } {
  const withIva = cost * (1 + markup / 100) * (1 + iva / 100);
  if (cost > threshold) return { price: Math.ceil(withIva), currency_id: 'USD' };
  return { price: Math.ceil(withIva * fx), currency_id: 'UYU' };
}
// ----------

async function fetchAllPages<T>(makeQuery: (from: number, to: number) => any): Promise<T[]> {
  const out: T[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await makeQuery(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

async function getFxRate(): Promise<number> {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/get-fx-rate`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } });
  if (!resp.ok) throw new Error(`fx_rate_fetch_failed: ${resp.status}`);
  const j: any = await resp.json();
  const rate = Number(j.rate);
  if (!rate || rate <= 0) throw new Error('invalid_fx_rate');
  return rate;
}

async function getToken(): Promise<string> {
  const { data: cred } = await supabase.from('ml_credentials').select('*').order('id', { ascending: false }).limit(1).maybeSingle();
  if (!cred) throw new Error('no_creds');
  if (new Date(cred.expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
    const r = await fetch(`${ML_API}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: ML_CLIENT_ID, client_secret: ML_CLIENT_SECRET, refresh_token: cred.refresh_token }).toString() });
    const data: any = await r.json();
    if (!r.ok) throw new Error(`refresh: ${JSON.stringify(data)}`);
    const exp = new Date(Date.now() + (Number(data.expires_in) - 30) * 1000).toISOString();
    await supabase.from('ml_credentials').update({ access_token: data.access_token, refresh_token: data.refresh_token ?? cred.refresh_token, expires_at: exp }).eq('id', cred.id);
    return data.access_token;
  }
  return cred.access_token;
}

async function mlGet(path: string, token: string): Promise<{ ok: boolean; status: number; data: any }> {
  const r = await fetch(`${ML_API}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  const t = await r.text();
  try { return { ok: r.ok, status: r.status, data: JSON.parse(t) }; } catch { return { ok: r.ok, status: r.status, data: { raw: t } }; }
}

type MlItem = { id: string; price: number; currency_id: string; status: string; sub_status?: string[]; item_relations?: any[]; catalog_listing?: boolean };
const ATTRS = 'id,price,currency_id,status,sub_status,item_relations,catalog_listing';

// Multiget de 20. Algunos lotes vuelven 403 "Resource deprecated" (visto 17/11): en ese caso
// se piden de a uno, que si funciona.
async function fetchMlItems(ids: string[], token: string): Promise<{ items: Map<string, MlItem>; errors: number }> {
  const items = new Map<string, MlItem>();
  let errors = 0;
  for (let i = 0; i < ids.length; i += 20) {
    const lote = ids.slice(i, i + 20);
    const r = await mlGet(`/items?ids=${lote.join(',')}&attributes=${ATTRS}`, token);
    const got = new Set<string>();
    if (r.ok && Array.isArray(r.data)) {
      for (const e of r.data) {
        if (Number(e?.code) === 200 && e?.body?.id) { items.set(e.body.id, e.body); got.add(e.body.id); }
      }
    }
    for (const id of lote) {
      if (got.has(id)) continue;
      const one = await mlGet(`/items/${id}?attributes=${ATTRS}`, token);
      if (one.ok && one.data?.id) items.set(one.data.id, one.data);
      else errors++;
    }
  }
  return { items, errors };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  const body = await req.json().catch(() => ({}));
  const mode: 'pending' | 'full' | 'items' = body?.mode === 'full' ? 'full' : body?.mode === 'items' ? 'items' : 'pending';
  const dryRun = body?.dry_run === true;

  const { data: run } = dryRun ? { data: null } : await supabase.from('ml_price_reconcile_runs').insert({ mode }).select('id').single();
  const runId = (run as any)?.id ?? null;

  try {
    // ---- 1. Que publicaciones revisar
    let requested: string[] = [];
    let pendingRows: { ml_item_id: string; requested_at: string }[] = [];
    if (mode === 'pending') {
      const { data } = await supabase.from('ml_price_check').select('ml_item_id, requested_at').is('processed_at', null).order('requested_at').limit(200);
      pendingRows = (data ?? []) as any;
      requested = pendingRows.map((r) => r.ml_item_id);
      if (requested.length === 0) {
        if (runId) await supabase.from('ml_price_reconcile_runs').update({ finished_at: new Date().toISOString(), checked: 0 }).eq('id', runId);
        return json({ ok: true, mode, checked: 0 });
      }
    } else if (mode === 'items') {
      requested = Array.isArray(body?.item_ids) ? body.item_ids.filter((x: any) => typeof x === 'string' && /^MLU\d+$/.test(x)) : [];
    }

    const token = await getToken();

    // ---- 2. Mapeos vivos (con costo/categoria/override del producto)
    const allMaps = await fetchAllPages<any>((from, to) =>
      supabase.from('ml_item_mapping')
        .select('id, ml_item_id, variant_id, product_id, status, products(external_code, price_usd, category_id, subcategory_id, ml_margin_override_percent)')
        .in('status', ['active', 'paused'])
        .order('id', { ascending: true }).range(from, to)
    );
    const mapByItem = new Map<string, any>();
    for (const m of allMaps) if (m.ml_item_id) mapByItem.set(m.ml_item_id, m);

    let targetIds: string[];
    const unresolved: string[] = [];
    let mlItems = new Map<string, MlItem>();
    let fetchErrors = 0;

    if (mode === 'full') {
      targetIds = [...mapByItem.keys()];
      const f = await fetchMlItems(targetIds, token);
      mlItems = f.items; fetchErrors = f.errors;
    } else {
      // Pedidos puntuales: pueden ser publicaciones de catalogo (no mapeadas) -> ficha padre.
      const f = await fetchMlItems(requested, token);
      fetchErrors = f.errors;
      const set = new Set<string>();
      for (const id of requested) {
        if (mapByItem.has(id)) { set.add(id); continue; }
        const it = f.items.get(id);
        const parent = (it?.item_relations ?? []).map((r: any) => r?.id).find((pid: string) => mapByItem.has(pid));
        if (parent) set.add(parent); else unresolved.push(id);
      }
      targetIds = [...set];
      const need = targetIds.filter((id) => !f.items.has(id));
      for (const [k, v] of f.items) mlItems.set(k, v);
      if (need.length > 0) { const g = await fetchMlItems(need, token); for (const [k, v] of g.items) mlItems.set(k, v); fetchErrors += g.errors; }
    }

    // ---- 3. Config de precios (igual que ml-reprice-active)
    const { data: settingsRows } = await supabase.from('app_settings').select('key, value').in('key', ['ml_markup_percent', 'ml_usd_threshold', 'pricing_config', 'ml_pricing_config']);
    const settings = new Map((settingsRows ?? []).map((r: any) => [r.key, r.value]));
    const fallbackMarkup = Number(settings.get('ml_markup_percent') ?? 30);
    const pricingConfig: any = settings.get('pricing_config') ?? {};
    const legacyIva = Number(pricingConfig?.iva_percent ?? 22);
    const legacyThreshold = Number(settings.get('ml_usd_threshold') ?? 100);
    const cfg: any = settings.get('ml_pricing_config') ?? null;
    const hasCfg = cfg && typeof cfg === 'object';
    const iva = hasCfg && cfg.iva_percent != null ? Number(cfg.iva_percent) : legacyIva;
    const threshold = hasCfg && cfg.usd_threshold != null ? Number(cfg.usd_threshold) : legacyThreshold;
    const fx = await getFxRate();

    // ---- 4. Pendientes en la cola y correcciones recientes (freno anti-bucle)
    const pend = await fetchAllPages<any>((from, to) =>
      supabase.from('ml_sync_queue').select('id, variant_id, payload')
        .eq('operation', 'update_price').eq('status', 'pending')
        .order('id', { ascending: true }).range(from, to)
    );
    const pendingByVariant = new Map<string, any>();
    for (const p of pend) pendingByVariant.set(p.variant_id, p);

    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const recentFixes = await fetchAllPages<any>((from, to) =>
      supabase.from('ml_sync_log').select('ml_item_id')
        .eq('operation', 'price_reconcile').eq('action', 'drift_enqueued').gte('created_at', since)
        .order('id', { ascending: true }).range(from, to)
    );
    const fixesByItem = new Map<string, number>();
    for (const r of recentFixes) fixesByItem.set(r.ml_item_id, (fixesByItem.get(r.ml_item_id) ?? 0) + 1);

    // ---- 5. Comparar
    let checked = 0, inSync = 0, drift = 0, blocked = 0, capped = 0, notFound = 0;
    const toInsert: any[] = [];
    const toRepoint: { id: number; payload: any }[] = [];
    const logs: any[] = [];
    const sample: any[] = [];

    for (const itemId of targetIds) {
      const m = mapByItem.get(itemId);
      const ml = mlItems.get(itemId);
      if (!m) continue;
      if (!ml) { notFound++; continue; }
      const prod: any = m.products;
      const cost = Number(prod?.price_usd);
      if (!cost || cost <= 0) continue;
      checked++;

      const ivaCost = cost * (1 + iva / 100);
      const override = marginOverrideOf(prod);
      const margin = override !== null ? override : resolveMlMargin(cfg, ivaCost, prod?.category_id ?? null, prod?.subcategory_id ?? null, fallbackMarkup);
      const exp = computePriceAndCurrency(cost, margin, iva, fx, threshold);

      const mlPrice = Number(ml.price);
      const sameCurrency = ml.currency_id === exp.currency_id;
      const ok = sameCurrency && (exp.currency_id === 'USD'
        ? mlPrice === exp.price
        : Math.abs(mlPrice - exp.price) / exp.price * 100 <= UYU_TOLERANCE_PCT);
      if (ok) { inSync++; continue; }

      // Moneda bloqueada por ML: el procesador ya intento cambiarla, ML la rechazo y empujo el
      // precio convertido en la moneda actual (fallback). Si el equivalente esta dentro de la
      // tolerancia, el precio es correcto: no pelear la moneda cada 15 min.
      if (!sameCurrency && (ml.currency_id === 'USD' || ml.currency_id === 'UYU')) {
        const equiv = ml.currency_id === 'UYU' ? mlPrice / fx : mlPrice * fx;
        const { data: fb } = await supabase.from('ml_sync_log').select('id').eq('ml_item_id', itemId)
          .eq('action', 'price_updated_currency_fallback').limit(1);
        if ((fb ?? []).length > 0 && Math.abs(equiv - exp.price) / exp.price * 100 <= UYU_TOLERANCE_PCT) { inSync++; continue; }
      }

      drift++;
      const desc = `ML ${ml.currency_id} ${mlPrice} -> ${exp.currency_id} ${exp.price}`;
      if (isModerated(ml.status, ml.sub_status)) {
        blocked++;
        continue; // ML no deja editar el precio; el barrido lo reintenta cuando vuelva.
      }
      if ((fixesByItem.get(itemId) ?? 0) >= MAX_FIXES_PER_DAY) {
        capped++;
        if (sample.length < 50) sample.push({ item: itemId, code: prod?.external_code, desc, capped: true });
        continue;
      }

      const payload = { new_price: exp.price, currency_id: exp.currency_id, source: SOURCE };
      const pending = pendingByVariant.get(m.variant_id);
      if (pending) {
        const pp = pending.payload ?? {};
        if (Number(pp.new_price) === exp.price && pp.currency_id === exp.currency_id) continue; // ya va en camino
        toRepoint.push({ id: pending.id, payload });
      } else {
        toInsert.push({ operation: 'update_price', product_id: m.product_id, variant_id: m.variant_id, ml_item_id: itemId, status: 'pending', scheduled_for: new Date().toISOString(), payload });
      }
      logs.push({ ml_item_id: itemId, variant_id: m.variant_id, external_code: prod?.external_code ?? null, operation: 'price_reconcile', action: 'drift_enqueued', result: 'ok', error: desc, source: mode === 'full' ? 'reconcile_full' : 'reconcile_webhook', old_ml_status: ml.status, new_ml_status: ml.status });
      if (sample.length < 50) sample.push({ item: itemId, code: prod?.external_code, desc, status: ml.status });
    }

    const enqueued = toInsert.length + toRepoint.length;
    if (!dryRun) {
      for (let i = 0; i < toInsert.length; i += 500) {
        const { error } = await supabase.from('ml_sync_queue').insert(toInsert.slice(i, i + 500));
        if (error) throw new Error(`enqueue: ${error.message}`);
      }
      for (const r of toRepoint) {
        const { error } = await supabase.from('ml_sync_queue').update({ payload: r.payload, scheduled_for: new Date().toISOString() }).eq('id', r.id).eq('status', 'pending');
        if (error) throw new Error(`repoint: ${error.message}`);
      }
      for (let i = 0; i < logs.length; i += 500) await supabase.from('ml_sync_log').insert(logs.slice(i, i + 500));

      // Marcar revisados SOLO los que no se volvieron a pedir mientras corriamos.
      for (const r of pendingRows) {
        await supabase.from('ml_price_check').update({ processed_at: new Date().toISOString() }).eq('ml_item_id', r.ml_item_id).eq('requested_at', r.requested_at);
      }
    }

    const result = { ok: true, mode, dry_run: dryRun, checked, in_sync: inSync, drift, enqueued, blocked, capped, not_found: notFound, fetch_errors: fetchErrors, unresolved, fx, sample };
    if (runId) {
      await supabase.from('ml_price_reconcile_runs').update({ finished_at: new Date().toISOString(), checked, in_sync: inSync, drift, enqueued, blocked, capped, errors: fetchErrors + notFound, details: { sample, unresolved, fx } }).eq('id', runId);
    }
    return json(result);
  } catch (e: any) {
    if (runId) await supabase.from('ml_price_reconcile_runs').update({ finished_at: new Date().toISOString(), errors: -1, details: { error: e?.message ?? String(e) } }).eq('id', runId);
    return json({ ok: false, error: e?.message ?? 'unknown' }, 500);
  }
});
