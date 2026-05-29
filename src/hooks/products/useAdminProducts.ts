import { useQuery } from '@tanstack/react-query';
import { getAdminProducts } from '../../actions';

// Listado de productos para el panel admin (incluye inactivos y CDR sin stock).
// Filtros opcionales por marca y categoría ('none' = sin categoría).
export const useAdminProducts = (
	page: number,
	searchTerm: string,
	brandId = '',
	categoryId = '',
	source: '' | 'local' | 'cdr' = '',
	activeFilter: '' | 'active' | 'inactive' = ''
) => {
	const { data, isLoading } = useQuery({
		queryKey: ['admin-products', page, searchTerm, brandId, categoryId, source, activeFilter],
		queryFn: () =>
			getAdminProducts(page, searchTerm, brandId, categoryId, source, activeFilter),
	});

	return {
		products: data?.products ?? [],
		totalProducts: data?.count ?? 0,
		isLoading,
	};
};
