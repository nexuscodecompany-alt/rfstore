import { useQuery } from '@tanstack/react-query';
import { getPricingConfig } from '../../actions/pricing';
import { DEFAULT_PRICING } from '../../helpers';

export const usePricingConfig = () => {
	const { data } = useQuery({
		queryKey: ['pricing_config'],
		queryFn: getPricingConfig,
		staleTime: 5 * 60_000,
	});
	return data ?? DEFAULT_PRICING;
};
