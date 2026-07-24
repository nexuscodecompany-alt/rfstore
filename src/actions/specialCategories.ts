import { supabase } from '../supabase/client';
import type { Product } from '../interfaces';
import { hideOutOfStockCdrProducts } from './product';

/* ------------------------------------------------------------------ */
/*  CATEGORÍAS ESPECIALES (colecciones)                                */
/*                                                                     */
/*  Son categorías "por encima" de la taxonomía real: sirven para      */
/*  campañas puntuales (Día del Niño, Black Friday, Vuelta a clases).  */
/*  Un producto puede estar en una especial SIN perder su categoría    */
/*  real — `products.category_id` NO se toca. La relación vive en la   */
/*  tabla puente `special_category_products`, así que borrar la        */
/*  especial (ON DELETE CASCADE) no afecta nada del funcionamiento     */
/*  normal de la web: los productos siguen intactos en su categoría.   */
/* ------------------------------------------------------------------ */

// Las tablas son nuevas y todavía no están en `supabase/types.ts` (generado).
// Casteamos sólo acá para no perder el tipado del resto de la app; la superficie
// pública de este módulo está tipada a mano con las interfaces de abajo.
const db = supabase as unknown as {
	from: (table: string) => any;
};

export interface SpecialCategory {
	id: string;
	name: string;
	slug: string;
	active: boolean;
	sort_order: number;
}

/** Slug legible para la URL de la tienda: "Día del Niño" -> "dia-del-nino". */
export const slugifySpecial = (name: string) =>
	name
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '') // saca acentos
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60) || 'coleccion';

/* ----------------------------- LECTURA ----------------------------- */

/** Todas (activas e inactivas). Para el panel de admin. */
export const getSpecialCategories = async (): Promise<SpecialCategory[]> => {
	const { data, error } = await db
		.from('special_categories')
		.select('id, name, slug, active, sort_order')
		.order('sort_order', { ascending: true })
		.order('name');
	if (error) throw new Error(error.message);
	return (data ?? []) as SpecialCategory[];
};

/** Sólo las activas. Para las pills de la tienda / links públicos. */
export const getActiveSpecialCategories = async (): Promise<SpecialCategory[]> => {
	const { data, error } = await db
		.from('special_categories')
		.select('id, name, slug, active, sort_order')
		.eq('active', true)
		.order('sort_order', { ascending: true })
		.order('name');
	if (error) throw new Error(error.message);
	return (data ?? []) as SpecialCategory[];
};

/** Ids de productos asignados a una especial, en el orden elegido por el admin. */
export const getSpecialCategoryProductIds = async (
	specialCategoryId: string
): Promise<string[]> => {
	if (!specialCategoryId) return [];
	const { data, error } = await db
		.from('special_category_products')
		.select('product_id, sort_order')
		.eq('special_category_id', specialCategoryId)
		.order('sort_order', { ascending: true });
	if (error) throw new Error(error.message);
	return (data ?? []).map((r: { product_id: string }) => r.product_id);
};

/**
 * Ids de productos de una especial buscada por SLUG (lo que llega por
 * `/tienda?special=dia-del-nino`). Devuelve null si el slug no existe o la
 * colección está apagada: así la tienda puede ignorar el parámetro en vez de
 * mostrar "sin resultados" cuando el link quedó viejo.
 */
export const getSpecialCategoryBySlug = async (
	slug: string
): Promise<{ category: SpecialCategory; productIds: string[] } | null> => {
	if (!slug.trim()) return null;
	const { data, error } = await db
		.from('special_categories')
		.select('id, name, slug, active, sort_order')
		.eq('slug', slug.trim())
		.eq('active', true)
		.maybeSingle();
	if (error) throw new Error(error.message);
	if (!data) return null;
	const category = data as SpecialCategory;
	const productIds = await getSpecialCategoryProductIds(category.id);
	return { category, productIds };
};

