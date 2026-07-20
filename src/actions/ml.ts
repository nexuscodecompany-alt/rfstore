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

// Un atributo obligatorio que ML pide y que el producto no tiene: viene con su definición
// (value_type + valores permitidos) para poder armar el input del form manual.
export interface MlMissingAttr {
	id: string;
	name: string;
	value_type?: string;
	values?: { id?: string; name?: string }[];
}

// Valor de atributo que el admin carga a mano y mandamos a ML.
export interface MlAttrInput {
	id: string;
	value_id?: string;
	value_name?: string;
}

export interface PublishResult {
	ok: boolean;
	ml_item_id?: string;
	permalink?: string;
	category_id?: string;
	price_uyu?: number;
	stock?: number;
	error?: string;
	// Motivo literal que devolvió ML al rechazar (sus `cause[].message` concatenados).
	ml_message?: string;
	detail?: unknown;
	payload_sent?: unknown;
	// Atributos obligatorios de la categoría ML que faltan (para armar el form manual).
	missing_attributes?: MlMissingAttr[];
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

// Publica en ML. OJO: NO usamos invokeMlFn acá porque ese tira error en !res.ok y descarta
// el body; nosotros necesitamos leer el body del 400 (trae missing_attributes para el form).
// extra_attributes = valores que el admin cargó a mano en el form manual.
export const publishMlItem = async (
	product_id: string,
	variant_id: string,
	opts: { dry_run?: boolean; extra_attributes?: MlAttrInput[] } = {}
): Promise<PublishResult | DryRunResult> => {
	const { data: { session } } = await supabase.auth.getSession();
	const res = await fetch(`${SUPABASE_URL}/functions/v1/ml-publish-item`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			apikey: SUPABASE_ANON,
			Authorization: `Bearer ${session?.access_token ?? SUPABASE_ANON}`,
		},
		body: JSON.stringify({
			product_id,
			variant_id,
			dry_run: opts.dry_run ?? false,
			extra_attributes: opts.extra_attributes,
		}),
	});
	const json = await res.json().catch(() => ({}));
	// Devolvemos el body tal cual (incluso en 400): el hook decide según ok / missing_attributes.
	return json as PublishResult | DryRunResult;
};

// --------- Actualizar contenido (título + descripción) de una publicación ML existente ---------
export interface UpdateMlContentResult {
	ok: boolean;
	ml_item_id?: string;
	title?: string;
	title_updated?: boolean;
	description_updated?: boolean;
	error?: string;
	ml_status?: string;
	sub_status?: string[];
	detail?: unknown;
	desc_error?: unknown;
}

// Empuja a ML el título + descripción actuales del producto (que se sincronizan de CDR).
// Disparo MANUAL desde el panel (botón "Actualizar en ML"). No toca precio/stock.
export const updateMlContent = (product_id: string, variant_id?: string) =>
	invokeMlFn<UpdateMlContentResult>('ml-update-content', { product_id, variant_id });

// --------- Readiness (% real listo para ML) ---------
export interface ReadinessResult {
	ok: boolean;
	product_id?: string;
	percent?: number;
	missing?: string[];
	category_id?: string | null;
	error?: string;
}

// Recalcula y guarda el % real de un producto (consulta categoría + atributos en ML).
export const recalcMlReadiness = (product_id: string) =>
	invokeMlFn<ReadinessResult>('ml-readiness', { product_id });

// Recalcula varios (ej: la página actual del listado). El backend procesa hasta 60.
export const recalcMlReadinessIds = (product_ids: string[]) =>
	invokeMlFn<{ ok: boolean; processed: number; results: ReadinessResult[] }>('ml-readiness', {
		product_ids,
	});

export interface RepriceResult {
	ok: boolean;
	active?: number;
	enqueued?: number;
	would_enqueue?: number;
	skippedSamePrice?: number;
	dry_run?: boolean;
	error?: string;
}

// Recalcula el precio de TODAS las publicaciones activas según ml_pricing_config
// y las encola para empujar a ML (la cola procesa ~20/min). dry_run no encola.
export const repriceActiveMl = (dry_run = false) =>
	invokeMlFn<RepriceResult>('ml-reprice-active', { dry_run });

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

export interface PublishablePendingRow extends PublishableProduct {
	brand_name: string | null;
	subcategory_name: string | null;
	category_name: string | null;
}

