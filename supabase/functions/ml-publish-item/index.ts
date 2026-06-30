// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { getValidAccessToken, mlFetch, getFxRate, descriptionToText, parseWarranty, extractFromFeatures, buildTitle, extractAttributesFromText, sanitizeDescription, buildMlDescription } from './ml-helpers.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

async function logEvent(topic: string, payload: any, errorMsg?: string) {
  try { await supabase.from('ml_webhook_events').insert({ topic, resource: 'publish-item', payload, processing_status: errorMsg ? 'error' : 'done', error: errorMsg ?? null }); } catch (_) {}
}

async function uploadPictureToMl(url: string, token: string): Promise<{ id: string } | { error: string }> {
  try {
    const r = await fetch(url);
    if (!r.ok) return { error: `fetch_${r.status}` };
    const blob = await r.blob();
    const form = new FormData();
    form.append('file', blob, 'product.jpg');
    const up = await fetch('https://api.mercadolibre.com/pictures/items/upload', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    const data: any = await up.json().catch(() => ({}));
    if (!up.ok || !data?.id) return { error: `ml_${up.status}: ${JSON.stringify(data).slice(0, 150)}` };
    return { id: data.id };
  } catch (e: any) { return { error: `exc: ${e?.message}` }; }
}

function toPureplainText(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/&[a-zA-Z]+;/g, ' ').replace(/&#\d+;/g, ' ').replace(/[\u0000-\u0008\u000b-\u001f-]/g, '').replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(/[ ]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
}

// Decide currency y calcula price segun threshold del cliente
function computePriceAndCurrency(input: { cost_usd: number; markup_percent: number; iva_percent: number; fx_rate: number; usd_threshold: number; }): { price: number; currency_id: 'USD' | 'UYU'; basis_usd: number } {
  const { cost_usd, markup_percent, iva_percent, fx_rate, usd_threshold } = input;
  const withMarkup = cost_usd * (1 + markup_percent / 100);
  const withIva = withMarkup * (1 + iva_percent / 100);
  if (cost_usd > usd_threshold) {
    // Precio redondo: siempre entero hacia arriba, sin decimales/milesimas
    return { price: Math.ceil(withIva), currency_id: 'USD', basis_usd: withIva };
  }
  return { price: Math.ceil(withIva * fx_rate), currency_id: 'UYU', basis_usd: withIva };
}

function resolveMlMargin(cfg: any, cost: number, categoryId: string | null, subcategoryId: string | null, fallbackMarkup: number): number {
  if (!cfg || typeof cfg !== 'object') return fallbackMarkup;
  const subOv = cfg.subcategory_overrides || {};
  const catOv = cfg.category_overrides || {};
  if (subcategoryId && subOv[subcategoryId] != null) return Number(subOv[subcategoryId]);
  if (categoryId && catOv[categoryId] != null) return Number(catOv[categoryId]);
  const tiers = Array.isArray(cfg.tiers) ? cfg.tiers : [];
  for (const t of tiers) { if (t.max == null) return Number(t.pct); if (cost <= Number(t.max)) return Number(t.pct); }
  return fallbackMarkup;
}

function escapeRegExp(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// MODEL para ML: usamos el "Modelo:" explicito de las features (CDR lo manda en ~80%);
// si no, lo derivamos del nombre (sacando marca y color). Asi MODEL nunca falta.
const MODEL_COLOR_WORDS = ['negro', 'negra', 'blanco', 'blanca', 'azul', 'rojo', 'roja', 'verde', 'amarillo', 'amarilla', 'rosa', 'rosado', 'rosada', 'dorado', 'dorada', 'plateado', 'plateada', 'gris', 'violeta', 'morado', 'morada', 'celeste', 'naranja', 'marron', 'marrón', 'beige', 'turquesa', 'plata', 'silver', 'black', 'white', 'blue', 'red', 'green', 'grey', 'gray'];
function deriveModelFromName(name: string, brand: string | null): string {
  let m = (name || '').trim();
  if (brand) m = m.replace(new RegExp(`\\b${escapeRegExp(brand)}\\b`, 'ig'), ' ');
  const words = m.split(/\s+/).filter(w => w && !MODEL_COLOR_WORDS.includes(w.toLowerCase()));
  const cleaned = words.join(' ').replace(/\s+/g, ' ').trim();
  return (cleaned || (name || '').trim()).slice(0, 60);
}
function resolveModel(explicit: string | undefined, name: string, brand: string | null): string {
  const ex = (explicit ?? '').trim();
  if (ex) return ex.slice(0, 60);
  return deriveModelFromName(name, brand);
}

// Atributos tecnicos (procesador / voltaje) derivados del texto. Se mandan SOLO si la
// categoria de ML los define. Cubre PCs/notebooks, que piden datos del procesador.
function extractTechAttributes(text: string): Record<string, string> {
  const t = (text || '').toLowerCase();
  const out: Record<string, string> = {};
  if (/\bryzen\b|\bathlon\b|\bamd\b/.test(t)) out.PROCESSOR_BRAND = 'AMD';
  else if (/\bcore\s*(ultra\s*)?i[3579]\b|\bcore\s*ultra\b|\bceleron\b|\bpentium\b|\bintel\b/.test(t)) out.PROCESSOR_BRAND = 'Intel';
  let line: string | null = null;
  let model: string | null = null;
  let m: RegExpMatchArray | null;
  if ((m = t.match(/ryzen\s*(?:ai\s*)?([3579])\s*([0-9]{3,4}[a-z]{0,2})?/))) { line = `Ryzen ${m[1]}`; if (m[2]) model = m[2].toUpperCase(); }
  else if ((m = t.match(/core\s*ultra\s*([3579])\s*([0-9]{2,4}[a-z]{0,2})?/))) { line = `Core Ultra ${m[1]}`; if (m[2]) model = m[2].toUpperCase(); }
  else if ((m = t.match(/core\s*(i[3579])[\s-]*([0-9]{3,5}[a-z]{0,2})?/))) { line = `Core ${m[1]}`; if (m[2]) model = m[2].toUpperCase(); }
  else if (/celeron/.test(t)) line = 'Celeron';
  else if (/pentium/.test(t)) line = 'Pentium';
  if (line) out.PROCESSOR_LINE = line;
  if (model) out.PROCESSOR_MODEL = model;
  out.VOLTAGE = /\b110\s*v\b/.test(t) ? '110V' : '220V';
  return out;
}

// Atributos obligatorios de la categoria de ML (para auto-completar / avisar faltantes).
async function getCategoryRequired(catId: string, token: string): Promise<{ ids: Set<string>; required: { id: string; name: string }[] }> {
  try {
    const r = await mlFetch(`/categories/${catId}/attributes`, { token });
    if (!r.ok || !Array.isArray(r.data)) return { ids: new Set(), required: [] };
    const ids = new Set<string>();
    const required: { id: string; name: string }[] = [];
    for (const a of r.data) {
      if (!a?.id) continue;
      ids.add(a.id);
      const tags = a.tags || {};
      // obligatorios que NO completa ML solo (excluimos read_only / fixed / variation).
      if ((tags.required || tags.catalog_required) && !tags.read_only && !tags.fixed && !tags.variation_attribute) {
        required.push({ id: a.id, name: a.name || a.id });
      }
    }
    return { ids, required };
  } catch { return { ids: new Set(), required: [] }; }
}

interface Body { product_id: string; variant_id: string; dry_run?: boolean; }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  let body: Body;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'invalid_json' }, 400); }
  const { product_id, variant_id, dry_run } = body;
  if (!product_id || !variant_id) return json({ ok: false, error: 'missing_product_or_variant_id' }, 400);

  try {
    const { data: product, error: pErr } = await supabase.from('products').select('id, name, slug, external_code, price_usd, images, features, description, brand_id, category_id, subcategory_id, source, active').eq('id', product_id).single();
    if (pErr || !product) throw new Error(`product_not_found: ${pErr?.message ?? 'null'}`);
    if (!product.active) throw new Error('product_inactive');
    const { data: variant, error: vErr } = await supabase.from('variants').select('id, stock, price, color_name, storage').eq('id', variant_id).single();
    if (vErr || !variant) throw new Error(`variant_not_found: ${vErr?.message ?? 'null'}`);
    let brandName: string | null = null;
    if (product.brand_id) {
      const { data: b } = await supabase.from('brands').select('name').eq('id', product.brand_id).single();
      brandName = b?.name ?? null;
    }

    const { data: settingsRows } = await supabase.from('app_settings').select('key, value').in('key', ['ml_markup_percent', 'ml_stock_threshold', 'ml_listing_type_default', 'ml_warranty_months_default', 'ml_site_id', 'pricing_config', 'ml_usd_threshold', 'ml_pricing_config']);
    const settings = new Map((settingsRows ?? []).map((r: any) => [r.key, r.value]));
    const markup = Number(settings.get('ml_markup_percent') ?? 30);
    const threshold = Number(settings.get('ml_stock_threshold') ?? 3);
    const listingType = String(settings.get('ml_listing_type_default') ?? 'bronze');
    const warrantyDefault = Number(settings.get('ml_warranty_months_default') ?? 6);
    const siteId = String(settings.get('ml_site_id') ?? 'MLU');
    const pricingConfig: any = settings.get('pricing_config') ?? {};
    const ivaPercent = Number(pricingConfig?.iva_percent ?? 22);
    const usdThreshold = Number(settings.get('ml_usd_threshold') ?? 100);

    const mlPricingCfg: any = settings.get('ml_pricing_config') ?? null;
    const hasCfg = mlPricingCfg && typeof mlPricingCfg === 'object';
    const effIva = hasCfg && mlPricingCfg.iva_percent != null ? Number(mlPricingCfg.iva_percent) : ivaPercent;
    const effThreshold = hasCfg && mlPricingCfg.usd_threshold != null ? Number(mlPricingCfg.usd_threshold) : usdThreshold;

    if (Number(variant.stock) <= threshold) throw new Error(`stock_below_threshold (stock=${variant.stock}, threshold=${threshold})`);

    const { token } = await getValidAccessToken(supabase);
    const fxRate = await getFxRate(SUPABASE_URL, SUPABASE_ANON_KEY);
    const costUsd = Number(product.price_usd);
    if (!costUsd || costUsd <= 0) throw new Error(`invalid_price_usd: ${product.price_usd}`);

    // El tramo del margen se decide por el costo CON IVA (no el base): los tramos se
    // definen pensando en el precio con IVA. Solo afecta la eleccion del tramo; el precio
    // final se sigue calculando con el costo real (costUsd) en computePriceAndCurrency.
    const ivaCostUsd = costUsd * (1 + effIva / 100);
    const effMargin = resolveMlMargin(mlPricingCfg, ivaCostUsd, product.category_id ?? null, product.subcategory_id ?? null, markup);
    const priceCalc = computePriceAndCurrency({ cost_usd: costUsd, markup_percent: effMargin, iva_percent: effIva, fx_rate: fxRate, usd_threshold: effThreshold });

    const title = buildTitle(product.name, brandName, 60);
    const rawDescText = descriptionToText(product.description);
    const cleanDesc = sanitizeDescription(rawDescText);
    const fullText = `${rawDescText}\n${(product.features ?? []).join('\n')}\n${product.name}`;
    const warranty = parseWarranty(fullText, warrantyDefault);
    const featuresExtracted = extractFromFeatures(product.features);
    const attrsFromText = extractAttributesFromText(product.name, rawDescText);

    let mlCategoryId = 'MLU1055';
    try {
      const pred = await mlFetch(`/sites/${siteId}/domain_discovery/search?q=${encodeURIComponent(title)}&limit=1`, { token });
      if (pred.ok && Array.isArray(pred.data) && pred.data[0]?.category_id) mlCategoryId = pred.data[0].category_id;
    } catch (_) {}

    const modelValue = resolveModel(featuresExtracted.model, product.name, brandName);

    const attributes: any[] = [];
    if (brandName) attributes.push({ id: 'BRAND', value_name: brandName });
    if (modelValue) attributes.push({ id: 'MODEL', value_name: modelValue });
    if (featuresExtracted.gtin) attributes.push({ id: 'GTIN', value_name: featuresExtracted.gtin });
    const color = attrsFromText.color || (variant.color_name && variant.color_name !== 'Unico' ? variant.color_name : null);
    if (color) attributes.push({ id: 'COLOR', value_name: color });
    const internalMemory = attrsFromText.internal_memory || (variant.storage && variant.storage !== '-' ? variant.storage : null);
    if (internalMemory) attributes.push({ id: 'INTERNAL_MEMORY', value_name: internalMemory });
    if (attrsFromText.ram) attributes.push({ id: 'RAM', value_name: attrsFromText.ram });
    if (attrsFromText.is_dual_sim != null) attributes.push({ id: 'IS_DUAL_SIM', value_name: attrsFromText.is_dual_sim ? 'Sí' : 'No' });
    attributes.push({ id: 'CARRIER', value_name: 'Liberado' });

    // Atributos obligatorios de la categoria: auto-completamos los tecnicos que podamos
    // derivar (procesador/voltaje, solo si la categoria los pide) y, si aun faltan
    // obligatorios, avisamos EXACTAMENTE cuales (en vez de un 400 opaco de ML).
    let missingAttrs: { id: string; name: string }[] = [];
    const catReq = await getCategoryRequired(mlCategoryId, token);
    if (catReq.ids.size > 0) {
      const tech = extractTechAttributes(`${product.name}\n${rawDescText}`);
      for (const [id, value_name] of Object.entries(tech)) {
        if (value_name && catReq.ids.has(id) && !attributes.some(a => a.id === id)) attributes.push({ id, value_name });
      }
      const have = new Set(attributes.map(a => a.id));
      missingAttrs = catReq.required.filter(r => !have.has(r.id));
      if (!dry_run && missingAttrs.length > 0) {
        await logEvent('ml_publish_missing_attrs', { product_id, variant_id, category: mlCategoryId, missing: missingAttrs }, missingAttrs.map(x => x.id).join(','));
        // 200 a proposito: el front lee missing_attributes y le dice al cliente que cargar.
        return json({ ok: false, error: 'missing_required_attributes', missing_attributes: missingAttrs, category_id: mlCategoryId }, 200);
      }
    }

    const sale_terms = [
      { id: 'WARRANTY_TYPE', value_name: warranty.type === 'manufacturer' ? 'Garantía de fábrica' : 'Garantía del vendedor' },
      { id: 'WARRANTY_TIME', value_name: `${warranty.months} meses` },
    ];

    const imageUrls = (product.images ?? []).slice(0, 12);
    if (imageUrls.length === 0) throw new Error('no_pictures');
    const uploadedPictureIds: string[] = [];
    const uploadErrors: string[] = [];
    for (const url of imageUrls) {
      const r = await uploadPictureToMl(url, token);
      if ('id' in r) uploadedPictureIds.push(r.id); else uploadErrors.push(`${url}: ${r.error}`);
    }
    if (uploadedPictureIds.length === 0) {
      await logEvent('ml_picture_upload_failed', { product_id, urls: imageUrls, errors: uploadErrors }, uploadErrors.join('; ').slice(0, 300));
      throw new Error(`picture_upload_failed: ${uploadErrors.join('; ').slice(0, 200)}`);
    }
    const pictures = uploadedPictureIds.map(id => ({ id }));

    const builtDesc = buildMlDescription({
      productName: product.name, cleanDesc: toPureplainText(cleanDesc), brand: brandName,
      model: featuresExtracted.model, gtin: featuresExtracted.gtin,
      color, ram: attrsFromText.ram, internalMemory, isDualSim: attrsFromText.is_dual_sim,
      warrantyMonths: warranty.months, warrantyType: warranty.type,
    });
    const finalDescription = toPureplainText(builtDesc);

    const itemPayload = {
      title, category_id: mlCategoryId,
      price: priceCalc.price,
      currency_id: priceCalc.currency_id,
      available_quantity: Number(variant.stock),
      buying_mode: 'buy_it_now', listing_type_id: listingType, condition: 'new',
      pictures,
      description: { plain_text: finalDescription },
      shipping: { mode: 'me2', local_pick_up: false, free_shipping: false },
      attributes, sale_terms,
    };

    if (dry_run) {
      return json({ ok: true, dry_run: true, payload: itemPayload, meta: { fxRate, costUsd, markupPercent: effMargin, usdThreshold: effThreshold, price: priceCalc.price, currency: priceCalc.currency_id, priceUyu: priceCalc.currency_id === 'UYU' ? priceCalc.price : Math.ceil(priceCalc.basis_usd * fxRate), warranty, featuresExtracted, modelValue, attrsFromText, predictedCategory: mlCategoryId, missingAttributes: missingAttrs, uploadedPictureIds, uploadErrors, descriptionPreview: finalDescription, descriptionLength: finalDescription.length } });
    }

    const post = await mlFetch('/items', { method: 'POST', token, body: itemPayload });
    if (!post.ok) {
      await logEvent('ml_publish_failed', { product_id, variant_id, ml_status: post.status, ml_response: post.data, payload_sent: itemPayload }, `ml_error_${post.status}: ${JSON.stringify(post.data).slice(0, 300)}`);
      return json({ ok: false, error: 'ml_publish_failed', detail: post.data, payload_sent: itemPayload }, 400);
    }
    const mlItem = post.data;

    let descCheck: any = null;
    try {
      const dc = await mlFetch(`/items/${mlItem.id}/description`, { token });
      descCheck = { ok: dc.ok, status: dc.status, hasContent: !!dc.data?.plain_text };
      if (!dc.ok || !dc.data?.plain_text) {
        const fb = await mlFetch(`/items/${mlItem.id}/description`, { method: 'POST', token, body: { plain_text: finalDescription } });
        descCheck.fallback = { ok: fb.ok, status: fb.status, error: fb.ok ? null : fb.data };
      }
    } catch (de: any) { descCheck = { ok: false, error: de?.message }; }

    const priceForDb = priceCalc.currency_id === 'UYU' ? priceCalc.price : Math.ceil(priceCalc.basis_usd * fxRate);
    const { error: mapErr } = await supabase.from('ml_item_mapping').insert({
      product_id, variant_id, ml_item_id: mlItem.id, ml_category_id: mlCategoryId, ml_listing_type: listingType,
      status: 'active', last_known_stock: Number(variant.stock), last_known_price_uyu: priceForDb,
      last_synced_at: new Date().toISOString(), permalink: mlItem.permalink ?? null,
    });
    if (mapErr) console.warn('mapping insert:', mapErr.message);

    await logEvent('ml_publish_success', { product_id, variant_id, ml_item_id: mlItem.id, permalink: mlItem.permalink, price: priceCalc.price, currency: priceCalc.currency_id, stock: variant.stock, descCheck, uploadedPictureIds, descriptionLength: finalDescription.length });
    return json({ ok: true, ml_item_id: mlItem.id, permalink: mlItem.permalink, category_id: mlCategoryId, price: priceCalc.price, currency_id: priceCalc.currency_id, stock: variant.stock, description_set: descCheck?.ok, pictures_uploaded: uploadedPictureIds.length });
  } catch (e: any) {
    await logEvent('ml_publish_exception', { product_id, variant_id, stack: e?.stack?.slice(0, 500) }, e?.message);
    return json({ ok: false, error: e?.message ?? 'unknown' }, 500);
  }
});
