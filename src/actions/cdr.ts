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

/** Reporte del relleno de fotos faltantes (app_settings.cdr_last_fill_report). */
export interface FillImagesReport {
	ok: boolean;
	/** Productos CDR que hoy están sin fotos. */
	products_needing_images: number;
	/** De esos, los que ni aparecen en el feed de CDR de hoy (no se pueden bajar). */
	not_in_feed: number;
	to_process: number;
	backlog: number;
	products_filled: number;
	/** CDR todavía no les subió fotos: es la lista para reclamarle al proveedor. */
	products_skipped_no_gallery: number;
	still_without_gallery?: string[];
	images_downloaded: number;
	images_failed: number;
	errors: string[];
	finished_at?: string;
}

// Dispara el relleno de fotos de productos CDR que quedaron sin imágenes.
// Corre en segundo plano: devuelve enseguida y el reporte se lee después.
export const triggerCdrFillImages = () =>
	invokeFn<{ ok: boolean; started: boolean }>('cdr-fill-images', {
		background: true,
	});

export const getCdrFillReport = async (): Promise<FillImagesReport | null> => {
	const { data, error } = await supabase
		.from('app_settings')
		.select('value')
		.eq('key', 'cdr_last_fill_report')
		.maybeSingle();
	if (error) throw new Error(error.message);
	return (data?.value as unknown as FillImagesReport) ?? null;
};

// Cuántos productos CDR están sin fotos ahora mismo (para el panel).
export const getProductsMissingImagesCount = async (): Promise<number> => {
	const { count, error } = await supabase
		.from('products')
		.select('id', { count: 'exact', head: true })
		.eq('source', 'cdr')
		.or('images.is.null,images.eq.{}');
	if (error) throw new Error(error.message);
	return count ?? 0;
};

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
	// Sólo los productos CDR tienen código externo; los manuales habilitados
	// para pago online mandan null.
	external_code: string | null;
	variant_id: string;
	quantity: number;
	title: string;
	unit_price_usd: number;
	/** Entró como extra del checkout. Sólo atribución: no afecta el cobro. */
	is_extra?: boolean;
	extra_source?: 'product' | 'category' | null;
}

export interface CreatePreferenceResult {
	order_id: number;
	preference_id: string;
	init_point: string;
	sandbox_init_point: string;
	total_usd: number;
	total_uyu: number;
	fx_rate: number;
	fx_source: string;
}

/** Datos fiscales para factura con RUT. Null si el cliente no la pidió. */
export interface InvoiceDataForOrder {
	requested: true;
	rut: string;
	business_name: string;
	trade_name: string | null;
	address: string;
	city: string | null;
	state: string | null;
	email: string | null;
}

/**
 * Dos modos:
 *
 * 1. Compra normal por MercadoPago: se manda el carrito completo y la función
 *    crea la orden, reserva el stock y devuelve el link de pago.
 * 2. Pago combinado: la orden YA la creó place_cdr_order (con su stock
 *    reservado), así que se manda `existing_order_id` + `amount_usd` y sólo se
 *    pide el link por la parte que va con tarjeta.
 */
export type CreatePreferencePayload =
	| {
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
			shipping_zone?: 'montevideo' | 'metropolitana' | 'interior';
			shipping_barrio?: string;
			shipping_department?: string;
			shipping_cost_usd?: number;
			coupon_code?: string;
			invoice?: InvoiceDataForOrder | null;
	  }
	| { existing_order_id: number; amount_usd: number };

export const createMpPreference = (payload: CreatePreferencePayload) =>
	invokeFn<CreatePreferenceResult>('mp-create-preference', payload);

export const confirmManualPayment = (orderId: number, action: 'approve' | 'reject') =>
	invokeFn<{ ok: boolean }>('manual-payment-confirm', {
		order_id: orderId,
		action,
	});

/**
 * Manda al comprador los datos para pagar su pedido: banco (transferencia) o
 * Abitab/Redpagos (depósito), y avisa al admin que hay un pedido esperando pago.
 * El slug de la edge function quedó como 'send-transfer-email' por historia.
 */
export const sendPaymentInstructionsEmail = (orderId: number) =>
	invokeFn<{
		ok: boolean;
		message_id?: string;
		sent_to?: string;
		method?: 'transfer' | 'deposit';
	}>('send-transfer-email', { order_id: orderId });

/**
 * Avisa al admin que el cliente subió el comprobante de pago. Al cliente no se
 * le manda nada (ya lo ve confirmado en pantalla).
 */
export const notifyPaymentProofUploaded = (orderId: number) =>
	invokeFn<{ ok: boolean; message_id?: string; sent_to?: string }>(
		'send-transfer-email',
		{ order_id: orderId, kind: 'proof_uploaded' }
	);

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