/** Productos completos de una especial (para el picker del panel). */
export const getSpecialCategoryProducts = async (
	specialCategoryId: string
): Promise<Product[]> => {
	const ids = await getSpecialCategoryProductIds(specialCategoryId);
	if (!ids.length) return [];
	const { data, error } = await supabase
		.from('products')
		.select('*, variants(*), brand:brands(*), category:categories(*)')
		.in('id', ids);
	if (error) throw new Error(error.message);
	// Conserva el orden elegido por el admin (la query vuelve desordenada).
	const map = new Map((data ?? []).map((p: any) => [p.id, p]));
	return ids.map(id => map.get(id)).filter(Boolean) as unknown as Product[];
};

/* ----------------------------- ESCRITURA ---------------------------- */

/** Crea una especial. Si el slug ya existe, le agrega sufijo (-2, -3, …). */
export const createSpecialCategory = async (
	name: string
): Promise<SpecialCategory> => {
	const base = slugifySpecial(name);

	const { data: taken, error: takenErr } = await db
		.from('special_categories')
		.select('slug')
		.like('slug', `${base}%`);
	if (takenErr) throw new Error(takenErr.message);

	const used = new Set((taken ?? []).map((r: { slug: string }) => r.slug));
	let slug = base;
	let n = 2;
	while (used.has(slug)) slug = `${base}-${n++}`;

	const { data, error } = await db
		.from('special_categories')
		.insert({ name: name.trim(), slug })
		.select('id, name, slug, active, sort_order')
		.single();
	if (error) throw new Error(error.message);
	return data as SpecialCategory;
};

/**
 * Renombrar / activar / desactivar. Al renombrar NO regeneramos el slug a
 * propósito: los links ya compartidos (ads, WhatsApp) tienen que seguir vivos.
 */
export const updateSpecialCategory = async ({
	id,
	name,
	active,
}: {
	id: string;
	name?: string;
	active?: boolean;
}) => {
	const patch: Record<string, unknown> = {};
	if (name !== undefined) patch.name = name.trim();
	if (active !== undefined) patch.active = active;
	if (!Object.keys(patch).length) return;
	const { error } = await db.from('special_categories').update(patch).eq('id', id);
	if (error) throw new Error(error.message);
};

/**
 * Borra la especial. Las asignaciones caen solas (ON DELETE CASCADE) y los
 * productos quedan exactamente como estaban: no se toca `products`.
 */
export const deleteSpecialCategory = async (id: string) => {
	const { error } = await db.from('special_categories').delete().eq('id', id);
	if (error) throw new Error(error.message);
};

/** Reemplaza la lista completa de productos de una especial, respetando el orden. */
export const setSpecialCategoryProducts = async (
	specialCategoryId: string,
	productIds: string[]
) => {
	const { error: delErr } = await db
		.from('special_category_products')
		.delete()
		.eq('special_category_id', specialCategoryId);
	if (delErr) throw new Error(delErr.message);

	if (!productIds.length) return;

	const rows = productIds.map((product_id, i) => ({
		special_category_id: specialCategoryId,
		product_id,
		sort_order: i,
	}));
	const { error } = await db.from('special_category_products').insert(rows);
	if (error) throw new Error(error.message);
};

/* --------------------------- HOME / VITRINA -------------------------- */

/** Productos visibles de una especial por slug (oculta CDR sin stock). */
export const getSpecialCategoryProductsBySlug = async (
	slug: string
): Promise<Product[]> => {
	const found = await getSpecialCategoryBySlug(slug);
	if (!found || !found.productIds.length) return [];
	const { data, error } = await supabase
		.from('products')
		.select('*, variants(*), brand:brands(*), category:categories(*)')
		.eq('active', true)
		.in('id', found.productIds);
	if (error) throw new Error(error.message);
	const visible = hideOutOfStockCdrProducts(data ?? []);
	const map = new Map(visible.map((p: any) => [p.id, p]));
	return found.productIds
		.map(id => map.get(id))
		.filter(Boolean) as unknown as Product[];
};
