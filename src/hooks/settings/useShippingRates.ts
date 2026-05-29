import { useQuery } from '@tanstack/react-query';
import { getShippingRates } from '../../actions';

export const useShippingRates = () =>
	useQuery({
		queryKey: ['shipping_rates'],
		queryFn: getShippingRates,
		staleTime: 5 * 60 * 1000,
	});
