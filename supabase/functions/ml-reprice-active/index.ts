// deno-lint-ignore-file no-explicit-any
// ml-reprice-active: recalcula el precio de TODAS las publicaciones activas segun
// ml_pricing_config (tramos + override categoria/subcategoria) y encola un update_price
// por cada una en ml_sync_queue. El cron ml-process-sync-queue las empuja a ML (20/min).
// Disparo manual desde el panel ('Repreciar publicaciones activas').
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

function resolveMlMargin(cfg: any, cost: number, categoryId: string | null, subcategoryId: string | null, fallback: number): number {
  if (!cfg || typeof cfg !== 'object') return fallback;
  const subOv = cfg.subcategory_overrides || {};
  const catOv = cfg.category_overrides || {};
  if (subcategoryId && subOv[subcategoryId] != null) return Number(subOv[subcategoryId]);
  if (categoryId && catOv[categoryId] != null) return Number(catOv[categoryId]);
  const tiers = Array.isArray(cfg.tiers) ? cfg.tiers : [];
  for (const t of tiers) { if (t.max == null) return Number(t.pct); if (cost < Number(t.max)) return Number(t.pct); }
  return fallback;
}

function computePriceAndCurrency(cost: number, markup: number, iva: number, fx: number, threshold: number): { price: number; currency_id: 'USD' | 'UYU' } {
  const withIva = cost * (1 + markup / 100) * (1 + iva / 100);
  // Precio redondo: siempre entero hacia arriba, sin decimales/milesimas
  if (cost > threshold) return { price: Math.ceil(withIva), currency_id: 'USD' };
  return { price: Math.ceil(withIva * fx), currency_id: 'UYU' };
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

    // Publicaciones activas + costo/categoria del producto.
    const { data: maps, error: mErr } = await supabase
      .from('ml_item_mapping')
      .select('id, variant_id, product_id, last_known_price_uyu, products(price_usd, category_id, subcategory_id)')
      .eq('status', 'active');
    if (mErr) throw new Error(`load_mappings: ${mErr.message}`);

    // No duplicar: variantes que ya tienen un update_price pendiente.
    const { data: pend } = await supabase.from('ml_sync_queue').select('variant_id').eq('operation', 'update_price').eq('status', 'pending');
    const pendingSet = new Set((pend ?? []).map((p: any) => p.variant_id));

    const toInsert: any[] = [];
    let skippedSamePrice = 0, skippedPending = 0, skippedNoCost = 0;
    const sample: any[] = [];
    for (const m of maps ?? []) {
      const prod: any = (m as any).products;
      const cost = Number(prod?.price_usd);
      if (!cost || cost <= 0) { skippedNoCost++; continue; }
      if (pendingSet.has((m as any).variant_id)) { skippedPending++; continue; }
      // El tramo del margen se decide por el costo CON IVA (no el costo base): los tramos
      // se definen pensando en el precio con IVA. ivaCost solo elige el tramo; el precio
      // final se sigue calculando con el costo real.
      const ivaCost = cost * (1 + iva / 100);
      const margin = resolveMlMargin(cfg, ivaCost, prod?.category_id ?? null, prod?.subcategory_id ?? null, fallbackMarkup);
      const calc = computePriceAndCurrency(cost, margin, iva, fx, threshold);
      // Si queda igual al ultimo precio conocido (en UYU), no encolar.
      if (calc.currency_id === 'UYU' && Number((m as any).last_known_price_uyu) === calc.price) { skippedSamePrice++; continue; }
      if (sample.length < 10) sample.push({ variant_id: (m as any).variant_id, cost, margin, price: calc.price, currency: calc.currency_id });
      toInsert.push({ operation: 'update_price', product_id: (m as any).product_id, variant_id: (m as any).variant_id, status: 'pending', scheduled_for: new Date().toISOString(), payload: { new_price: calc.price, currency_id: calc.currency_id, source: 'reprice' } });
    }

    if (dryRun) {
      return json({ ok: true, dry_run: true, active: (maps ?? []).length, would_enqueue: toInsert.length, skippedSamePrice, skippedPending, skippedNoCost, sample });
    }

    // Insert en lotes de 500.
    let enqueued = 0;
    for (let i = 0; i < toInsert.length; i += 500) {
      const chunk = toInsert.slice(i, i + 500);
      const { error: insErr } = await supabase.from('ml_sync_queue').insert(chunk);
      if (insErr) throw new Error(`enqueue: ${insErr.message}`);
      enqueued += chunk.length;
    }

    return json({ ok: true, active: (maps ?? []).length, enqueued, skippedSamePrice, skippedPending, skippedNoCost, note: 'La cola se procesa ~20/min y empuja los precios a ML. Mira el progreso en ml_sync_log.' });
  } catch (e: any) {
    return json({ ok: false, error: e?.message ?? 'unknown' }, 500);
  }
});