// Nueva: TODOS los publicables pendientes de vincular (cumplen normas, no publicados aun).
// Aplica filtros de whitelist + blacklist + ml_skip a nivel SQL.
export const getPublishablePending = async (): Promise<PublishablePendingRow[]> => {
	const { data, error } = await (supabase.rpc as unknown as (fn: string) => Promise<{ data: any[]; error: { message: string } | null }>)('get_ml_publishable_pending');
	if (error) throw new Error(error.message);
	return (data ?? []).map(r => ({
		id: r.product_id,
		name: r.product_name,
		slug: r.product_slug,
		external_code: r.p_external_code ?? '',
		price_usd: r.p_price_usd as number | null,
		images: (r.p_images ?? []) as string[],
		variant_id: r.p_variant_id,
		stock: Number(r.p_stock),
		already_published: false,
		ml_item_id: null,
		brand_name: r.p_brand_name,
		subcategory_name: r.p_subcategory_name,
		category_name: r.p_category_name,
	}));
};

// Backwards-compat (usado en tests / nombres viejos)
export const getPublishableCelulares = getPublishablePending;

// --------- Publicados ---------
export interface MlPublishedItem {
	id: number;
	ml_item_id: string;
	ml_category_id: string;
	ml_listing_type: string;
	status: 'draft' | 'active' | 'paused' | 'closed' | 'error';
	last_known_stock: number | null;
	last_known_price_uyu: number | null;
	last_synced_at: string | null;
	last_error: string | null;
	permalink: string | null;
	created_at: string;
	product_id: string;
	product_name: string;
	product_slug: string;
	product_external_code: string;
	product_image: string | null;
}

// --------- Batch / Queue ---------
export interface QueueStats {
	pending: number;
	processing: number;
	done: number;
	error: number;
	last_run?: { taken: number; succeeded?: number; ok?: number; failed: number; elapsed_s: number; at: string } | null;
	stock_monitor?: { items_checked?: number; deltas_found?: number; stock_updates?: number; elapsed_s?: number; at?: string } | null;
}

export const getQueueStats = async (): Promise<QueueStats> => {
	const { data: rows } = await supabase.from('ml_sync_queue').select('status, operation');
	const stats: QueueStats = { pending: 0, processing: 0, done: 0, error: 0 };
	for (const r of rows ?? []) {
		const s = (r as { status: string; operation: string }).status;
		if (s === 'pending') stats.pending++;
		else if (s === 'processing') stats.processing++;
		else if (s === 'done') stats.done++;
		else if (s === 'error') stats.error++;
	}
	const { data: settings } = await supabase
		.from('app_settings')
		.select('key, value')
		.in('key', ['ml_batch_last_run', 'ml_stock_monitor_last_run']);
	const map = new Map((settings ?? []).map(r => [r.key, r.value]));
	stats.last_run = (map.get('ml_batch_last_run') as QueueStats['last_run']) ?? null;
	stats.stock_monitor = (map.get('ml_stock_monitor_last_run') as QueueStats['stock_monitor']) ?? null;
	return stats;
};

