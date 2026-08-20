import { supabase } from '../supabase/client';

export type CouponType = 'percent' | 'fixed' | 'free_shipping';
export type CouponScope = 'all' | 'category' | 'product';

export interface Coupon {
	id: string;
	code: string;
	type: CouponType;
	value: number; // percent: %, fixed: monto en UYU, free_shipping: ignorado
	scope: CouponScope;
	category_id: string | null;
	product_id: string | null;
	min_order_usd: number | null;
	max_uses: number | null;
	used_count: number;
	expires_at: string | null;
	active: boolean;
	created_at: string;
}

export type CouponInput = Omit<Coupon, 'id' | 'used_count' | 'created_at'>;

export interface CouponValidation {
	valid: boolean;
	reason?: string;
	coupon_id?: string;
	code?: string;
	type?: CouponType;
	discount_usd?: number;
	free_shipping?: boolean;
	/** Con qué métodos vale. Si no están los tres, el cupón está restringido. */
	payment_methods?: ('mercadopago' | 'transfer' | 'deposit')[];
	allowed_methods?: ('mercadopago' | 'transfer' | 'deposit')[];
}

export interface CartLineForCoupon {
	variant_id: string;
	price: number; // precio unitario USD (final, como se cobra)
	quantity: number;
}

// ---------- Validación (checkout, preview) ----------
export const validateCoupon = async (params: {
	code: string;
	items: CartLineForCoupon[];
	subtotal: number;
	shipping?: number;
	/**
	 * Método de pago elegido. NO es opcional en la práctica: los cupones pueden
	 * estar restringidos (el de recuperación de carritos vale sólo por
	 * transferencia) y sin declararlo el servidor rechaza. Esto es una preview:
	 * el candado real vive en place_cdr_order y en mp-create-preference.
	 */
	paymentMethod?: 'mercadopago' | 'transfer' | 'deposit' | 'hybrid';
}): Promise<CouponValidation> => {
	const { data, error } = await (supabase.rpc as any)('apply_coupon', {
		p_code: params.code,
		p_items: params.items,
		p_subtotal: params.subtotal,
		p_shipping: params.shipping ?? 0,
		p_payment_method: params.paymentMethod ?? null,
	});
	if (error) throw new Error(error.message);
	return (data ?? { valid: false, reason: 'Error' }) as CouponValidation;
};

// ---------- ABM admin ----------
export const getCoupons = async (): Promise<Coupon[]> => {
	const { data, error } = await (supabase as any)
		.from('coupons')
		.select('*')
		.order('created_at', { ascending: false });
	if (error) throw new Error(error.message);
	return (data ?? []) as Coupon[];
};

export const createCoupon = async (input: CouponInput): Promise<Coupon> => {
	const { data, error } = await (supabase as any)
		.from('coupons')
		.insert({ ...input, code: input.code.trim().toUpperCase() })
		.select('*')
		.single();
	if (error) throw new Error(error.message);
	return data as Coupon;
};

export const updateCoupon = async (id: string, patch: Partial<CouponInput>): Promise<void> => {
	const clean = { ...patch };
	if (clean.code) clean.code = clean.code.trim().toUpperCase();
	const { error } = await (supabase as any).from('coupons').update(clean).eq('id', id);
	if (error) throw new Error(error.message);
};

export const deleteCoupon = async (id: string): Promise<void> => {
	const { error } = await (supabase as any).from('coupons').delete().eq('id', id);
	if (error) throw new Error(error.message);
};
