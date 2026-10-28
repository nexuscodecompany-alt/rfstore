import { supabase } from '../supabase/client';

/**
 * Precio y stock actuales de las variantes del carrito, calculados por el
 * servidor con la misma fórmula con la que después cobra (rf_sale_price).
 */
export const getCartPrices = async (
	variantIds: string[]
): Promise<Record<string, { price: number; stock: number }>> => {
	if (variantIds.length === 0) return {};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { data, error } = await (supabase as any).rpc('get_cart_prices', {
		p_variant_ids: variantIds,
	});
	if (error) throw new Error(error.message);
	const out: Record<string, { price: number; stock: number }> = {};
	for (const row of (data ?? []) as { variant_id: string; price: number; stock: number }[]) {
		out[row.variant_id] = {
			price: Math.round(Number(row.price) * 100) / 100,
			stock: Number(row.stock) || 0,
		};
	}
	return out;
};
