import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getAdminProducts, getContentDirtyCount, getNewProductsCount, markProductsSeen } from '../../actions';
import type { AdminSortField } from '../../actions/product';

export const useAdminProducts = (
	page: number,
	searchTerm: string,
	brandId = '',
	categoryId = '',
	source: '' | 'local' | 'cdr' = '',
	activeFilter: '' | 'active' | 'inactive' = '',
	newOnly = false,
	mlFilter: '' | 'in' | 'out' = '',
	minReadiness = 0,
	contentDirtyOnly = false,
	sortBy: AdminSortField = 'created_at',
	sortDir: 'asc' | 'desc' = 'desc'
) => {
	const { data, isLoading } = useQuery({
		queryKey: ['admin-products', page, searchTerm, brandId, categoryId, source, activeFilter, newOnly, mlFilter, minReadiness, contentDirtyOnly, sortBy, sortDir],
		queryFn: () =>
			getAdminProducts(page, searchTerm, brandId, categoryId, source, activeFilter, newOnly, mlFilter, minReadiness, contentDirtyOnly, sortBy, sortDir),
	});

	return {
		products: data?.products ?? [],
		totalProducts: data?.count ?? 0,
		isLoading,
	};
};

// Cantidad de productos en ML con cambios de contenido de CDR pendientes de actualizar.
export const useContentDirtyCount = () => {
	const { data } = useQuery({
		queryKey: ['content-dirty-count'],
		queryFn: getContentDirtyCount,
		refetchInterval: 60_000,
	});
	return data ?? 0;
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
