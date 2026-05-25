import { useQueries } from '@tanstack/react-query';
import { getBrands, getCategories, getSubcategories } from '../../actions';

export const useTaxonomies = () => {
	const results = useQueries({
		queries: [
			{ queryKey: ['brands'], queryFn: getBrands },
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
