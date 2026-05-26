import { useQuery } from '@tanstack/react-query';
import { getAdminProducts } from '../../actions';

// Listado de productos para el panel admin (incluye inactivos y CDR sin stock).
export const useAdminProducts = (page: number, searchTerm: string) => {
	const { data, isLoading } = useQuery({
		queryKey: ['admin-products', page, searchTerm],
		queryFn: () => getAdminProducts(page, searchTerm),
	});

	return {
		products: data?.products ?? [],
		totalProducts: data?.count ?? 0,
		isLoading,
	};
};
