import { supabase } from '../supabase/client';

/* ====================================================================== */
/*  BASE DE CLIENTES (panel)                                              */
/* ====================================================================== */
// Todo pasa por RPCs SECURITY DEFINER que verifican admin adentro: una vista
// suelta quedaría legible por cualquiera con la clave pública de la web.

export interface CustomerOverview {
	customer_id: string;
	full_name: string | null;
	email: string | null;
	phone: string | null;
	registered_at: string;
	orders_paid: number;
	total_spent_usd: number;
	avg_ticket_usd: number;
	first_purchase_at: string | null;
	last_purchase_at: string | null;
	abandoned_count: number;
	abandoned_value_usd: number;
	last_abandoned_at: string | null;
	coupons_used: number;
	channels: string;
	last_zone: string | null;
}

export const getCustomersOverview = async (): Promise<CustomerOverview[]> => {
	const { data, error } = await (supabase as any).rpc('admin_customers_overview');
	if (error) throw new Error(error.message);
	return (data ?? []).map((r: any) => ({
		...r,
		orders_paid: Number(r.orders_paid) || 0,
		total_spent_usd: Number(r.total_spent_usd) || 0,
		avg_ticket_usd: Number(r.avg_ticket_usd) || 0,
		abandoned_count: Number(r.abandoned_count) || 0,
		abandoned_value_usd: Number(r.abandoned_value_usd) || 0,
		coupons_used: Number(r.coupons_used) || 0,
	})) as CustomerOverview[];
};

export interface CustomerTimelineRow {
	order_id: number;
	created_at: string;
	channel: string;
	status: string;
	payment_method: string | null;
	payment_status: string | null;
	total_amount: number;
	shipping_zone: string | null;
	shipping_department: string | null;
	coupon_code: string | null;
	is_abandoned: boolean;
	items: string;
}

export const getCustomerTimeline = async (
	customerId: string
): Promise<CustomerTimelineRow[]> => {
	const { data, error } = await (supabase as any).rpc('admin_customer_timeline', {
		p_customer_id: customerId,
	});
	if (error) throw new Error(error.message);
	return (data ?? []).map((r: any) => ({
		...r,
		total_amount: Number(r.total_amount) || 0,
	})) as CustomerTimelineRow[];
};

/* --- Gente que llegó al checkout ------------------------------------- */

export interface CheckoutLead {
	id: string;
	created_at: string;
	updated_at: string;
	email: string | null;
	phone: string | null;
	full_name: string | null;
	items_count: number;
	total_usd: number;
	shipping_zone: string | null;
	shipping_department: string | null;
	status: string;
	order_id: number | null;
	cart: { name?: string; quantity?: number; price?: number }[];
}

export const getCheckoutLeads = async (): Promise<CheckoutLead[]> => {
	const { data, error } = await (supabase as any)
		.from('checkout_leads')
		.select('*')
		.order('updated_at', { ascending: false })
		.limit(300);
	if (error) throw new Error(error.message);
	return (data ?? []).map((r: any) => ({
		...r,
		total_usd: Number(r.total_usd) || 0,
		items_count: Number(r.items_count) || 0,
		cart: Array.isArray(r.cart) ? r.cart : [],
	})) as CheckoutLead[];
};

/**
 * Registra que el cliente llegó al checkout, con lo que tenía en el carrito.
 * Best-effort: si falla, NO rompe la compra (es dato de marketing, no del pedido).
 */
export const trackCheckoutLead = async (input: {
	email: string;
	phone: string;
	fullName: string;
	cart: { name: string; quantity: number; price: number }[];
	total: number;
	shippingZone?: string | null;
	shippingDepartment?: string | null;
}): Promise<void> => {
	try {
		await (supabase as any).rpc('track_checkout_lead', {
			p_email: input.email,
			p_phone: input.phone,
			p_full_name: input.fullName,
			p_cart: input.cart,
			p_total: input.total,
			p_shipping_zone: input.shippingZone ?? null,
			p_shipping_department: input.shippingDepartment ?? null,
		});
	} catch (e) {
		console.warn('trackCheckoutLead:', e);
	}
};
