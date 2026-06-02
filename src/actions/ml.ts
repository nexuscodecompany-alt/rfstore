import { supabase } from '../supabase/client';

// --------- OAuth ---------
// El user-flow es: redirigimos al admin a https://auth.mercadolibre.com.uy/authorization?...
// ML pide consentimiento y nos devuelve a /api/ml/oauth/callback con ?code=...&state=...
// Esa Vercel API route llama a la Edge Function ml-oauth-exchange y nos rebota al dashboard.

const ML_AUTH_BASE = 'https://auth.mercadolibre.com.uy/authorization';
// Strip trailing slash de la env var para evitar `//functions` (rompe el match exacto del redirect_uri en ML)
const SUPABASE_URL = (import.meta.env.VITE_PROJECT_URL_SUPABASE as string).replace(/\/+$/, '');
// Callback handler en Supabase Edge Function (no en Vercel) — Vite SPA no expone /api routes.
const ML_REDIRECT_URI = `${SUPABASE_URL}/functions/v1/ml-oauth-callback`;

export const buildMlAuthUrl = async (): Promise<string> => {
	const { data: appIdSetting } = await supabase
		.from('app_settings')
		.select('value')
		.eq('key', 'ml_app_id')
		.single();
	const appId = (appIdSetting?.value as string) ?? '6693327643893490';
	const state = crypto.randomUUID();
	sessionStorage.setItem('ml_oauth_state', state);
	const params = new URLSearchParams({
		response_type: 'code',
		client_id: appId,
		redirect_uri: ML_REDIRECT_URI,
		state,
	});
	return `${ML_AUTH_BASE}?${params.toString()}`;
};

export interface MlCredential {
	id: number;
	ml_user_id: number;
	ml_nickname: string | null;
	token_type: string | null;
	scope: string | null;
	expires_at: string;
	created_at: string;
	updated_at: string;
}

export const getMlCredential = async (): Promise<MlCredential | null> => {
	const { data, error } = await supabase
		.from('ml_credentials')
		.select('id, ml_user_id, ml_nickname, token_type, scope, expires_at, created_at, updated_at')
		.order('id', { ascending: false })
		.limit(1)
		.maybeSingle();
	if (error) throw new Error(error.message);
	return (data as MlCredential | null) ?? null;
};

export const disconnectMl = async (): Promise<void> => {
	const { error } = await supabase.from('ml_credentials').delete().neq('id', 0);
	if (error) throw new Error(error.message);
};

// --------- Settings ---------
export interface MlSettings {
	markup_percent: number;
	stock_threshold: number;
	listing_type_default: string;
	warranty_months_default: number;
	warranty_type_default: 'seller' | 'manufacturer' | 'none';
	celulares_category_id: string;
	site_id: string;
	seller_address: {
		street?: string;
		number?: string;
		city?: string;
		state?: string;
		zip?: string;
		country?: string;
	} | null;
}

const SETTING_KEYS = {
	markup_percent: 'ml_markup_percent',
	stock_threshold: 'ml_stock_threshold',
	listing_type_default: 'ml_listing_type_default',
	warranty_months_default: 'ml_warranty_months_default',
	warranty_type_default: 'ml_warranty_type_default',
	celulares_category_id: 'ml_celulares_category_id',
	site_id: 'ml_site_id',
	seller_address: 'ml_seller_address',
} as const;

export const getMlSettings = async (): Promise<MlSettings> => {
	const keys = Object.values(SETTING_KEYS);
	const { data, error } = await supabase
		.from('app_settings')
		.select('key, value')
		.in('key', keys);
	if (error) throw new Error(error.message);
	const map = new Map((data ?? []).map(r => [r.key, r.value]));
	return {
		markup_percent: Number(map.get(SETTING_KEYS.markup_percent) ?? 30),
		stock_threshold: Number(map.get(SETTING_KEYS.stock_threshold) ?? 3),
		listing_type_default: String(map.get(SETTING_KEYS.listing_type_default) ?? 'gold_pro'),
		warranty_months_default: Number(map.get(SETTING_KEYS.warranty_months_default) ?? 6),
		warranty_type_default:
			(map.get(SETTING_KEYS.warranty_type_default) as MlSettings['warranty_type_default']) ??
			'seller',
		celulares_category_id: String(map.get(SETTING_KEYS.celulares_category_id) ?? ''),
		site_id: String(map.get(SETTING_KEYS.site_id) ?? 'MLU'),
		seller_address: (map.get(SETTING_KEYS.seller_address) as MlSettings['seller_address']) ?? null,
	};
};

export const updateMlSetting = async <K extends keyof typeof SETTING_KEYS>(
	field: K,
	value: unknown
): Promise<void> => {
	const key = SETTING_KEYS[field];
	const { error } = await supabase
		.from('app_settings')
		.upsert({ key, value: value as never, updated_at: new Date().toISOString() });
	if (error) throw new Error(error.message);
};

