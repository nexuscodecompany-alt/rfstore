/* ======================================================================= */
/*  Meta (Facebook) Pixel — carga y eventos centralizados.                  */
/*                                                                          */
/*  Configuración: definí el ID en la env VITE_META_PIXEL_ID (en Vercel).   */
/*  Sin ID, TODO es no-op: la web funciona igual y no se carga nada.        */
/*                                                                          */
/*  Eventos estándar cableados en la web:                                   */
/*    PageView              -> cada navegación (SPA) [main.tsx]             */
/*    ViewContent           -> ver ficha de producto [CellPhonePage]        */
/*    AddToCart             -> agregar al carrito [CardProduct/CellPhone]    */
/*    InitiateCheckout      -> entrar al checkout [CheckoutPage/buyNow]      */
/*    Purchase              -> compra confirmada [ThankyouPage]             */
/*    CompleteRegistration  -> alta de cuenta [RegisterPage]                 */
/* ======================================================================= */

type FbqParams = Record<string, unknown>;

declare global {
	interface Window {
		fbq?: (...args: unknown[]) => void;
		_fbq?: unknown;
	}
}

const PIXEL_ID = import.meta.env.VITE_META_PIXEL_ID;

// Toda la tienda maneja precios en dólares (ver helpers.formatPrice -> "USD ...").
const CURRENCY = 'USD';

let initialized = false;

/** Inyecta el script oficial de Meta una sola vez y dispara el primer PageView. */
export const initPixel = (): void => {
	if (initialized || typeof window === 'undefined') return;

	if (!PIXEL_ID) {
		if (import.meta.env.DEV) {
			console.info(
				'[pixel] VITE_META_PIXEL_ID no definido — Meta Pixel deshabilitado.'
			);
		}
		return;
	}

	/* Snippet oficial de Meta (base code). */
	/* eslint-disable */
	(function (f: any, b: any, e: string, v: string, n?: any, t?: any, s?: any) {
		if (f.fbq) return;
		n = f.fbq = function () {
			n.callMethod
				? n.callMethod.apply(n, arguments)
				: n.queue.push(arguments);
		};
		if (!f._fbq) f._fbq = n;
		n.push = n;
		n.loaded = true;
		n.version = '2.0';
		n.queue = [];
		t = b.createElement(e);
		t.async = true;
		t.src = v;
		s = b.getElementsByTagName(e)[0];
		s.parentNode.insertBefore(t, s);
	})(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
	/* eslint-enable */

	window.fbq?.('init', PIXEL_ID);
	window.fbq?.('track', 'PageView');
	initialized = true;
};

const isReady = (): boolean =>
	typeof window !== 'undefined' && typeof window.fbq === 'function';

/** Track genérico de un evento estándar de Meta. */
export const track = (
	event: string,
	params?: FbqParams,
	eventID?: string
): void => {
	if (!isReady()) return;
	if (eventID) window.fbq!('track', event, params ?? {}, { eventID });
	else window.fbq!('track', event, params ?? {});
};

/** PageView — se llama en cada cambio de ruta del SPA. */
export const pageView = (): void => {
	if (!isReady()) return;
	window.fbq!('track', 'PageView');
};

/* --------------------------------- Ecommerce --------------------------------- */

export interface CartLine {
	id: string;
	quantity: number;
	price: number;
}

const sum = (items: CartLine[]) =>
	items.reduce((acc, i) => acc + (Number(i.quantity) || 0), 0);

export const trackViewContent = (p: {
	id: string;
	name: string;
	price: number;
	category?: string | null;
}): void =>
	track('ViewContent', {
		content_ids: [p.id],
		content_type: 'product',
		content_name: p.name,
		content_category: p.category ?? undefined,
		value: Number(p.price) || 0,
		currency: CURRENCY,
	});

export const trackAddToCart = (p: {
	id: string;
	name: string;
	price: number;
	quantity: number;
}): void =>
	track('AddToCart', {
		content_ids: [p.id],
		content_type: 'product',
		content_name: p.name,
		contents: [{ id: p.id, quantity: p.quantity }],
		value: (Number(p.price) || 0) * (Number(p.quantity) || 1),
		currency: CURRENCY,
	});

export const trackInitiateCheckout = (
	items: CartLine[],
	value: number
): void =>
	track('InitiateCheckout', {
		content_ids: items.map(i => i.id),
		content_type: 'product',
		contents: items.map(i => ({ id: i.id, quantity: i.quantity })),
		num_items: sum(items),
		value: Number(value) || 0,
		currency: CURRENCY,
	});

/**
 * Purchase — compra confirmada. Deduplica por orden para no contar de más
 * si el cliente refresca la página de agradecimiento. El eventID estable
 * (`purchase_<orderId>`) permite deduplicar contra la Conversions API si
 * a futuro se envía el mismo evento server-side.
 */
export const trackPurchase = (
	orderId: string | number,
	items: CartLine[],
	value: number
): void => {
	const key = `fb_purchase_${orderId}`;
	try {
		if (
			typeof sessionStorage !== 'undefined' &&
			sessionStorage.getItem(key)
		) {
			return;
		}
	} catch {
		/* sessionStorage puede fallar en modo privado; seguimos igual */
	}

	track(
		'Purchase',
		{
			content_ids: items.map(i => i.id),
			content_type: 'product',
			contents: items.map(i => ({ id: i.id, quantity: i.quantity })),
			num_items: sum(items),
			value: Number(value) || 0,
			currency: CURRENCY,
		},
		`purchase_${orderId}`
	);

	try {
		sessionStorage.setItem(key, '1');
	} catch {
		/* noop */
	}
};

export const trackCompleteRegistration = (): void =>
	track('CompleteRegistration', { status: true });

export const trackLead = (): void => track('Lead');
