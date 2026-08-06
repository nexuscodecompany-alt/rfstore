// deno-lint-ignore-file no-explicit-any
// ml-catalog-sync (2026-08-06): repricia las PUBLICACIONES DE CATALOGO de la cuenta.
//
// Contexto: ML genera publicaciones de catalogo colgadas de una publicacion tradicional
// nuestra. La relacion vive en item_relations (stock_relation) y ML espeja precio y stock
// del padre solo -- verificado: repreciamos el padre MLU694346883 a las 00:17:05 y el hijo
// MLU1465303778 quedo en el mismo precio a las 00:17:07.
//
// El problema: esos hijos NO estan en ml_item_mapping, asi que el panel no los ve. Cuando
// el padre queda BLOQUEADO (under_review / forbidden / pausado) nosotros no le podemos
// tocar el precio, ML no tiene de donde espejar, y el hijo se queda ACTIVO vendiendo con
// el margen viejo. Caso real: MLU1466713836 (Redmi Note 15 Pro) quedo en 526 USD cuando
// las reglas nuevas daban 487, porque su padre MLU1418183296 esta forbidden.
//
// Esta funcion recorre las publicaciones de catalogo, calcula el precio objetivo con las
// MISMAS reglas que ml-reprice-active (tramos + override cat/subcat + umbral USD) y le
// empuja el precio DIRECTO al hijo cuando quedo desalineado. Si el hijo ya coincide no
// hace nada (el 99% del tiempo ML ya lo espejo).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const ML_CLIENT_ID = Deno.env.get('ML_CLIENT_ID')!;
const ML_CLIENT_SECRET = Deno.env.get('ML_CLIENT_SECRET')!;
const ML_TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';
const ML_API_BASE = 'https://api.mercadolibre.com';
// sub_status de ML que bloquean la edicion: si el HIJO esta moderado tampoco se puede tocar.
const MODERATION_SUBSTATUS = ['under_review', 'banned', 'forbidden', 'freezed', 'deleted', 'suspended', 'waiting_for_patch'];

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

async function getToken(): Promise<{ token: string; userId: number }> {
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
    return { token: data.access_token, userId: Number(cred.ml_user_id) };
  }
  return { token: cred.access_token, userId: Number(cred.ml_user_id) };
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

// Misma resolucion de margen que ml-reprice-active / ml-publish-item.
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