export const enqueuePublishBatch = async (subcategoryNameLike: string | null = '%smartphone%', skipBrands: string[] = ['Apple']): Promise<number> => {
	// Cast porque la funcion RPC fue creada via SQL y los types no se regeneraron
	const { data, error } = await (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(
		'enqueue_ml_publish_batch',
		{ p_subcat_name: subcategoryNameLike, p_skip_brands: skipBrands }
	);
	if (error) throw new Error(error.message);
	return Number(data) || 0;
};

export const triggerPublishQueueNow = async (): Promise<void> => {
	const { data: { session } } = await supabase.auth.getSession();
	await fetch(`${SUPABASE_URL}/functions/v1/ml-process-publish-queue`, {
		method: 'POST',
		headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${session?.access_token ?? SUPABASE_ANON}` },
	});
};

export const getMlPublishedItems = async (): Promise<MlPublishedItem[]> => {
	const { data, error } = await supabase
		.from('ml_item_mapping')
		.select('id, ml_item_id, ml_category_id, ml_listing_type, status, last_known_stock, last_known_price_uyu, last_synced_at, last_error, permalink, created_at, product_id, products(name, slug, external_code, images)')
		.order('created_at', { ascending: false });
	if (error) throw new Error(error.message);
	return (data ?? []).map((row: any) => ({
		id: row.id,
		ml_item_id: row.ml_item_id,
		ml_category_id: row.ml_category_id,
		ml_listing_type: row.ml_listing_type,
		status: row.status,
		last_known_stock: row.last_known_stock,
		last_known_price_uyu: row.last_known_price_uyu,
		last_synced_at: row.last_synced_at,
		last_error: row.last_error,
		permalink: row.permalink,
		created_at: row.created_at,
		product_id: row.product_id,
		product_name: row.products?.name ?? '',
		product_slug: row.products?.slug ?? '',
		product_external_code: row.products?.external_code ?? '',
		product_image: row.products?.images?.[0] ?? null,
	}));
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

// --------- Vinculación manual: publicaciones ML existentes ↔ productos RF ---------
export interface MlUnlinkedItem {
	ml_item_id: string;
	title: string;
	price: number;
	currency: string;
	stock: number;
	thumbnail: string | null;
	permalink: string;
	status: string;
	category_id: string;
	brand: string | null;
	model: string | null;
}

export interface MlListResponse {
	ok: boolean;
	total_in_ml: number;
	unlinked_count: number;
	items: MlUnlinkedItem[];
	error?: string;
}

export const listMlUnlinkedItems = async (status: 'active' | 'paused' | 'closed' | 'all' = 'active'): Promise<MlListResponse> => {
	const { data: { session } } = await supabase.auth.getSession();
	const resp = await fetch(`${SUPABASE_URL}/functions/v1/ml-list-my-items`, {
		method: 'POST',
		headers: {
			apikey: SUPABASE_ANON,
			Authorization: `Bearer ${session?.access_token ?? SUPABASE_ANON}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ status }),
	});
	const data = await resp.json();
	if (!resp.ok || !data.ok) throw new Error(data?.error ?? `http_${resp.status}`);
	return data;
};

export interface AutolinkResult {
	ok: boolean;
	dry_run: boolean;
	total_in_ml: number;
	unlinked_before: number;
	linked_count: number;
	ambiguous_count: number;
	nomatch_count: number;
	linked: { ml_item_id: string; title: string; product: string }[];
	ambiguous: { ml_item_id: string; title: string; candidates: number }[];
	nomatch: { ml_item_id: string; title: string; reason?: string }[];
}

// Vincula automáticamente, por nombre, las publicaciones ML que el cliente subió
// desde RF Store y quedaron sin vincular. Solo vincula matches inequívocos.
export const autolinkMlByName = async (dryRun = false): Promise<AutolinkResult> => {
	const { data: { session } } = await supabase.auth.getSession();
	const resp = await fetch(`${SUPABASE_URL}/functions/v1/ml-autolink-by-name`, {
		method: 'POST',
		headers: {
			apikey: SUPABASE_ANON,
			Authorization: `Bearer ${session?.access_token ?? SUPABASE_ANON}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ dry_run: dryRun }),
	});
	const data = await resp.json();
	if (!resp.ok || !data.ok) throw new Error(data?.error ?? `http_${resp.status}`);
	return data as AutolinkResult;
};

export interface RfProductCandidate {
	product_id: string;
	product_name: string;
	product_slug: string;
	external_code: string | null;
	price_usd: number | null;
	image_url: string | null;
	variant_id: string;
	stock: number;
	brand_name: string | null;
	category_name: string | null;
}

export const searchRfProductsUnlinked = async (search: string, limit = 30): Promise<RfProductCandidate[]> => {
	const { data, error } = await (supabase.rpc as any)('search_rf_products_unlinked', {
		p_search: search.trim(),
		p_limit: limit,
	});
	if (error) throw new Error(error.message);
	return (data ?? []) as RfProductCandidate[];
};

export const linkMlItemToProduct = async (params: {
	ml_item_id: string;
	product_id: string;
	variant_id: string;
	ml_category_id?: string;
	permalink?: string;
	current_stock?: number;
}): Promise<string> => {
	const { data, error } = await (supabase.rpc as any)('link_ml_item_to_product', {
		p_ml_item_id: params.ml_item_id,
		p_product_id: params.product_id,
		p_variant_id: params.variant_id,
		p_ml_category_id: params.ml_category_id ?? null,
		p_permalink: params.permalink ?? null,
		p_current_stock: params.current_stock ?? null,
	});
	if (error) throw new Error(error.message);
	return String(data);
};

export const unlinkMlItem = async (ml_item_id: string): Promise<void> => {
	const { error } = await (supabase.rpc as any)('unlink_ml_item', { p_ml_item_id: ml_item_id });
	if (error) throw new Error(error.message);
};
