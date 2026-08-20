import { supabase } from '../supabase/client';
import type { ICartItem } from '../components/shared/CartItem';

/**
 * Recuperación de carritos abandonados: lo que pasa cuando el cliente entra por
 * el enlace del mail.
 *
 * El servidor revalida todo contra la base de HOY — precio, stock, producto
 * activo — así que lo que vuelve al carrito es lo que realmente se puede
 * comprar, no una foto vieja.
 */

export interface RecoveredCoupon {
	code: string;
	percent: number;
	expires_at: string | null;
	payment_methods: ('mercadopago' | 'transfer' | 'deposit')[];
}

export interface RecoveredCart {
	ok: boolean;
	reason?: string;
	items: ICartItem[];
	/** Cuántas líneas del carrito original ya no se pueden comprar. */
	descartados: number;
	coupon: RecoveredCoupon | null;
}

/** Dónde queda el cupón entre la página de recuperación y el checkout. */
const CUPON_KEY = 'rf_cupon_recuperacion';

export const guardarCuponRecuperado = (c: RecoveredCoupon | null) => {
	try {
		if (c) sessionStorage.setItem(CUPON_KEY, JSON.stringify(c));
		else sessionStorage.removeItem(CUPON_KEY);
	} catch {
		/* modo incógnito con storage bloqueado: se pierde el prellenado, nada más */
	}
};

export const leerCuponRecuperado = (): RecoveredCoupon | null => {
	try {
		const raw = sessionStorage.getItem(CUPON_KEY);
		return raw ? (JSON.parse(raw) as RecoveredCoupon) : null;
	} catch {
		return null;
	}
};

export const restoreAbandonedCart = async (token: string): Promise<RecoveredCart> => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { data, error } = await (supabase.rpc as any)('restore_abandoned_cart', {
		p_token: token,
	});
	if (error) throw new Error(error.message);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const r = (data ?? {}) as any;
	if (!r.ok) {
		return { ok: false, reason: r.reason ?? 'No pudimos recuperar tu carrito', items: [], descartados: 0, coupon: null };
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const items: ICartItem[] = ((r.items ?? []) as any[]).map(i => ({
		variantId: i.variantId,
		productId: i.productId,
		name: i.name,
		image: i.image ?? '',
		color: '',
		storage: '',
		price: Number(i.price) || 0,
		quantity: Number(i.quantity) || 1,
		source: (i.source as 'local' | 'cdr') ?? 'local',
		externalCode: i.externalCode ?? null,
		onlinePayment: i.onlinePayment === true,
		stock: Number(i.stock) || 0,
	}));

	return {
		ok: true,
		items,
		descartados: Number(r.descartados) || 0,
		coupon: r.coupon
			? {
					code: r.coupon.code,
					percent: Number(r.coupon.percent) || 0,
					expires_at: r.coupon.expires_at ?? null,
					payment_methods: r.coupon.payment_methods ?? ['transfer'],
			  }
			: null,
	};
};