async function getFxRate(): Promise<number> {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/get-fx-rate`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } });
  if (!resp.ok) throw new Error(`fx_rate_fetch_failed: ${resp.status}`);
  const j: any = await resp.json();
  const rate = Number(j.rate);
  if (!rate || rate <= 0) throw new Error('invalid_fx_rate');
  return rate;
}

// Todos los item ids del vendedor (scan: paginado por scroll_id, no por offset).
async function scanItemIds(token: string, userId: number): Promise<string[]> {
  const ids: string[] = [];
  let scroll: string | null = null;
  for (let page = 0; page < 60; page++) {
    const q = `/users/${userId}/items/search?search_type=scan&limit=100${scroll ? `&scroll_id=${scroll}` : ''}`;
    const r = await mlReq(q, 'GET', token);
    if (!r.ok) throw new Error(`scan: ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`);
    const batch: string[] = r.data?.results ?? [];
    if (batch.length === 0) break;
    ids.push(...batch);
    scroll = r.data?.scroll_id ?? null;
    if (!scroll) break;
  }
  return ids;
}

async function logSync(row: any): Promise<void> {
  try { await supabase.from('ml_sync_log').insert(row); } catch (_e) { /* best-effort */ }
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
    const cfg: any = settings.get('ml_pricing_config') ?? null;
    const hasCfg = cfg && typeof cfg === 'object';
    const iva = hasCfg && cfg.iva_percent != null ? Number(cfg.iva_percent) : Number(pricingConfig?.iva_percent ?? 22);
    const threshold = hasCfg && cfg.usd_threshold != null ? Number(cfg.usd_threshold) : Number(settings.get('ml_usd_threshold') ?? 100);

    const { token, userId } = await getToken();
    const fx = await getFxRate();

    const ids = await scanItemIds(token, userId);

    // Multiget de a 20 quedandonos solo con las de catalogo.
    const catalog: any[] = [];
    for (let i = 0; i < ids.length; i += 20) {
      const chunk = ids.slice(i, i + 20).join(',');
      const r = await mlReq(`/items?ids=${chunk}&attributes=id,title,price,currency_id,status,sub_status,catalog_listing,item_relations`, 'GET', token);
      if (!r.ok) continue;
      for (const b of r.data ?? []) {
        if (b?.code === 200 && b?.body?.catalog_listing === true) catalog.push(b.body);
      }
    }

    const report: any[] = [];
    let updated = 0, inSync = 0, skipped = 0, failed = 0;

    for (const it of catalog) {
      const parentId: string | null = it.item_relations?.[0]?.id ?? null;
      const sub: string[] = Array.isArray(it.sub_status) ? it.sub_status.map((s: any) => String(s)) : [];
      const base = { ml_item_id: it.id, operation: 'update_price', source: 'catalog_sync', old_ml_status: it.status };

      // De donde sale el costo: si la publicacion de catalogo cuelga de una nuestra, del
      // padre; si la publicamos nosotros directo en catalogo, de su propio mapping.
      const refId: string = parentId ?? it.id;

      // Si ML moderó al HIJO, el precio esta bloqueado igual que en el padre.
      if (MODERATION_SUBSTATUS.some(f => sub.includes(f)) || it.status === 'under_review' || it.status === 'closed') {
        skipped++; report.push({ id: it.id, title: it.title, action: 'moderada', detail: `${it.status} ${JSON.stringify(sub)}` });
        await logSync({ ...base, action: 'catalog_skipped_moderated', result: 'ok', error: `status=${it.status} sub=${JSON.stringify(sub)}` });
        continue;
      }

      const { data: map } = await supabase.from('ml_item_mapping').select('product_id, variant_id, products(price_usd, category_id, subcategory_id)').eq('ml_item_id', refId).maybeSingle();
      const prod: any = (map as any)?.products;
      const cost = Number(prod?.price_usd);
      if (!map || !cost || cost <= 0) {
        skipped++; report.push({ id: it.id, title: it.title, action: 'sin_costo', parent: parentId ?? undefined });
        await logSync({ ...base, action: 'catalog_no_mapping', result: 'ok', error: `${refId} sin mapping o sin costo en RF` });
        continue;
      }

      const ivaCost = cost * (1 + iva / 100);
      const margin = resolveMlMargin(cfg, ivaCost, prod?.category_id ?? null, prod?.subcategory_id ?? null, fallbackMarkup);
      const calc = computePriceAndCurrency(cost, margin, iva, fx, threshold);

      if (Number(it.price) === calc.price && it.currency_id === calc.currency_id) {
        inSync++; report.push({ id: it.id, title: it.title, action: 'ok', price: calc.price, currency: calc.currency_id });
        continue;
      }

      if (dryRun) {
        updated++; report.push({ id: it.id, title: it.title, action: 'corregiria', from: `${it.price} ${it.currency_id}`, to: `${calc.price} ${calc.currency_id}`, parent: parentId });
        continue;
      }

      const r = await mlReq(`/items/${it.id}`, 'PUT', token, { price: calc.price, currency_id: calc.currency_id });
      if (!r.ok) {
        failed++;
        const err = `${r.status}: ${JSON.stringify(r.data).slice(0, 250)}`;
        report.push({ id: it.id, title: it.title, action: 'error', from: `${it.price} ${it.currency_id}`, to: `${calc.price} ${calc.currency_id}`, error: err });
        await logSync({ ...base, variant_id: (map as any).variant_id, action: 'catalog_price_update', result: 'error', error: err });
        continue;
      }
      updated++;
      report.push({ id: it.id, title: it.title, action: 'corregida', from: `${it.price} ${it.currency_id}`, to: `${calc.price} ${calc.currency_id}`, parent: parentId });
      await logSync({ ...base, variant_id: (map as any).variant_id, action: 'catalog_price_updated', new_ml_status: it.status, result: 'ok', error: `${it.price} ${it.currency_id} -> ${calc.price} ${calc.currency_id}` });
    }

    return json({ ok: true, dry_run: dryRun, scanned: ids.length, catalog: catalog.length, updated, inSync, skipped, failed, report });
  } catch (e: any) {
    return json({ ok: false, error: e?.message ?? 'unknown' }, 500);
  }
});
