import { StateCreator, create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { ICartItem } from '../components/shared/CartItem';

export interface CartState {
	items: ICartItem[];
	totalItemsInCart: number;
	totalAmount: number;

	addItem: (item: ICartItem) => void;
	removeItem: (variantId: string) => void;
	updateQuantity: (variantId: string, quantity: number) => void;
	/** Pisa precio y stock con los del servidor (get_cart_prices). */
	applyServerPrices: (prices: Record<string, { price: number; stock: number }>) => void;
	cleanCart: () => void;
}

const storeApi: StateCreator<CartState> = set => ({
	items: [],

	totalItemsInCart: 0,
	totalAmount: 0,

	addItem: item => {
		set(state => {
			const existingItemIndex = state.items.findIndex(
				i => i.variantId === item.variantId
			);
			let updatedItems;
			// Limitar al stock disponible si nos lo pasaron.
			const maxStock = item.stock ?? Infinity;
			const clamp = (q: number) => Math.max(1, Math.min(maxStock, q));

			if (existingItemIndex >= 0) {
				// Si el item ya existe, sumamos cantidad pero respetamos stock
				updatedItems = state.items.map((i, index) =>
					index === existingItemIndex
						? {
								...i,
								// preferimos el stock más fresco del item nuevo
								stock: item.stock ?? i.stock,
								quantity: clamp(i.quantity + item.quantity),
						  }
						: i
				);
			} else {
				updatedItems = [...state.items, { ...item, quantity: clamp(item.quantity) }];
			}

			const newTotalItems = updatedItems.reduce(
				(acc, i) => acc + i.quantity,
				0
			);

			const newTotalAmount = updatedItems.reduce(
				(acc, i) => acc + i.price * i.quantity,
				0
			);

			return {
				items: updatedItems,
				totalAmount: newTotalAmount,
				totalItemsInCart: newTotalItems,
			};
		});
	},

	removeItem: variantId => {
		set(state => {
			const updatedItems = state.items.filter(
				i => i.variantId !== variantId
			);

			const newTotalItems = updatedItems.reduce(
				(acc, i) => acc + i.quantity,
				0
			);

			const newTotalAmount = updatedItems.reduce(
				(acc, i) => acc + i.price * i.quantity,
				0
			);

			return {
				items: updatedItems,
				totalAmount: newTotalAmount,
				totalItemsInCart: newTotalItems,
			};
		});
	},

	updateQuantity: (variantId, quantity) => {
		set(state => {
			const updatedItems = state.items.map(i => {
				if (i.variantId !== variantId) return i;
				const max = i.stock ?? Infinity;
				return { ...i, quantity: Math.max(1, Math.min(max, quantity)) };
			});

			const newTotalItems = updatedItems.reduce(
				(acc, i) => acc + i.quantity,
				0
			);

			const newTotalAmount = updatedItems.reduce(
				(acc, i) => acc + i.price * i.quantity,
				0
			);

			return {
				items: updatedItems,
				totalAmount: newTotalAmount,
				totalItemsInCart: newTotalItems,
			};
		});
	},

	applyServerPrices: prices => {
		set(state => {
			const updatedItems = state.items.map(i => {
				const p = prices[i.variantId];
				// Precio 0 = el servidor no lo pudo calcular: se deja el que había.
				return p && p.price > 0 ? { ...i, price: p.price, stock: p.stock } : i;
			});
			return {
				items: updatedItems,
				totalAmount: updatedItems.reduce((acc, i) => acc + i.price * i.quantity, 0),
			};
		});
	},

	cleanCart: () => {
		set({ items: [], totalItemsInCart: 0, totalAmount: 0 });
	},
});

export const useCartStore = create<CartState>()(
	devtools(
		persist(storeApi, {
			name: 'cart-store',
		})
	)
);
