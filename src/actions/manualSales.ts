import { supabase } from '../supabase/client';

// ── Conceptos y ventas manuales ─────────────────────────────────────────────
// El admin registra ventas que hace por fuera (web/ML), agrupadas por "concepto"
// (ej: la empresa Sunfer). Guarda precio de venta, costo y costos extra (envío).
// Se almacenan como orders con channel='manual' y se centralizan con el resto.

export interface SaleConcept {
	id: string;
	name: string;
	color: string | null;
	created_at: string;
}

export interface ManualSaleItem {
	variantId: string;
	quantity: number;
	label: string; // "Producto · color/almacenamiento" para mostrar
}

export interface ManualSale {
	id: number;
	created_at: string;
	status: string;
	conceptId: string | null;
	conceptName: string | null;
	conceptColor: string | null;
	description: string | null;
	currency: 'USD' | 'UYU';
	fxRate: number;
	// Montos en la moneda real de la venta (la que se eligió al registrarla).
	saleAmount: number;
	cost: number;
	commission: number;
	shipping: number;
	other: number;
	grossProfit: number; // venta - costo
	profit: number; // neta = venta - costo - comisión - envío - otros
	// Productos del catálogo vinculados (los que descontaron stock).
	items: { label: string; quantity: number }[];
}

export interface ManualSaleInput {
	conceptId: string | null;
	description: string;
	currency: 'USD' | 'UYU';
	saleAmount: number;
	cost: number;
	commission: number;
	shipping: number;
	other: number;
	fxRate: number; // pesos por USD (se usa solo si currency === 'UYU')
	saleDate?: string | null; // ISO; si no viene, ahora
	// Productos del catálogo a descontar de stock (opcional). Vacío = venta libre.
	items: ManualSaleItem[];
}

/* ------------------------------ Conceptos ------------------------------ */
export const getSaleConcepts = async (): Promise<SaleConcept[]> => {
	const { data, error } = await (supabase as any)
		.from('sale_concepts')
		.select('id, name, color, created_at')
		.order('name', { ascending: true });
	if (error) throw new Error(error.message);
	return (data ?? []) as SaleConcept[];
};

export const createSaleConcept = async (
	name: string,
	color?: string | null
): Promise<SaleConcept> => {
	const { data, error } = await (supabase as any)
		.from('sale_concepts')
		.insert({ name: name.trim(), color: color ?? null })
		.select('id, name, color, created_at')
		.single();
	if (error) throw new Error(error.message);
	return data as SaleConcept;
};

export const deleteSaleConcept = async (id: string): Promise<void> => {
	const { error } = await (supabase as any)
		.from('sale_concepts')
		.delete()
		.eq('id', id);
	if (error) throw new Error(error.message);
};

/* ---------------------------- Ventas manuales ---------------------------- */
export const getManualSales = async (
	conceptId?: string | null
): Promise<ManualSale[]> => {
	let query = (supabase as any)
		.from('orders')
		.select(
			`id, created_at, status, concept_id, manual_description,
			 total_amount, total_original, ml_currency, fx_rate,
			 manual_cost_usd, ml_commission_usd, ml_shipping_cost_usd, ml_other_costs_usd,
			 sale_concepts:concept_id(name, color),
			 order_items:order_items(quantity, variants(color_name, storage, products(name)))`
		)
		.eq('channel', 'manual')
		.order('created_at', { ascending: false });
	if (conceptId) query = query.eq('concept_id', conceptId);

	const { data, error } = await query;
	if (error) throw new Error(error.message);

	return ((data ?? []) as any[]).map(o => {
		const currency: 'USD' | 'UYU' = o.ml_currency === 'UYU' ? 'UYU' : 'USD';
		const fx = Number(o.fx_rate ?? 1) || 1;
		// Reconstruimos los montos en la moneda real de la venta.
		const saleAmount =
			currency === 'UYU' && o.total_original != null
				? Number(o.total_original)
				: Number(o.total_amount ?? 0);
		// Costos guardados en USD; los mostramos en la moneda real de la venta.
		const toCur = (usd: number) => Number(usd ?? 0) * (currency === 'UYU' ? fx : 1);
		const cost = toCur(o.manual_cost_usd);
		const commission = toCur(o.ml_commission_usd);
		const shipping = toCur(o.ml_shipping_cost_usd);
		const other = toCur(o.ml_other_costs_usd);
		return {
			id: o.id,
			created_at: o.created_at,
			status: o.status,
			conceptId: o.concept_id ?? null,
			conceptName: o.sale_concepts?.name ?? null,
			conceptColor: o.sale_concepts?.color ?? null,
			description: o.manual_description ?? null,
			currency,
			fxRate: fx,
			saleAmount,
			cost,
			commission,
			shipping,
			other,
			grossProfit: saleAmount - cost,
			profit: saleAmount - cost - commission - shipping - other,
			items: ((o.order_items ?? []) as any[]).map(it => ({
				label:
					[
						it.variants?.products?.name,
						[it.variants?.color_name, it.variants?.storage]
							.filter(Boolean)
							.join(' / '),
					]
						.filter(Boolean)
						.join(' · ') || 'Producto',
				quantity: Number(it.quantity ?? 0),
			})),
		} as ManualSale;
	});
};

export const createManualSale = async (
	input: ManualSaleInput
): Promise<{ id: number }> => {
	const isUyu = input.currency === 'UYU';
	const fx = isUyu ? Number(input.fxRate) || 1 : 1;
	const toUsd = (n: number) => (isUyu ? n / fx : n);
	const round2 = (n: number) => Math.round(n * 100) / 100;

	// El RPC inserta la orden y, si hay items, descuenta el stock de cada variante
	// de forma atómica (lo que dispara el sync a ML).
	const { data, error } = await (supabase as any).rpc('create_manual_sale', {
		p_concept_id: input.conceptId,
		p_description: input.description?.trim() || null,
		p_currency: input.currency,
		p_sale_amount: input.saleAmount, // moneda real de la venta
		p_total_usd: round2(toUsd(input.saleAmount)), // métrica interna en USD
		p_fx_rate: fx,
		p_cost_usd: round2(toUsd(input.cost)),
		p_commission_usd: round2(toUsd(input.commission)),
		p_shipping_usd: round2(toUsd(input.shipping)),
		p_other_usd: round2(toUsd(input.other)),
		p_sale_date: input.saleDate || new Date().toISOString(),
		p_items: input.items.map(i => ({
			variant_id: i.variantId,
			quantity: i.quantity,
		})),
	});
	if (error) throw new Error(error.message);
	return { id: data as number };
};

export const deleteManualSale = async (id: number): Promise<void> => {
	// El RPC devuelve el stock descontado antes de borrar la venta.
	const { error } = await (supabase as any).rpc('delete_manual_sale', {
		p_order_id: id,
	});
	if (error) throw new Error(error.message);
};
