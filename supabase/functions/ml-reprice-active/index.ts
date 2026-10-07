// deno-lint-ignore-file no-explicit-any
// ml-reprice-active: recalcula el precio de TODAS las publicaciones segun
// ml_pricing_config (tramos + override categoria/subcategoria) y encola un update_price
// por cada una en ml_sync_queue. El cron ml-process-sync-queue las empuja a ML (20/min).
// Disparo manual desde el panel ('Repreciar publicaciones activas').
//
// v7 (2026-10-07): body.only_currency + body.min_change_pct para el cron por dolar
// (ml_reprice_fx_tick): las publicaciones en UYU se calculan con el dolar del dia.
//
// v6 (2026-10-07): acepta body.source. Ademas lo llama el cron ml_reprice_cost_tick con
// los product_ids cuyo costo (price_usd) cambio: antes, si CDR subia el costo, ML quedaba
// con el precio viejo hasta el proximo reprecio manual (venta a perdida de CAM584).
//
// v5 (2026-08-29): PAGINADO. La consulta de mappings no tenia .range() y PostgREST
// corta en 1000 filas sin dar error: con 1205 publicaciones vivas (676 activas + 529
// pausadas) el repricing dejaba ~205 con el precio viejo, y cuales quedaban afuera no
// era ni determinista. Idem la lectura de pendientes de la cola (deduplicacion).
//
// v4 (2026-08-13): el margen manual de ML vive en products.ml_margin_override_percent,
// separado del de la web (margin_override_percent): en ML se vende mas caro para cubrir
// la comision, asi que cada canal se ajusta por su lado.
//
// v3 (2026-08-13): respeta el MARGEN MANUAL por producto y acepta body.product_ids para
// repreciar SOLO esos productos (lo usa el panel al guardar un margen manual); en ese
// modo, si ya habia un update_price pendiente para la variante, se le PISA el payload
// en vez de saltearlo.
//
// v2 (2026-08-06): tambien se reprecian las publicaciones PAUSADAS. Antes solo se
// tomaban los mappings 'active', asi que las 456 pausadas se quedaban con el precio
// viejo y volvian a la venta con el margen anterior cuando entraba stock (la
// reactivacion empuja cantidad, nunca precio). ML deja editar el precio de un item
// pausado, y el procesador de la cola ya acepta mappings 'paused'.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// Margen manual de ML (products.ml_margin_override_percent): gana sobre cualquier
// tramo/override de categoria. Es INDEPENDIENTE del margen manual de la web
// (margin_override_percent): en ML se vende mas caro para cubrir la comision.
// Un 0 es valido (vender al costo + IVA), asi que solo null/undefined/NaN son "automatico".
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
  // Precio redondo: siempre entero hacia arriba, sin decimales/milesimas
  if (cost > threshold) return { price: Math.ceil(withIva), currency_id: 'USD' };
  return { price: Math.ceil(withIva * fx), currency_id: 'UYU' };
}

