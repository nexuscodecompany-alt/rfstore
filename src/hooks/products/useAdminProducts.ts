import { useQuery } from '@tanstack/react-query';
import { getAdminProducts } from '../../actions';

// Listado de productos para el panel admin (incluye inactivos y CDR sin stock).
// Filtros opcionales por marca y categoría ('none' = sin categoría).
export const useAdminProducts = (
	page: number,
	searchTerm: string,
	brandId = '',
	categoryId = ''
) => {
	const { data, isLoading } = useQuery({
		queryKey: ['admin-products', page, searchTerm, brandId, categoryId],
		queryFn: () => getAdminProducts(page, searchTerm, brandId, categoryId),
	});

	return {
		products: data?.products ?? [],
		totalProducts: data?.count ?? 0,
		isLoading,
	};
};
