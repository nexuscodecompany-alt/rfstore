import { create } from 'zustand';

// Store efímero para que ItemsCheckout (resumen lateral / mobile) refleje el
// envío calculado por el formulario activo (cotización por WhatsApp o CDR pago
// online), más el cupón y el total real a pagar. Se resetea al salir del checkout.

interface CheckoutSummary {
	// Costo de envío en USD (null = "a coordinar" / no aplica todavía).
	shippingUsd: number | null;
	discountUsd: number;
	couponCode: string | null;
	// Total real a pagar (subtotal + envío - descuento). null = no calculado aún.
	grandTotalUsd: number | null;
}

interface CheckoutShippingState extends CheckoutSummary {
	shippingLabel: string;
	setShippingLabel: (label: string) => void;
	setSummary: (s: CheckoutSummary) => void;
	reset: () => void;
}

const DEFAULT_LABEL = 'A coordinar';
const EMPTY_SUMMARY: CheckoutSummary = {
	shippingUsd: null,
	discountUsd: 0,
	couponCode: null,
	grandTotalUsd: null,
};

export const useCheckoutShippingStore = create<CheckoutShippingState>(set => ({
	shippingLabel: DEFAULT_LABEL,
	...EMPTY_SUMMARY,
	setShippingLabel: label => set({ shippingLabel: label }),
	setSummary: s => set({ ...s }),
	reset: () => set({ shippingLabel: DEFAULT_LABEL, ...EMPTY_SUMMARY }),
}));