// --------- Stats ---------
// --------- Publicación ---------
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_API_KEY;

async function invokeMlFn<T>(name: string, body: unknown): Promise<T> {
	const { data: { session } } = await supabase.auth.getSession();
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		apikey: SUPABASE_ANON,
	};
	headers.Authorization = `Bearer ${session?.access_token ?? SUPABASE_ANON}`;
	const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
		method: 'POST',
		headers,
		body: JSON.stringify(body),
	});
	const json = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(json.error || json.detail || `Error ${res.status} en ${name}`);
	return json as T;
}

export interface PublishResult {
	ok: boolean;
	ml_item_id?: string;
	permalink?: string;
	category_id?: string;
	price_uyu?: number;
	stock?: number;
	error?: string;
	detail?: unknown;
	payload_sent?: unknown;
}

export interface DryRunResult {
	ok: boolean;
	dry_run: true;
	payload: unknown;
	meta: {
		fxRate: number;
		costUsd: number;
		priceUyu: number;
		warranty: { months: number; type: string; source: string };
		featuresExtracted: { gtin?: string; model?: string; nro_parte?: string };
		attrsFromText?: { color?: string; ram?: string; internal_memory?: string; is_dual_sim?: boolean };
		predictedCategory: string;
	};
}

export const publishMlItem = (product_id: string, variant_id: string, dry_run = false) =>
	invokeMlFn<PublishResult | DryRunResult>('ml-publish-item', { product_id, variant_id, dry_run });

export interface PublishableProduct {
	id: string;
	name: string;
	slug: string;
	external_code: string;
	price_usd: number | null;
	images: string[];
	variant_id: string;
	stock: number;
	already_published: boolean;
	ml_item_id: string | null;
}

export const getPublishableCelulares = async (): Promise<PublishableProduct[]> => {
	const settings = await getMlSettings();
	const threshold = settings.stock_threshold;
	const catId = settings.celulares_category_id;
	if (!catId) return [];

	// Solo smartphones — excluimos cables, smartwatches, powerbanks
	const { data: subcat } = await supabase
		.from('subcategories')
		.select('id')
		.eq('category_id', catId)
		.ilike('name', '%smartphone%')
		.maybeSingle();

	let query = supabase
		.from('products')
		.select('id, name, slug, external_code, price_usd, images, active, source, category_id, subcategory_id, variants(id, stock)')
		.eq('category_id', catId)
		.eq('active', true)
		.eq('source', 'cdr');
	if (subcat?.id) query = query.eq('subcategory_id', subcat.id);
	const { data, error } = await query;
	if (error) throw new Error(error.message);

	const { data: mappings } = await supabase
		.from('ml_item_mapping')
		.select('product_id, ml_item_id, status');
	const publishedMap = new Map((mappings ?? []).map(m => [m.product_id, m]));

	const rows: PublishableProduct[] = [];
	for (const p of data ?? []) {
		const variants = (p as { variants: { id: string; stock: number }[] }).variants ?? [];
		const v = variants[0];
		if (!v) continue;
		if (Number(v.stock) <= threshold) continue;
		const published = publishedMap.get(p.id);
		rows.push({
			id: p.id,
			name: p.name,
			slug: p.slug,
			external_code: p.external_code ?? '',
			price_usd: p.price_usd as number | null,
			images: (p.images ?? []) as string[],
			variant_id: v.id,
			stock: Number(v.stock),
			already_published: !!published && published.status === 'active',
			ml_item_id: published?.ml_item_id ?? null,
		});
	}
	rows.sort((a, b) => Number(a.already_published) - Number(b.already_published) || b.stock - a.stock);
	return rows;
};

export interface MlStats {
	published: number;
	paused: number;
	closed: number;
	error: number;
	total: number;
	publishable_celulares: number;
}

export const getMlStats = async (): Promise<MlStats> => {
	const settings = await getMlSettings();
	const threshold = settings.stock_threshold;
	const catId = settings.celulares_category_id;

	const { data: itemRows } = await supabase
		.from('ml_item_mapping')
		.select('status');

	const counts = { published: 0, paused: 0, closed: 0, error: 0 };
	for (const r of itemRows ?? []) {
		const s = (r as { status: string }).status;
		if (s === 'active') counts.published++;
		else if (s === 'paused') counts.paused++;
		else if (s === 'closed') counts.closed++;
		else if (s === 'error') counts.error++;
	}

	// Cuántos celulares cumplen el umbral y todavía no están publicados
	let publishable = 0;
	if (catId) {
		const { count } = await supabase
			.from('products')
			.select('id, variants!inner(stock)', { count: 'exact', head: true })
			.eq('category_id', catId)
			.eq('active', true)
			.eq('source', 'cdr')
			.gt('variants.stock', threshold);
		publishable = count ?? 0;
	}

	return {
		...counts,
		total: (itemRows ?? []).length,
		publishable_celulares: publishable,
	};
};
