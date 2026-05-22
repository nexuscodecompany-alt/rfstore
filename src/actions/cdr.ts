import { supabase } from '../supabase/client';

const SUPABASE_URL = import.meta.env.VITE_PROJECT_URL_SUPABASE;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_API_KEY;

async function invokeFn<T>(name: string, body: unknown): Promise<T> {
	const {
		data: { session },
	} = await supabase.auth.getSession();

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		apikey: SUPABASE_ANON,
	};
	if (session?.access_token) {
		headers.Authorization = `Bearer ${session.access_token}`;
	} else {
		headers.Authorization = `Bearer ${SUPABASE_ANON}`;
	}

	const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
		method: 'POST',
		headers,
		body: JSON.stringify(body),
	});

	const json = await res.json().catch(() => ({}));
	if (!res.ok) {
		throw new Error(json.error || `Error ${res.status} en ${name}`);
	}
	return json as T;
}

export interface SyncReport {
	ok: boolean;
	fetched: number;
	inserted: number;
	updated: number;
	images_downloaded: number;
	images_skipped: number;
	errors: string[];
	since: string;
	finished_at: string;
}

export const triggerCdrSync = (full = false) =>
	invokeFn<SyncReport>('cdr-sync-products', { full });

export interface CheckStockResult {
	ok: boolean;
	stocks: { codigo: string; stock: number }[];
	insufficient: string[];
	missing: string[];
	error?: string;
}

export const checkCdrStock = (
	codes: string[],
	qty: Record<string, number> = {}
) => invokeFn<CheckStockResult>('cdr-check-stock', { codes, qty });

export interface CartItemForMP {
	external_code: string;
	variant_id: string;
	quantity: number;
	title: string;
	unit_price_usd: number;
}

export interface CreatePreferenceResult {
	order_id: number;
	preference_id: string;
	init_point: string;
	sandbox_init_point: string;
}

export const createMpPreference = (payload: {
	items: CartItemForMP[];
	address: {
		line1: string;
		line2?: string;
		city: string;
		state: string;
		postal_code: string;
		country: string;
	};
	customer_email?: string;
	customer_name?: string;
}) => invokeFn<CreatePreferenceResult>('mp-create-preference', payload);

export const confirmManualPayment = (orderId: number, action: 'approve' | 'reject') =>
	invokeFn<{ ok: boolean }>('manual-payment-confirm', {
		order_id: orderId,
		action,
	});

export const getAppSettings = async () => {
	const { data, error } = await supabase.from('app_settings').select('key, value');
	if (error) throw new Error(error.message);
	const map = new Map(data.map(r => [r.key, r.value]));
	return map;
};

export const updateAppSetting = async (key: string, value: unknown) => {
	const { error } = await supabase.from('app_settings').upsert({
		key,
		value: value as never,
		updated_at: new Date().toISOString(),
	});
	if (error) throw new Error(error.message);
};

export const uploadPaymentProof = async (orderId: number, file: File) => {
	const path = `${orderId}/${Date.now()}-${file.name}`;
	const { error: upErr } = await supabase.storage
		.from('payment-proofs')
		.upload(path, file, { upsert: true });
	if (upErr) throw new Error(upErr.message);

	const { data: signed } = await supabase.storage
		.from('payment-proofs')
		.createSignedUrl(path, 60 * 60 * 24 * 7);

	const { error: orderErr } = await supabase
		.from('orders')
		.update({ payment_proof_url: path, payment_status: 'pending' })
		.eq('id', orderId);
	if (orderErr) throw new Error(orderErr.message);

	return { path, signedUrl: signed?.signedUrl ?? null };
};

export const getPaymentProofSignedUrl = async (path: string) => {
	const { data, error } = await supabase.storage
		.from('payment-proofs')
		.createSignedUrl(path, 60 * 60);
	if (error) throw new Error(error.message);
	return data.signedUrl;
};

export const getPendingPaymentOrders = async () => {
	const { data, error } = await supabase
		.from('orders')
		.select(
			'id, total_amount, status, created_at, payment_method, payment_status, payment_proof_url, customers(full_name, email)'
		)
		.eq('payment_status', 'pending')
		.order('created_at', { ascending: false });
	if (error) throw new Error(error.message);
	return data;
};

export const getUnclassifiedCdrProducts = async () => {
	const settings = await getAppSettings();
	const defaultCatId = settings.get('cdr_default_category_id') as string | undefined;
	const defaultBrandId = settings.get('cdr_default_brand_id') as string | undefined;

	const { data, error } = await supabase
		.from('products')
		.select('id, name, external_code, brand_id, category_id, price_usd, images')
		.eq('source', 'cdr')
		.or(
			[
				defaultCatId ? `category_id.eq.${defaultCatId}` : '',
				defaultBrandId ? `brand_id.eq.${defaultBrandId}` : '',
			]
				.filter(Boolean)
				.join(',')
		);

	if (error) throw new Error(error.message);
	return data;
};

export const assignCdrProductTaxonomy = async (
	productId: string,
	patch: { brand_id?: string; category_id?: string; markup_percent?: number | null }
) => {
	const { error } = await supabase.from('products').update(patch).eq('id', productId);
	if (error) throw new Error(error.message);
};
