import { useQuery } from '@tanstack/react-query';
import { getHomeData } from '../../actions/home';

export const useHomeSections = () => {
	const { data, isLoading, isError } = useQuery({
		queryKey: ['home-sections'],
		queryFn: getHomeData,
	});

	return {
		featured: data?.featured ?? [],
		recent: data?.recent ?? [],
		popular: data?.popular ?? [],
		isLoading,
		isError,
	};
};
