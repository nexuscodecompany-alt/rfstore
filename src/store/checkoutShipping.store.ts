import { create } from 'zustand';

// Store efímero para que ItemsCheckout (resumen lateral / mobile) refleje el
// envío calculado por el formulario activo (cotización por WhatsApp o CDR pago
// online). Se resetea al "A coordinar" cuando se sale del checkout.

interface CheckoutShippingState {
	shippingLabel: string;
	setShippingLabel: (label: string) => void;
	reset: () => void;
}

const DEFAULT_LABEL = 'A coordinar';

export const useCheckoutShippingStore = create<CheckoutShippingState>(set => ({
	shippingLabel: DEFAULT_LABEL,
	setShippingLabel: label => set({ shippingLabel: label }),
	reset: () => set({ shippingLabel: DEFAULT_LABEL }),
}));
