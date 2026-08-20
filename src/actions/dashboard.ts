import { supabase } from '../supabase/client';

// El cliente está tipado con los tipos generados de tablas, que no incluyen
// estas funciones RPC nuevas. Usamos un acceso laxo solo para las llamadas rpc.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (name: string, args: Record<string, unknown>) =>
	(supabase as any).rpc(name, args);

export interface StatusBreakdownItem {
	status: string;
	count: number;
	amount: number;
}

export interface PaymentBreakdownItem {
	method: 'mp' | 'transfer' | 'deposit' | 'ml' | 'manual' | 'otro';
	count: number;
	revenue_usd: number;
}

export interface DashboardOverview {
	orders_in_period: number;
	revenue_period: number; // Cotizado (pipeline, NO ingreso)
	avg_order_value: number;
	paid_revenue_period: number; // Ingresos reales (pagado)
	paid_orders_in_period: number;
	prev_paid_revenue_period: number;
	paid_cost_period: number; // Costo CDR de lo vendido (pagado)
	paid_margin_period: number; // Ganancia real = venta - costo CDR
	prev_paid_margin_period: number;
	// Ganancia por moneda real de venta (pesos y dólares por separado)
	uyu_orders: number;
	uyu_revenue: number; // venta en pesos (real ML)
	uyu_cost: number; // costo CDR convertido a pesos
	uyu_commission: number; // comisiones en pesos
	uyu_shipping: number; // envíos en pesos
	uyu_other: number; // otros costos en pesos
	usd_orders: number;
	usd_revenue: number; // venta en dólares
	usd_cost: number; // costo CDR en dólares
	usd_commission: number;
	usd_shipping: number;
	usd_other: number;
	// Corte por forma de pago (ingreso en USD interno)
	payment_breakdown: PaymentBreakdownItem[];
	orders_total: number;
	status_breakdown: StatusBreakdownItem[];
	concretado_count: number;
	customers_new_period: number;
	customers_total: number;
	products_total: number;
	products_local: number;
	products_cdr: number;
	stock_units: number;
	variants_out_of_stock: number;
	variants_low_stock: number;
	brands_total: number;
	categories_total: number;
	prev_revenue_period: number;
	prev_orders_in_period: number;
}

export interface TopProduct {
	product_id: string;
	name: string;
	image: string | null;
	units: number;
	revenue: number;
}

export interface TopBrand {
	name: string;
	products: number;
}

export interface SalesPoint {
	day: string;
	orders: number;
	amount: number;
}

export interface DashboardData {
	overview: DashboardOverview;
	topProducts: TopProduct[];
	bottomProducts: TopProduct[];
	topBrands: TopBrand[];
	timeseries: SalesPoint[];
}

// El panel manda las fechas como "YYYY-MM-DD". Si se las pasáramos así a la
// base, Postgres las toma como la MEDIANOCHE en UTC: el último día del rango
// quedaba afuera (filtrar 01/07 al 31/07 perdía todo lo vendido el 31) y,
// además, las 3 horas de diferencia con Uruguay corrían los días.
// Acá se convierten a los bordes reales del día en hora de Montevideo.
// Se queda sólo con "YYYY-MM-DD" por si el que llama ya mandó una hora pegada.
const soloFecha = (v: string) => String(v).slice(0, 10);
const desdeElInicioDelDia = (fecha: string) => `${soloFecha(fecha)}T00:00:00-03:00`;
const hastaElFinalDelDia = (fecha: string) => `${soloFecha(fecha)}T23:59:59.999-03:00`;

/* ------------------------------------------------------------------ */
/*  CARRITOS ABANDONADOS                                              */
/* ------------------------------------------------------------------ */

/** Una fila del listado de mails enviados. */
export interface AbandonedSendRow {
	id: string;
	email: string;
	nombre: string | null;
	reminder_no: number;
	coupon_code: string | null;
	total_usd: number;
	sent_at: string;
	clicked: boolean;
	recovered_order_id: number | null;
	recovered_total_usd: number | null;
	status: 'sent' | 'failed' | 'skipped';
	items: string[];
}

/** Un carrito abandonado que todavía no recibió ningún aviso. */
export interface AbandonedPendingRow {
	id: string;
	email: string | null;
	nombre: string | null;
	total_usd: number;
	items_count: number;
	updated_at: string;
	avisos: number;
}

export interface AbandonedCartMetrics {
	abandonados: number;
	abandonados_usd: number;
	convertidos_solos: number;
	mails_enviados: number;
	mails_fallidos: number;
	primer_aviso: number;
	segundo_aviso: number;
	clics: number;
	recuperados: number;
	recuperado_usd: number;
	/** Lo que costaron en descuento las ventas recuperadas. */
	descuento_usd: number;
	ultimos: AbandonedSendRow[];
	pendientes: AbandonedPendingRow[];
}

export const getAbandonedCartMetrics = async (
	fromDate: string,
	toDate: string
): Promise<AbandonedCartMetrics> => {
	const { data, error } = await rpc('abandoned_cart_metrics', {
		p_from: desdeElInicioDelDia(fromDate),
		p_to: hastaElFinalDelDia(toDate),
	});
	if (error) throw new Error(error.message);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const d = (data ?? {}) as any;
	const n = (v: unknown) => Number(v) || 0;
	return {
		abandonados: n(d.abandonados),
		abandonados_usd: n(d.abandonados_usd),
		convertidos_solos: n(d.convertidos_solos),
		mails_enviados: n(d.mails_enviados),
		mails_fallidos: n(d.mails_fallidos),
		primer_aviso: n(d.primer_aviso),
		segundo_aviso: n(d.segundo_aviso),
		clics: n(d.clics),
		recuperados: n(d.recuperados),
		recuperado_usd: n(d.recuperado_usd),
		descuento_usd: n(d.descuento_usd),
		ultimos: (d.ultimos ?? []) as AbandonedSendRow[],
		pendientes: (d.pendientes ?? []) as AbandonedPendingRow[],
	};
};

export const getDashboardData = async (
	fromDate: string,
	toDate: string
): Promise<DashboardData> => {
	const from = desdeElInicioDelDia(fromDate);
	const to = hastaElFinalDelDia(toDate);
	const [overviewRes, topRes, bottomRes, brandsRes, seriesRes] =
		await Promise.all([
			rpc('dashboard_overview', { p_from: from, p_to: to }),
			rpc('dashboard_top_products', {
				p_from: from,
				p_to: to,
				p_limit: 5,
				p_direction: 'top',
			}),
			rpc('dashboard_top_products', {
				p_from: from,
				p_to: to,
				p_limit: 5,
				p_direction: 'bottom',
			}),
			rpc('dashboard_top_brands', { p_limit: 6 }),
			rpc('dashboard_sales_timeseries', { p_from: from, p_to: to }),
		]);

	const firstError =
		overviewRes.error ||
		topRes.error ||
		bottomRes.error ||
		brandsRes.error ||
		seriesRes.error;

	if (firstError) {
		console.error('getDashboardData:', firstError);
		throw new Error(firstError.message);
	}

	return {
		overview: overviewRes.data as DashboardOverview,
		topProducts: (topRes.data ?? []) as TopProduct[],
		bottomProducts: (bottomRes.data ?? []) as TopProduct[],
		topBrands: (brandsRes.data ?? []) as TopBrand[],
		timeseries: (seriesRes.data ?? []) as SalesPoint[],
	};
};
