import { useQuery } from '@tanstack/react-query';
import { getLegalPages } from '../../actions/legal';

export const useLegalPages = () =>
	useQuery({
		queryKey: ['legal_pages'],
		queryFn: getLegalPages,
		staleTime: 5 * 60_000,
	});
