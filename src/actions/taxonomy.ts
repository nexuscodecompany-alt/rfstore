import { supabase } from '../supabase/client';

export interface Brand {
	id: string;
	name: string;
	hidden?: boolean;
}

export interface Category {
	id: string;
	name: string;
}

export interface Subcategory {
	id: string;
	name: string;
	category_id: string;
	sort_order?: number;
}

/* ----------------------------- LECTURA ----------------------------- */
// Marcas visibles para el público (excluye las marcadas hidden, ej. "CDR").
export const getBrands = async (): Promise<Brand[]> => {
	const { data, error } = await supabase
		.from('brands')
		.select('*')
		.eq('hidden', false)
		.order('name');
	if (error) throw new Error(error.message);
	return data as Brand[];
};

// Marcas para el admin (incluye las ocultas, ej. "CDR" donde se acumulan productos
// sin clasificar).
export const getBrandsAdmin = async (): Promise<Brand[]> => {
	const { data, error } = await supabase.from('brands').select('*').order('name');
	if (error) throw new Error(error.message);
	return data as Brand[];
};

export const getCategories = async (): Promise<Category[]> => {
	const { data, error } = await supabase.from('categories').select('*').order('name');
	if (error) throw new Error(error.message);
	return data as Category[];
};

export const getSubcategories = async (): Promise<Subcategory[]> => {
	const { data, error } = await supabase
		.from('subcategories')
		.select('id, name, category_id, sort_order')
		.order('sort_order', { ascending: true })
		.order('name');
	if (error) throw new Error(error.message);
	return (data as unknown) as Subcategory[];
};

// Devuelve los ids de marcas que tienen productos visibles en las categorías
// (y, si se indican, subcategorías) dadas. Usa la vista products_with_price,
// así respeta el filtro de stock (los CDR sin stock no cuentan como marca activa).
export const getBrandIdsByCategories = async (
	categoryIds: string[],
	subcategoryIds: string[] = []
): Promise<string[]> => {
	if (!categoryIds.length) return [];
	let query = supabase
		.from('products_with_price')
		.select('brand_id')
		.in('category_id', categoryIds)
		.not('brand_id', 'is', null);
	if (subcategoryIds.length) query = query.in('subcategory_id', subcategoryIds);

	const { data, error } = await query;
	if (error) throw new Error(error.message);

	const ids = new Set<string>();
	(data ?? []).forEach(row => {
		if (row.brand_id) ids.add(row.brand_id as string);
	});
	return [...ids];
};

/* ------------------------------ MARCAS ----------------------------- */
export const createBrand = async (name: string): Promise<Brand> => {
	const { data, error } = await supabase
		.from('brands')
		.insert({ name })
		.select()
		.single();
	if (error) throw new Error(error.message);
	return data as Brand;
};

export const updateBrand = async ({ id, name }: { id: string; name: string }) => {
	const { error } = await supabase.from('brands').update({ name }).eq('id', id);
	if (error) throw new Error(error.message);
};

export const deleteBrand = async (id: string) => {
	const { error } = await supabase.from('brands').delete().eq('id', id);
	if (error) throw new Error(error.message);
};

/* ---------------------------- CATEGORÍAS --------------------------- */
export const createCategory = async (name: string): Promise<Category> => {
	const { data, error } = await supabase
		.from('categories')
		.insert({ name })
		.select()
		.single();
	if (error) throw new Error(error.message);
	return data as Category;
};

export const updateCategory = async ({ id, name }: { id: string; name: string }) => {
	const { error } = await supabase.from('categories').update({ name }).eq('id', id);
	if (error) throw new Error(error.message);
};

export const deleteCategory = async (id: string) => {
	const { error } = await supabase.from('categories').delete().eq('id', id);
	if (error) throw new Error(error.message);
};

/* --------------------------- SUBCATEGORÍAS ------------------------- */
export const createSubcategory = async ({
	name,
	category_id,
}: {
	name: string;
	category_id: string;
}): Promise<Subcategory> => {
	// sort_order tiene default 0 en la base, así que sin esto toda subcategoría nueva
	// se colaba PRIMERA en el menú del navbar. La mandamos al final (max + 1).
	const { data: last } = await supabase
		.from('subcategories')
		.select('sort_order')
		.eq('category_id', category_id)
		.order('sort_order', { ascending: false })
		.limit(1)
		.maybeSingle();
	const nextOrder = Number((last as { sort_order?: number } | null)?.sort_order ?? 0) + 1;

	const { data, error } = await supabase
		.from('subcategories')
		.insert({ name, category_id, sort_order: nextOrder } as never)
		.select('id, name, category_id')
		.single();
	if (error) throw new Error(error.message);
	return data as Subcategory;
};

export const updateSubcategory = async ({
	id,
	name,
	category_id,
}: {
	id: string;
	name?: string;
	category_id?: string;
}) => {
	const patch: Record<string, unknown> = {};
	if (name !== undefined) patch.name = name;
	if (category_id !== undefined) patch.category_id = category_id;
	const { error } = await supabase.from('subcategories').update(patch).eq('id', id);
	if (error) throw new Error(error.message);
};

export const deleteSubcategory = async (id: string) => {
	const { error } = await supabase.from('subcategories').delete().eq('id', id);
	if (error) throw new Error(error.message);
};

// Persiste el orden de las subcategorías de una categoría: sort_order = índice+1.
export const reorderSubcategories = async (orderedIds: string[]) => {
	await Promise.all(
		orderedIds.map((id, i) =>
			supabase
				.from('subcategories')
				.update({ sort_order: i + 1 } as never)
				.eq('id', id)
		)
	);
};
