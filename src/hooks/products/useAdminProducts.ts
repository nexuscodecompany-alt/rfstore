import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getAdminProducts, getNewProductsCount, markProductsSeen } from '../../actions';

export const useAdminProducts = (
	page: number,
	searchTerm: string,
	brandId = '',
	categoryId = '',
	source: '' | 'local' | 'cdr' = '',
	activeFilter: '' | 'active' | 'inactive' = '',
	newOnly = false,
	mlFilter: '' | 'in' | 'out' = '',
	minReadiness = 0
) => {
	const { data, isLoading } = useQuery({
		queryKey: ['admin-products', page, searchTerm, brandId, categoryId, source, activeFilter, newOnly, mlFilter, minReadiness],
		queryFn: () =>
			getAdminProducts(page, searchTerm, brandId, categoryId, source, activeFilter, newOnly, mlFilter, minReadiness),
	});

	return {
		products: data?.products ?? [],
		totalProducts: data?.count ?? 0,
		isLoading,
	};
};

export const useNewProductsCount = () => {
	const { data } = useQuery({
		queryKey: ['new-products-count'],
		queryFn: getNewProductsCount,
		refetchInterval: 60_000,
	});
	return data ?? 0;
};

export const useMarkProductsSeen = () => {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (ids?: string[]) => markProductsSeen(ids),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['new-products-count'] });
			qc.invalidateQueries({ queryKey: ['admin-products'] });
		},
	});
};
