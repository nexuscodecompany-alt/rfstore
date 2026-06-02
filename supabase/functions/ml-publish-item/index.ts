// deno-lint-ignore-file no-explicit-any
// Edge Function: ml-publish-item
// Publica UN producto + variant en Mercado Libre.
// Body: { product_id: string, variant_id: string, dry_run?: boolean }
// Si dry_run=true, devuelve el payload que iba a enviar sin postear.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';
import {
	getValidAccessToken,
	mlFetch,
	getFxRate,
	computeMlPriceUyu,
	descriptionToText,
	parseWarranty,
	extractFromFeatures,
	buildTitle,
} from '../_shared/ml-helpers.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
	auth: { persistSession: false, autoRefreshToken: false },
});

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { ...corsHeaders, 'Content-Type': 'application/json' },
	});

async function logEvent(topic: string, payload: any, errorMsg?: string) {
	try {
		await supabase.from('ml_webhook_events').insert({
			topic,
			resource: 'publish-item',
			payload,
			processing_status: errorMsg ? 'error' : 'done',
			error: errorMsg ?? null,
		});
	} catch (_) { /* no fatal */ }
}

interface Body {
	product_id: string;
	variant_id: string;
	dry_run?: boolean;
}

Deno.serve(async req => {
	if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
	if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

	let body: Body;
	try {
		body = await req.json();
	} catch {
		return json({ ok: false, error: 'invalid_json' }, 400);
	}

	const { product_id, variant_id, dry_run } = body;
	if (!product_id || !variant_id) return json({ ok: false, error: 'missing_product_or_variant_id' }, 400);

	try {
		// 1. Cargar producto + variant + brand
		const { data: product, error: pErr } = await supabase
			.from('products')
			.select('id, name, slug, external_code, price_usd, markup_percent, images, features, description, brand_id, category_id, source, active')
			.eq('id', product_id)
			.single();
		if (pErr || !product) throw new Error(`product_not_found: ${pErr?.message ?? 'null'}`);
		if (!product.active) throw new Error('product_inactive');

		const { data: variant, error: vErr } = await supabase
			.from('variants')
			.select('id, stock, price, color_name, storage')
			.eq('id', variant_id)
			.single();
		if (vErr || !variant) throw new Error(`variant_not_found: ${vErr?.message ?? 'null'}`);

		let brandName: string | null = null;
		if (product.brand_id) {
			const { data: b } = await supabase.from('brands').select('name').eq('id', product.brand_id).single();
			brandName = b?.name ?? null;
		}

		// 2. Cargar settings ML
		const { data: settingsRows } = await supabase
			.from('app_settings')
			.select('key, value')
			.in('key', [
				'ml_markup_percent',
				'ml_stock_threshold',
				'ml_listing_type_default',
				'ml_warranty_months_default',
				'ml_site_id',
				'ml_celulares_category_id',
				'pricing_config',
			]);
		const settings = new Map((settingsRows ?? []).map(r => [r.key, r.value]));
		const markup = Number(settings.get('ml_markup_percent') ?? 30);
		const threshold = Number(settings.get('ml_stock_threshold') ?? 3);
		const listingType = String(settings.get('ml_listing_type_default') ?? 'gold_pro');
		const warrantyDefault = Number(settings.get('ml_warranty_months_default') ?? 6);
		const siteId = String(settings.get('ml_site_id') ?? 'MLU');
		const pricingConfig: any = settings.get('pricing_config') ?? {};
		const ivaPercent = Number(pricingConfig?.iva_percent ?? 22);

		if (Number(variant.stock) <= threshold) {
			throw new Error(`stock_below_threshold (stock=${variant.stock}, threshold=${threshold})`);
		}

		// 3. Auth ML
		const { token } = await getValidAccessToken(supabase);

		// 4. FX rate
		const fxRate = await getFxRate(SUPABASE_URL, SUPABASE_ANON_KEY);

		// 5. Compute price
		const costUsd = Number(product.price_usd);
		if (!costUsd || costUsd <= 0) throw new Error(`invalid_price_usd: ${product.price_usd}`);
		const priceUyu = computeMlPriceUyu({
			cost_usd: costUsd,
			markup_percent: markup,
			iva_percent: ivaPercent,
			fx_rate: fxRate,
		});

		// 6. Build title, description, attrs
		const title = buildTitle(product.name, brandName, 60);
		const descText = descriptionToText(product.description);
		const fullTextForWarranty = `${descText}\n${(product.features ?? []).join('\n')}`;
		const warranty = parseWarranty(fullTextForWarranty, warrantyDefault);
		const featuresExtracted = extractFromFeatures(product.features);

		// 7. Predict ML category
		let mlCategoryId = 'MLU1055';
		try {
			const pred = await mlFetch(
				`/sites/${siteId}/category_predictor/predict?title=${encodeURIComponent(title)}`,
				{ token }
			);
			if (pred.ok && pred.data?.id) {
				mlCategoryId = pred.data.id;
			}
		} catch (_) { /* fallback */ }

		// 8. Build attributes
		const attributes: any[] = [];
		if (brandName) attributes.push({ id: 'BRAND', value_name: brandName });
		if (featuresExtracted.model) attributes.push({ id: 'MODEL', value_name: featuresExtracted.model });
		if (featuresExtracted.gtin) attributes.push({ id: 'GTIN', value_name: featuresExtracted.gtin });
		if (variant.color_name && variant.color_name !== 'Unico') {
			attributes.push({ id: 'COLOR', value_name: variant.color_name });
		}
		if (variant.storage && variant.storage !== '-') {
			attributes.push({ id: 'INTERNAL_MEMORY', value_name: variant.storage });
		}

		// 9. Sale terms (warranty)
		const sale_terms = [
			{
				id: 'WARRANTY_TYPE',
				value_name: warranty.type === 'manufacturer' ? 'Garantía de fábrica' : 'Garantía del vendedor',
			},
			{ id: 'WARRANTY_TIME', value_name: `${warranty.months} meses` },
		];

		// 10. Pictures
		const pictures = (product.images ?? []).slice(0, 12).map((src: string) => ({ source: src }));
		if (pictures.length === 0) throw new Error('no_pictures');

		// 11. Build full ML item payload
		const itemPayload = {
			title,
			category_id: mlCategoryId,
			price: priceUyu,
			currency_id: 'UYU',
			available_quantity: Number(variant.stock),
			buying_mode: 'buy_it_now',
			listing_type_id: listingType,
			condition: 'new',
			description: { plain_text: descText.slice(0, 50000) || title },
			pictures,
			shipping: {
				mode: 'me2',
				local_pick_up: false,
				free_shipping: false,
			},
			attributes,
			sale_terms,
		};

		if (dry_run) {
			return json({
				ok: true,
				dry_run: true,
				payload: itemPayload,
				meta: { fxRate, costUsd, priceUyu, warranty, featuresExtracted, predictedCategory: mlCategoryId },
			});
		}

		// 12. POST a /items
		const post = await mlFetch('/items', { method: 'POST', token, body: itemPayload });
		if (!post.ok) {
			await logEvent(
				'ml_publish_failed',
				{ product_id, variant_id, ml_status: post.status, ml_response: post.data, payload_sent: itemPayload },
				`ml_error_${post.status}: ${JSON.stringify(post.data).slice(0, 300)}`
			);
			return json(
				{ ok: false, error: 'ml_publish_failed', detail: post.data, payload_sent: itemPayload },
				400
			);
		}

		// 13. Guardar mapping
		const mlItem = post.data;
		const { error: mapErr } = await supabase.from('ml_item_mapping').insert({
			product_id,
			variant_id,
			ml_item_id: mlItem.id,
			ml_category_id: mlCategoryId,
			ml_listing_type: listingType,
			status: 'active',
			last_known_stock: Number(variant.stock),
			last_known_price_uyu: priceUyu,
			last_synced_at: new Date().toISOString(),
			permalink: mlItem.permalink ?? null,
		});
		if (mapErr) {
			console.warn('ml_item_mapping insert failed:', mapErr.message);
		}

		await logEvent('ml_publish_success', {
			product_id,
			variant_id,
			ml_item_id: mlItem.id,
			permalink: mlItem.permalink,
			priceUyu,
			stock: variant.stock,
		});

		return json({
			ok: true,
			ml_item_id: mlItem.id,
			permalink: mlItem.permalink,
			category_id: mlCategoryId,
			price_uyu: priceUyu,
			stock: variant.stock,
		});
	} catch (e: any) {
		await logEvent('ml_publish_exception', { product_id, variant_id, stack: e?.stack?.slice(0, 500) }, e?.message);
		return json({ ok: false, error: e?.message ?? 'unknown' }, 500);
	}
});
