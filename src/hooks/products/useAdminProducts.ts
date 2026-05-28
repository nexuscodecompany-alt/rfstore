import { useQuery } from '@tanstack/react-query';
import { getAdminProducts } from '../../actions';

// Listado de productos para el panel admin (incluye inactivos y CDR sin stock).
// Filtros opcionales por marca y categoría ('none' = sin categoría).
export const useAdminProducts = (
	page: number,
	searchTerm: string,
	brandId = '',
	categoryId = '',
	source: '' | 'local' | 'cdr' = ''
) => {
	const { data, isLoading } = useQuery({
		queryKey: ['admin-products', page, searchTerm, brandId, categoryId, source],
		queryFn: () =>
			getAdminProducts(page, searchTerm, brandId, categoryId, source),
	});

	return {
		products: data?.products ?? [],
		totalProducts: data?.count ?? 0,
		isLoading,
	};
};
