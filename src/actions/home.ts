import { supabase } from '../supabase/client';
import type { Product } from '../interfaces';
import {
	getRandomProducts,
	getRecentProducts,
	hideOutOfStockCdrProducts,
} from './product';

export type HomeSectionKey = 'home_featured' | 'home_recent' | 'home_popular';

export const HOME_SECTION_LABELS: Record<HomeSectionKey, string> = {
	home_featured: 'Productos Destacados',
	home_recent: 'Recién Llegados',
	home_popular: 'Más Populares',
};

export const getHomeSectionIds = async (
	key: HomeSectionKey
): Promise<string[]> => {
	const { data, error } = await supabase
		.from('app_settings')
		.select('value')
		.eq('key', key)
		.maybeSingle();
	if (error) {
		console.warn('getHomeSectionIds:', error.message);
		return [];
	}
	const v = data?.value;
	return Array.isArray(v) ? (v as string[]) : [];
};

export const updateHomeSectionIds = async (
	key: HomeSectionKey,
	ids: string[]
) => {
	const { error } = await supabase.from('app_settings').upsert({
		key,
		value: ids as never,
		updated_at: new Date().toISOString(),
	});
	if (error) throw new Error(error.message);
};

// Trae productos por ids, conservando el orden recibido.
export const getProductsByIds = async (ids: string[]): Promise<Product[]> => {
	if (!ids.length) return [];
	const { data, error } = await supabase
		.from('products')
		.select('*, variants(*), brand:brands(*), category:categories(*)')
		.eq('active', true)
		.in('id', ids);
	if (error) throw new Error(error.message);
	const visible = hideOutOfStockCdrProducts(data ?? []);
	const map = new Map(visible.map(p => [p.id, p]));
	return ids
		.map(id => map.get(id))
		.filter(Boolean) as unknown as Product[];
};

export interface HomeData {
	featured: Product[];
	recent: Product[];
	popular: Product[];
}

// Datos para el home: usa la selección manual; si una sección está vacía, cae a automático.
export const getHomeData = async (): Promise<HomeData> => {
	const [fIds, rIds, pIds] = await Promise.all([
		getHomeSectionIds('home_featured'),
		getHomeSectionIds('home_recent'),
		getHomeSectionIds('home_popular'),
	]);

	const [featured, recent, popular] = await Promise.all([
		fIds.length
			? getProductsByIds(fIds)
			: (getRandomProducts() as unknown as Promise<Product[]>),
		rIds.length
			? getProductsByIds(rIds)
			: (getRecentProducts() as unknown as Promise<Product[]>),
		pIds.length
			? getProductsByIds(pIds)
			: (getRandomProducts() as unknown as Promise<Product[]>),
	]);

	return { featured, recent, popular };
};
