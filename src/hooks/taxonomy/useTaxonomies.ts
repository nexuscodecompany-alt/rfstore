import { useQueries } from '@tanstack/react-query';
import {
	getBrands,
	getBrandsAdmin,
	getCategories,
	getSubcategories,
} from '../../actions';

// Para la tienda y todo lo público: filtra marcas hidden (ej. "CDR").
export const useTaxonomies = () => {
	const results = useQueries({
		queries: [
			{ queryKey: ['brands', 'public'], queryFn: getBrands },
			{ queryKey: ['categories'], queryFn: getCategories },
			{ queryKey: ['subcategories'], queryFn: getSubcategories },
		],
	});

	const [brandsResult, categoriesResult, subcategoriesResult] = results;

	return {
		brands: brandsResult.data || [],
		categories: categoriesResult.data || [],
		subcategories: subcategoriesResult.data || [],
		isLoading:
			brandsResult.isLoading ||
			categoriesResult.isLoading ||
			subcategoriesResult.isLoading,
		isError:
			brandsResult.isError ||
			categoriesResult.isError ||
			subcategoriesResult.isError,
	};
};

// Para el admin: incluye marcas hidden (ej. "CDR" donde van los productos sin clasificar).
export const useTaxonomiesAdmin = () => {
	const results = useQueries({
		queries: [
			{ queryKey: ['brands', 'admin'], queryFn: getBrandsAdmin },
			{ queryKey: ['categories'], queryFn: getCategories },
			{ queryKey: ['subcategories'], queryFn: getSubcategories },
		],
	});

	const [brandsResult, categoriesResult, subcategoriesResult] = results;

	return {
		brands: brandsResult.data || [],
		categories: categoriesResult.data || [],
		subcategories: subcategoriesResult.data || [],
		isLoading:
			brandsResult.isLoading ||
			categoriesResult.isLoading ||
			subcategoriesResult.isLoading,
		isError:
			brandsResult.isError ||
			categoriesResult.isError ||
			subcategoriesResult.isError,
	};
};
