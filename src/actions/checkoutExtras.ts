import { supabase } from '../supabase/client';

/**
 * Extras del checkout: los accesorios que se le ofrecen al cliente cuando ya
 * decidió comprar.
 *
 * Las reglas cuelgan de una CATEGORÍA (cubren todos sus productos) o de un
 * PRODUCTO puntual. La regla de herencia es REEMPLAZO TOTAL: si un producto
 * tiene extras propios, los de su categoría no se muestran para ese producto.
 * Esa decisión NO vive acá — la resuelve get_checkout_extras en el servidor,
 * junto con el precio, el stock y el orden.
 */

export type ExtraOwnerType = 'category' | 'product';
export type ExtraOrigin = ExtraOwnerType;

/** Fila de la tabla, con el producto del accesorio ya resuelto para pintarla. */
export interface CheckoutExtraRule {
	id: string;
	owner_type: ExtraOwnerType;
	owner_category_id: string | null;
	owner_product_id: string | null;
	extra_product_id: string;
	extra_variant_id: string | null;
	note: string | null;
	position: number;
	active: boolean;
	// Traído por el join para mostrar la lista.
	product: {
		id: string;
		name: string;
		slug: string;
		images: string[] | null;
		active: boolean | null;
		source: string | null;
		online_payment: boolean | null;
	} | null;
}

/** Lo que la tienda muestra: ya resuelto, con precio y stock reales. */
export interface CheckoutExtra {
	extra_variant_id: string;
	product_id: string;
	name: string;
	slug: string;
	image: string;
	price_usd: number;
	stock: number;
	note: string | null;
	origin: ExtraOrigin;
}

const SELECT_RULE = `
	id, owner_type, owner_category_id, owner_product_id,
	extra_product_id, extra_variant_id, note, position, active,
	product:products!checkout_extras_extra_product_id_fkey (
		id, name, slug, images, active, source, online_payment
	)
`;

/* ------------------------------------------------------------------ */
/*  TIENDA                                                            */
/* ------------------------------------------------------------------ */

/**
 * Extras a ofrecer para un carrito. Devuelve la lista final: el servidor ya
 * aplicó la herencia, descartó lo que no tiene stock o no se puede pagar
 * online, sacó lo que el cliente ya lleva y calculó el precio de venta.
 *
 * Best-effort: si falla, devuelve vacío. El checkout NUNCA se rompe porque no
 * se hayan podido ofrecer accesorios.
 */
export const getCheckoutExtras = async (
	variantIds: string[],
	limit = 4
): Promise<CheckoutExtra[]> => {
	if (variantIds.length === 0) return [];
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const { data, error } = await (supabase.rpc as any)('get_checkout_extras', {
			p_variant_ids: variantIds,
			p_limit: limit,
		});
		if (error) throw new Error(error.message);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return ((data ?? []) as any[]).map(r => ({
			extra_variant_id: r.extra_variant_id,
			product_id: r.product_id,
			name: r.name,
			slug: r.slug,
			image: r.image ?? '',
			price_usd: Number(r.price_usd) || 0,
			stock: Number(r.stock) || 0,
			note: r.note ?? null,
			origin: r.origin as ExtraOrigin,
		}));
	} catch (e) {
		console.warn('getCheckoutExtras:', e);
		return [];
	}
};

/* ------------------------------------------------------------------ */
/*  PANEL                                                             */
/* ------------------------------------------------------------------ */

/** Extras cargados en una categoría, en orden. */
export const getCategoryExtras = async (
	categoryId: string
): Promise<CheckoutExtraRule[]> => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { data, error } = await (supabase as any)
		.from('checkout_extras')
		.select(SELECT_RULE)
		.eq('owner_type', 'category')
		.eq('owner_category_id', categoryId)
		.order('position');
	if (error) throw new Error(error.message);
	return (data ?? []) as CheckoutExtraRule[];
};

/** Extras cargados en un producto puntual, en orden. */
export const getProductExtras = async (
	productId: string
): Promise<CheckoutExtraRule[]> => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { data, error } = await (supabase as any)
		.from('checkout_extras')
		.select(SELECT_RULE)
		.eq('owner_type', 'product')
		.eq('owner_product_id', productId)
		.order('position');
	if (error) throw new Error(error.message);
	return (data ?? []) as CheckoutExtraRule[];
};

/** Cuántos extras tiene cargados cada categoría (para los contadores del panel). */
export const getExtrasCountByCategory = async (): Promise<
	Record<string, number>
> => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { data, error } = await (supabase as any)
		.from('checkout_extras')
		.select('owner_category_id')
		.eq('owner_type', 'category')
		.eq('active', true);
	if (error) throw new Error(error.message);
	const map: Record<string, number> = {};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	for (const row of (data ?? []) as any[]) {
		if (!row.owner_category_id) continue;
		map[row.owner_category_id] = (map[row.owner_category_id] ?? 0) + 1;
	}
	return map;
};

export const addExtra = async (input: {
	ownerType: ExtraOwnerType;
	ownerId: string;
	extraProductId: string;
	note?: string | null;
	position?: number;
}): Promise<void> => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { error } = await (supabase as any).from('checkout_extras').insert({
		owner_type: input.ownerType,
		owner_category_id: input.ownerType === 'category' ? input.ownerId : null,
		owner_product_id: input.ownerType === 'product' ? input.ownerId : null,
		extra_product_id: input.extraProductId,
		note: input.note ?? null,
		position: input.position ?? 0,
	});
	if (error) {
		// El índice único da un mensaje ilegible; lo traducimos.
		if (/duplicate key|unique/i.test(error.message))
			throw new Error('Ese producto ya está en la lista');
		if (/autoreferencia/i.test(error.message))
			throw new Error('Un producto no puede ser extra de sí mismo');
		throw new Error(error.message);
	}
};

export const updateExtra = async (
	id: string,
	patch: Partial<Pick<CheckoutExtraRule, 'note' | 'position' | 'active'>>
): Promise<void> => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { error } = await (supabase as any)
		.from('checkout_extras')
		.update(patch)
		.eq('id', id);
	if (error) throw new Error(error.message);
};

export const deleteExtra = async (id: string): Promise<void> => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { error } = await (supabase as any)
		.from('checkout_extras')
		.delete()
		.eq('id', id);
	if (error) throw new Error(error.message);
};

/** Reordena una lista completa: la posición es el índice del array. */
export const reorderExtras = async (ids: string[]): Promise<void> => {
	await Promise.all(ids.map((id, i) => updateExtra(id, { position: i })));
};
