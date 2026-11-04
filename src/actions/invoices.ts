import { supabase } from '../supabase/client';

/* ======================================================================= */
/*  Facturación electrónica (Fixed). Todo pasa por la edge function         */
/*  fixed-invoice (sólo admins); la lógica está en supabase/functions/      */
/*  _shared/fixed.ts y la guía en docs/fixed-integracion.md.                */
/* ======================================================================= */

const SUPABASE_URL = import.meta.env.VITE_PROJECT_URL_SUPABASE;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_API_KEY;

async function callFixed<T>(body: Record<string, unknown>): Promise<T> {
	const {
		data: { session },
	} = await supabase.auth.getSession();
	const res = await fetch(`${SUPABASE_URL}/functions/v1/fixed-invoice`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			apikey: SUPABASE_ANON,
			Authorization: `Bearer ${session?.access_token ?? SUPABASE_ANON}`,
		},
		body: JSON.stringify(body),
	});
	const json = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(json.error || `Error ${res.status} en la facturación`);
	return json as T;
}

export type InvoiceStatus = 'enviando' | 'emitida' | 'aceptada' | 'rechazada' | 'error' | 'anulada';

export interface InvoiceRow {
	id: number;
	order_id: number;
	order_ids: number[];
	kind: 'venta' | 'nota_credito';
	parent_invoice_id: number | null;
	environment: 'testing' | 'produccion';
	status: InvoiceStatus;
	attempts: number;
	last_error_code: string | null;
	last_error_desc: string | null;
	id_cfe: string | null;
	tipo_cfe: number | null;
	comprobante: string | null;
	moneda: string;
	total: number;
	cotizacion: number | null;
	url_a4: string | null;
	url_ticket: string | null;
	url_verificar: string | null;
	estado_dgi: string | null;
	motivo_rechazo_dgi: string | null;
	note: string | null;
	ml_fiscal_document_id: string | null;
	ml_uploaded_at: string | null;
	ml_upload_error: string | null;
	created_at: string;
}

export type ReceptorTipo = 'final' | 'ci' | 'rut';

export interface Receptor {
	tipo: ReceptorTipo;
	documento: string;
	razonSocial: string;
	nombreComercial: string;
	domicilio: string;
	localidad: string;
	departamento: string;
	domicilioEntrega: string;
	email: string;
	telefono: string;
}

export interface DraftLine {
	cantidad: number;
	descripcion: string;
	descripcionLarga: string;
	rubro: string;
	codigo: string;
	precioUnitario: number;
	descuentoMonto: number;
}

export interface InvoiceDraft {
	order_id: number;
	order_ids: number[];
	channel: string;
	moneda: 'UYU' | 'USD';
	cotizacion: number | null;
	total: number;
	total_uyu: number;
	lines: DraftLine[];
	receptor: Receptor;
	receptor_source: string;
	observaciones: string;
	id_required: boolean;
	id_threshold_uyu: number;
	warnings: string[];
}

export interface InvoicePreview {
	enabled: boolean;
	environment: 'testing' | 'produccion' | null;
	draft: InvoiceDraft;
	problems: string[];
	not_invoiceable: string | null;
	invoices: InvoiceRow[];
}

export interface FixedConnection {
	ok: boolean;
	configured: boolean;
	environment?: 'testing' | 'produccion';
	error: string | null;
	empresa: { rut: string; nombre: string } | null;
	locales: { id: string; nombre: string; direccion: string }[];
	cae: {
		tipo: number;
		serie: string;
		disponibles: number;
		vence: string;
		desde: number;
		hasta: number;
		vigente: boolean;
		motivo: 'deshabilitado' | 'agotado' | 'vencido' | null;
	}[];
	/** La consulta de CAE falló (el resto de la conexión puede estar bien). */
	cae_error?: string | null;
}

/** Configuración de la facturación (app_settings.invoice_config, sin secretos). */
export interface InvoiceConfig {
	enabled: boolean;
	local_id: string;
	rubro_mode: 'category' | 'fixed';
	default_rubro: string;
	shipping_rubro: string;
	ui_value_uyu: number;
	id_required_above_ui: number;
}

export const DEFAULT_INVOICE_CONFIG: InvoiceConfig = {
	enabled: false,
	local_id: '',
	rubro_mode: 'category',
	default_rubro: 'Varios',
	shipping_rubro: 'Envíos',
	ui_value_uyu: 6.3,
	id_required_above_ui: 5000,
};

export const getInvoicePreview = (orderId: number) =>
	callFixed<InvoicePreview>({ action: 'preview', order_id: orderId });

export const emitInvoice = (orderId: number, receptor: Receptor) =>
	callFixed<{ ok: boolean; invoice: InvoiceRow }>({ action: 'emit', order_id: orderId, receptor });

export const retryInvoice = (invoiceId: number) =>
	callFixed<{ ok: boolean; invoice: InvoiceRow }>({ action: 'retry', invoice_id: invoiceId });

export const refreshInvoice = (invoiceId: number) =>
	callFixed<{ ok: boolean; invoice: InvoiceRow }>({ action: 'refresh', invoice_id: invoiceId });

export const creditNoteInvoice = (invoiceId: number, motivo: string) =>
	callFixed<{ ok: boolean; invoice: InvoiceRow }>({ action: 'credit_note', invoice_id: invoiceId, motivo });

export const uploadInvoiceToMl = (invoiceId: number) =>
	callFixed<{ ok: boolean; invoice: InvoiceRow }>({ action: 'ml_upload', invoice_id: invoiceId });

export const testFixedConnection = () => callFixed<FixedConnection>({ action: 'config' });

/**
 * Estado de facturación de varias órdenes a la vez (para el listado). Devuelve
 * la venta más reciente de cada orden; una orden de un pack de ML queda cubierta
 * por la factura del pack.
 */
export const getInvoiceStatusByOrder = async (orderIds: number[]) => {
	const map = new Map<number, InvoiceRow>();
	if (orderIds.length === 0) return map;
	const { data, error } = await (supabase as any)
		.from('invoices')
		.select('id, order_id, order_ids, kind, status, comprobante, created_at')
		.eq('kind', 'venta')
		.overlaps('order_ids', orderIds)
		.order('created_at', { ascending: true });
	if (error) throw new Error(error.message);
	for (const row of (data ?? []) as InvoiceRow[]) {
		for (const id of row.order_ids) map.set(id, row); // la última gana
	}
	return map;
};

/** Textos y colores de cada estado (un solo lugar para el panel). */
export const INVOICE_STATUS_UI: Record<InvoiceStatus, { label: string; className: string }> = {
	enviando: { label: 'Enviando', className: 'bg-sky-50 text-sky-700 ring-sky-200' },
	emitida: { label: 'Emitida · esperando DGI', className: 'bg-amber-50 text-amber-800 ring-amber-200' },
	aceptada: { label: 'Facturada', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
	rechazada: { label: 'Rechazada por DGI', className: 'bg-red-50 text-red-700 ring-red-200' },
	error: { label: 'Error al facturar', className: 'bg-red-50 text-red-700 ring-red-200' },
	anulada: { label: 'Anulada', className: 'bg-ink-100 text-ink-600 ring-ink-200' },
};
