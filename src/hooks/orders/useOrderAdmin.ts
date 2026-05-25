import { useQuery } from '@tanstack/react-query';
import { getOrderByIdAdmin } from '../../actions';

export const useOrderAdmin = (id: number) => {
	const { data, isLoading, isError, error } = useQuery({
		queryKey: ['order', 'admin', id],
		queryFn: () => getOrderByIdAdmin(id),
		enabled: !!id,
		retry: false,
	});

	return {
		data,
		isLoading,
		isError,
		error,
	};
};