// PostgREST corta toda consulta en max_rows (1000) SIN error: hay que paginar a mano.
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dry_run === true;
    // product_ids: repreciar SOLO esos productos (lo usa el panel cuando el admin le
    // cambia el margen manual a uno). Sin la lista, repricea todo el catalogo como antes.
    const productIds: string[] = Array.isArray(body?.product_ids)
      ? body.product_ids.filter((x: any) => typeof x === 'string' && x.length > 0)
      : [];
    // body.source: quien pidio el reprecio, queda en el payload de la cola (ej. 'cost_change'
    // cuando lo dispara el cron ml_reprice_cost_tick porque CDR cambio el costo).
    const sourceTag = typeof body?.source === 'string' && body.source.length > 0 && body.source.length <= 40
      ? body.source
      : (productIds.length > 0 ? 'margin_override' : 'reprice');
    // only_currency: repreciar solo las que quedan en esa moneda. min_change_pct: no encolar
    // si el precio nuevo difiere del ultimo empujado menos que ese %. Los usa el cron
    // ml_reprice_fx_tick (only_currency='UYU'): esas dependen del dolar, y sin tolerancia
    // cada movimiento de centesimos re-editaria ~140 publicaciones.
    const onlyCurrency: string | null = body?.only_currency === 'UYU' || body?.only_currency === 'USD' ? body.only_currency : null;
    const minChangePct = Number(body?.min_change_pct) > 0 ? Number(body.min_change_pct) : 0;

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

    // Publicaciones vivas (activas + pausadas) con costo/categoria del producto. Las
    // pausadas entran para que no vuelvan a la venta con el margen viejo.
    // .order('id') fija un orden estable: sin el, paginar sobre un orden indefinido
    // puede repetir o saltear filas entre paginas.
    let maps: any[];
    try {
      maps = await fetchAllPages<any>((from, to) => {
        let q = supabase
          .from('ml_item_mapping')
          .select('id, variant_id, product_id, status, last_known_price_uyu, products(price_usd, category_id, subcategory_id, ml_margin_override_percent)')
          .in('status', ['active', 'paused']);
        if (productIds.length > 0) q = q.in('product_id', productIds);
        return q.order('id', { ascending: true }).range(from, to);
      });
    } catch (e: any) {
      throw new Error(`load_mappings: ${e?.message ?? e}`);
    }

    // No duplicar: variantes que ya tienen un update_price pendiente. Tambien paginado:
    // si quedan mas de 1000 pendientes, la deduplicacion encolaba precios repetidos.
    const pend = await fetchAllPages<any>((from, to) =>
      supabase.from('ml_sync_queue').select('id, variant_id')
        .eq('operation', 'update_price').eq('status', 'pending')
        .order('id', { ascending: true }).range(from, to)
    );
    const pendingById = new Map<string, number>();
    for (const p of pend ?? []) pendingById.set((p as any).variant_id, (p as any).id);

    const toInsert: any[] = [];
    // Modo puntual (product_ids): en vez de saltear el pendiente le PISAMOS el payload.
    // Si no, cambiar el margen dos veces seguidas dejaba encolado el precio viejo.
    const toRepoint: { id: number; payload: any }[] = [];
    let skippedSamePrice = 0, skippedPending = 0, skippedNoCost = 0, skippedOtherCurrency = 0, enqueuedPaused = 0;
    const sample: any[] = [];
    for (const m of maps ?? []) {
      const prod: any = (m as any).products;
      const cost = Number(prod?.price_usd);
      if (!cost || cost <= 0) { skippedNoCost++; continue; }
      const pendingId = pendingById.get((m as any).variant_id);
      if (pendingId !== undefined && productIds.length === 0) { skippedPending++; continue; }
      // El tramo del margen se decide por el costo CON IVA (no el costo base): los tramos
      // se definen pensando en el precio con IVA. ivaCost solo elige el tramo; el precio
      // final se sigue calculando con el costo real.
      const ivaCost = cost * (1 + iva / 100);
      const override = marginOverrideOf(prod);
      const margin = override !== null
        ? override
        : resolveMlMargin(cfg, ivaCost, prod?.category_id ?? null, prod?.subcategory_id ?? null, fallbackMarkup);
      const calc = computePriceAndCurrency(cost, margin, iva, fx, threshold);
      // Si queda igual al ultimo precio conocido (en UYU), no encolar.
      if (calc.currency_id === 'UYU' && Number((m as any).last_known_price_uyu) === calc.price) { skippedSamePrice++; continue; }
      if (onlyCurrency && calc.currency_id !== onlyCurrency) { skippedOtherCurrency++; continue; }
      if (minChangePct > 0) {
        const last = Number((m as any).last_known_price_uyu);
        if (last > 0 && Math.abs(calc.price - last) / last * 100 < minChangePct) { skippedSamePrice++; continue; }
      }
      if (sample.length < 10) sample.push({ variant_id: (m as any).variant_id, cost, margin, price: calc.price, currency: calc.currency_id });
      if ((m as any).status === 'paused') enqueuedPaused++;
      const payload = { new_price: calc.price, currency_id: calc.currency_id, source: sourceTag };
      if (pendingId !== undefined) {
        toRepoint.push({ id: pendingId, payload });
        continue;
      }
      toInsert.push({ operation: 'update_price', product_id: (m as any).product_id, variant_id: (m as any).variant_id, status: 'pending', scheduled_for: new Date().toISOString(), payload });
    }

    const activeCount = (maps ?? []).filter((m: any) => m.status === 'active').length;
    const pausedCount = (maps ?? []).length - activeCount;

    if (dryRun) {
      return json({ ok: true, dry_run: true, active: activeCount, paused: pausedCount, would_enqueue: toInsert.length + toRepoint.length, repointed: toRepoint.length, enqueuedPaused, skippedSamePrice, skippedPending, skippedNoCost, skippedOtherCurrency, sample });
    }

    // Insert en lotes de 500.
    let enqueued = 0;
    for (let i = 0; i < toInsert.length; i += 500) {
      const chunk = toInsert.slice(i, i + 500);
      const { error: insErr } = await supabase.from('ml_sync_queue').insert(chunk);
      if (insErr) throw new Error(`enqueue: ${insErr.message}`);
      enqueued += chunk.length;
    }

    // Pendientes que ya existian: les dejamos el precio nuevo (modo puntual).
    let repointed = 0;
    for (const row of toRepoint) {
      const { error: updErr } = await supabase.from('ml_sync_queue')
        .update({ payload: row.payload, scheduled_for: new Date().toISOString() })
        .eq('id', row.id)
        .eq('status', 'pending');
      if (updErr) throw new Error(`repoint: ${updErr.message}`);
      repointed++;
    }

    // Vino del cron por cambio de costo: recien ahora que el precio quedo encolado se
    // borran los anotados. dispatched_at no nulo = no volvio a cambiar el costo desde que
    // el cron los mando (el trigger lo resetea), asi no se pierde un cambio posterior.
    if (sourceTag === 'cost_change' && productIds.length > 0) {
      const { error: delErr } = await supabase.from('ml_reprice_pending')
        .delete()
        .in('product_id', productIds)
        .not('dispatched_at', 'is', null);
      if (delErr) throw new Error(`clear_pending: ${delErr.message}`);
    }

    return json({ ok: true, active: activeCount, paused: pausedCount, enqueued, repointed, enqueuedPaused, skippedSamePrice, skippedPending, skippedNoCost, skippedOtherCurrency, note: 'La cola se procesa ~20/min y empuja los precios a ML. Mira el progreso en ml_sync_log.' });
  } catch (e: any) {
    return json({ ok: false, error: e?.message ?? 'unknown' }, 500);
  }
});
