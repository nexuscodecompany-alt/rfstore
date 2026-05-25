import { useQuery } from '@tanstack/react-query';
import { getDashboardData } from '../../actions/dashboard';

export const useDashboardMetrics = (from: string, to: string) => {
	const { data, isLoading, isError, refetch, isFetching } = useQuery({
		queryKey: ['dashboard-metrics', from, to],
		queryFn: () => getDashboardData(from, to),
		staleTime: 60_000,
	});

	return { data, isLoading, isError, refetch, isFetching };
};
