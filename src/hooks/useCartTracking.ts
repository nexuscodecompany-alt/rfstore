import { useEffect, useRef } from 'react';
import { useCartStore } from '../store/cart.store';
import { useUser } from './auth/useUser';
import { trackCart } from '../actions/customers';

/**
 * Carrito abandonado EN GENERAL (19/11/2026): cada cambio del carrito se registra
 * en checkout_leads (stage 'cart'), con o sin sesión. Sin sesión se usa un id
 * anónimo del navegador; al iniciar sesión el carrito pasa a la cuenta.
 * Best-effort: nunca rompe la navegación.
 */
const ANON_KEY = 'rf_cart_anon_id';

export const getCartAnonId = (): string | null => {
	try {
		let id = localStorage.getItem(ANON_KEY);
		if (!id) {
			id = crypto.randomUUID();
			localStorage.setItem(ANON_KEY, id);
		}
		return id;
	} catch {
		return null;
	}
};

export const useCartTracking = () => {
	const items = useCartStore(s => s.items);
	const totalAmount = useCartStore(s => s.totalAmount);
	const { session, guestSession, isLoading } = useUser();
	const uid = (session ?? guestSession)?.user?.id ?? null;
	const last = useRef<string | null>(null);

	useEffect(() => {
		if (isLoading) return;
		const cart = items.map(i => ({
			variantId: i.variantId,
			name: i.name,
			image: i.image,
			quantity: i.quantity,
			price: i.price,
		}));
		const key = JSON.stringify([uid, cart]);
		if (key === last.current) return;
		// Primer render con carrito vacío y sin nada que asociar: no hace falta llamar.
		if (last.current === null && cart.length === 0 && !uid) {
			last.current = key;
			return;
		}
		const t = setTimeout(() => {
			last.current = key;
			trackCart({ anonId: getCartAnonId(), cart, total: totalAmount });
		}, 2000);
		return () => clearTimeout(t);
	}, [items, totalAmount, uid, isLoading]);
};
