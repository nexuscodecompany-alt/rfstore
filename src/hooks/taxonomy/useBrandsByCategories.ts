import { useQuery } from '@tanstack/react-query';
import { getBrandIdsByCategories } from '../../actions';

// Marcas (ids) disponibles para las categorías/subcategorías seleccionadas.
// Sólo consulta cuando hay al menos una categoría seleccionada; si no, el filtro
// de marcas muestra todas.
export const useBrandsByCategories = (
	categoryIds: string[],
	subcategoryIds: string[]
) => {
	return useQuery({
		queryKey: [
			'brand-ids-by-category',
			[...categoryIds].sort(),
			[...subcategoryIds].sort(),
		],
		queryFn: () => getBrandIdsByCategories(categoryIds, subcategoryIds),
		enabled: categoryIds.length > 0,
		staleTime: 5 * 60_000,
	});
};
