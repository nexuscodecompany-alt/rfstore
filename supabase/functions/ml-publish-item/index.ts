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
    // ML acepta hasta 2 decimales en USD
    return { price: Math.round(withIva * 100) / 100, currency_id: 'USD', basis_usd: withIva };
  }
  return { price: Math.round(withIva * fx_rate), currency_id: 'UYU', basis_usd: withIva };
}

// Margen ML configurable: subcategoria > categoria > tramo por costo.
// Si no hay ml_pricing_config, cae al margen plano historico (fallbackMarkup).
function resolveMlMargin(cfg: any, cost: number, categoryId: string | null, subcategoryId: string | null, fallbackMarkup: number): number {
  if (!cfg || typeof cfg !== 'object') return fallbackMarkup;
  const subOv = cfg.subcategory_overrides || {};
  const catOv = cfg.category_overrides || {};
  if (subcategoryId && subOv[subcategoryId] != null) return Number(subOv[subcategoryId]);
  if (categoryId && catOv[categoryId] != null) return Number(catOv[categoryId]);
  const tiers = Array.isArray(cfg.tiers) ? cfg.tiers : [];
  for (const t of tiers) { if (t.max == null) return Number(t.pct); if (cost < Number(t.max)) return Number(t.pct); }
  return fallbackMarkup;
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

    // Reglas de margen ML (tramos + override categoria/subcategoria). Sin config => 30% plano.
    const mlPricingCfg: any = settings.get('ml_pricing_config') ?? null;
    const hasCfg = mlPricingCfg && typeof mlPricingCfg === 'object';
    const effIva = hasCfg && mlPricingCfg.iva_percent != null ? Number(mlPricingCfg.iva_percent) : ivaPercent;
    const effThreshold = hasCfg && mlPricingCfg.usd_threshold != null ? Number(mlPricingCfg.usd_threshold) : usdThreshold;

    if (Number(variant.stock) <= threshold) throw new Error(`stock_below_threshold (stock=${variant.stock}, threshold=${threshold})`);

    const { token } = await getValidAccessToken(supabase);
    const fxRate = await getFxRate(SUPABASE_URL, SUPABASE_ANON_KEY);
    const costUsd = Number(product.price_usd);
    if (!costUsd || costUsd <= 0) throw new Error(`invalid_price_usd: ${product.price_usd}`);

    const effMargin = resolveMlMargin(mlPricingCfg, costUsd, product.category_id ?? null, product.subcategory_id ?? null, markup);
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

    const attributes: any[] = [];
    if (brandName) attributes.push({ id: 'BRAND', value_name: brandName });
    if (featuresExtracted.model) attributes.push({ id: 'MODEL', value_name: featuresExtracted.model });
    if (featuresExtracted.gtin) attributes.push({ id: 'GTIN', value_name: featuresExtracted.gtin });
    const color = attrsFromText.color || (variant.color_name && variant.color_name !== 'Unico' ? variant.color_name : null);
    if (color) attributes.push({ id: 'COLOR', value_name: color });
    const internalMemory = attrsFromText.internal_memory || (variant.storage && variant.storage !== '-' ? variant.storage : null);
    if (internalMemory) attributes.push({ id: 'INTERNAL_MEMORY', value_name: internalMemory });
    if (attrsFromText.ram) attributes.push({ id: 'RAM', value_name: attrsFromText.ram });
    if (attrsFromText.is_dual_sim != null) attributes.push({ id: 'IS_DUAL_SIM', value_name: attrsFromText.is_dual_sim ? 'Sí' : 'No' });
    attributes.push({ id: 'CARRIER', value_name: 'Liberado' });

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
      return json({ ok: true, dry_run: true, payload: itemPayload, meta: { fxRate, costUsd, markupPercent: effMargin, usdThreshold: effThreshold, price: priceCalc.price, currency: priceCalc.currency_id, priceUyu: priceCalc.currency_id === 'UYU' ? priceCalc.price : Math.round(priceCalc.basis_usd * fxRate), warranty, featuresExtracted, attrsFromText, predictedCategory: mlCategoryId, uploadedPictureIds, uploadErrors, descriptionPreview: finalDescription, descriptionLength: finalDescription.length } });
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

    const priceForDb = priceCalc.currency_id === 'UYU' ? priceCalc.price : Math.round(priceCalc.basis_usd * fxRate);
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
