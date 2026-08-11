import { supabase } from '../supabase/client';

/* ====================================================================== */
/*  COMPRAS DE STOCK PROPIO                                               */
/* ====================================================================== */
// Recibir una compra sube el stock, recalcula el costo promedio ponderado de
// cada variante y deja el movimiento registrado. Todo en una transacción del
// lado de la base (RPC receive_purchase).

export interface PurchaseItemInput {
	/** null = renglón sin producto (embalaje, un servicio): no mueve stock. */
	variant_id: string | null;
	quantity: number;
	unit_cost: number;
	description?: string;
}

export interface ReceivePurchaseInput {
	supplierId: string | null;
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
		p_supplier_id: input.supplierId,
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

/**
 * Buscador de productos para cargar una compra.
 * Trae TODO el catálogo: el producto siempre se carga primero (por el sync de
 * CDR o a mano) y la compra sólo le suma stock del depósito. Devuelve los dos
 * stocks por separado para que se vea qué es de CDR y qué es nuestro.
 */
export interface ProductStockOption {
	product_id: string;
	variant_id: string;
	name: string;
	external_code: string | null;
	source: string | null;
	fulfillment: string | null;
	/** Vendible = CDR + propio. */
	stock: number;
	owned_stock: number;
	cdr_stock: number | null;
	avg_cost_usd: number | null;
	price: number;
}

export const searchProductsForPurchase = async (
	term: string
): Promise<ProductStockOption[]> => {
	let q = (supabase as any)
		.from('products')
		.select(
			'id, name, external_code, source, fulfillment, variants(id, stock, owned_stock, cdr_stock, price, avg_cost_usd)'
		)
		.limit(20);

	const clean = term.trim().toLowerCase();
	if (clean) {
		// Misma regla que el resto de la web: todas las palabras, sin acentos.
		for (const word of clean.split(/\s+/).filter(Boolean)) {
			q = q.ilike('search_text', `%${word}%`);
		}
	}

	const { data, error } = await q;
	if (error) throw new Error(error.message);
	return (data ?? []).flatMap((p: any) =>
		(p.variants ?? []).map((v: any) => ({
			product_id: p.id,
			variant_id: v.id,
			name: p.name,
			external_code: p.external_code ?? null,
			source: p.source ?? null,
			fulfillment: p.fulfillment ?? null,
			stock: Number(v.stock) || 0,
			owned_stock: Number(v.owned_stock) || 0,
			cdr_stock: v.cdr_stock == null ? null : Number(v.cdr_stock),
			avg_cost_usd: v.avg_cost_usd == null ? null : Number(v.avg_cost_usd),
			price: Number(v.price) || 0,
		}))
	);
};
