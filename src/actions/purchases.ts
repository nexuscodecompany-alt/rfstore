import { supabase } from '../supabase/client';

/* ====================================================================== */
/*  COMPRAS DE STOCK PROPIO                                               */
/* ====================================================================== */
// Recibir una compra sube el stock, recalcula el costo promedio ponderado de
// cada variante y deja el movimiento registrado. Todo en una transacción del
// lado de la base (RPC receive_purchase).

export interface PurchaseItemInput {
	variant_id: string;
	quantity: number;
	unit_cost: number;
}

export interface ReceivePurchaseInput {
	supplier: string;
	items: PurchaseItemInput[];
	purchasedAt?: string;
	currency?: 'USD' | 'UYU';
	fxRate?: number | null;
	freightUsd?: number;
	taxesUsd?: number;
	invoiceNumber?: string;
	notes?: string;
}

export const receivePurchase = async (
	input: ReceivePurchaseInput
): Promise<number> => {
	const { data, error } = await (supabase as any).rpc('receive_purchase', {
		p_supplier: input.supplier,
		p_items: input.items,
		p_purchased_at: input.purchasedAt ?? null,
		p_currency: input.currency ?? 'USD',
		p_fx_rate: input.fxRate ?? null,
		p_freight_usd: input.freightUsd ?? 0,
		p_taxes_usd: input.taxesUsd ?? 0,
		p_invoice_number: input.invoiceNumber ?? null,
		p_notes: input.notes ?? null,
	});
	if (error) throw new Error(error.message);
	return Number(data);
};

export interface PurchaseRow {
	id: number;
	purchased_at: string;
	supplier: string;
	invoice_number: string | null;
	currency: string;
	fx_rate: number | null;
	freight_usd: number;
	taxes_usd: number;
	total_usd: number;
	notes: string | null;
	purchase_items: {
		quantity: number;
		unit_cost: number;
		landed_unit_cost_usd: number;
		variants: { id: string; products: { name: string } | null } | null;
	}[];
}

export const getPurchases = async (): Promise<PurchaseRow[]> => {
	const { data, error } = await (supabase as any)
		.from('purchases')
		.select(
			'*, purchase_items(quantity, unit_cost, landed_unit_cost_usd, variants(id, products(name)))'
		)
		.order('purchased_at', { ascending: false })
		.order('id', { ascending: false })
		.limit(100);
	if (error) throw new Error(error.message);
	return (data ?? []) as PurchaseRow[];
};

/** Productos con stock propio, para el buscador del formulario de compra. */
export interface OwnedProductOption {
	product_id: string;
	variant_id: string;
	name: string;
	stock: number;
	avg_cost_usd: number | null;
	price: number;
}

export const searchOwnedProducts = async (
	term: string
): Promise<OwnedProductOption[]> => {
	let q = (supabase as any)
		.from('products')
		.select('id, name, fulfillment, variants(id, stock, price, avg_cost_usd)')
		.in('fulfillment', ['propio', 'ambos'])
		.limit(20);
	if (term.trim()) q = q.ilike('search_text', `%${term.trim().toLowerCase()}%`);

	const { data, error } = await q;
	if (error) throw new Error(error.message);
	return (data ?? []).flatMap((p: any) =>
		(p.variants ?? []).map((v: any) => ({
			product_id: p.id,
			variant_id: v.id,
			name: p.name,
			stock: Number(v.stock) || 0,
			avg_cost_usd: v.avg_cost_usd == null ? null : Number(v.avg_cost_usd),
			price: Number(v.price) || 0,
		}))
	);
};
