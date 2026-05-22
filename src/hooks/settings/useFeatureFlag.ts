import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../supabase/client';

const fetchFlag = async (key: string): Promise<boolean> => {
	const { data, error } = await supabase
		.from('app_settings')
		.select('value')
		.eq('key', key)
		.maybeSingle();
	if (error) {
		console.warn(`useFeatureFlag(${key}):`, error.message);
		return false;
	}
	return data?.value === true || data?.value === 'true';
};

export const useFeatureFlag = (key: string) => {
	return useQuery({
		queryKey: ['feature_flag', key],
		queryFn: () => fetchFlag(key),
		staleTime: 60_000,
	});
};

export const usePaymentsEnabled = () => {
	const { data, isLoading } = useFeatureFlag('payments_enabled');
	return { enabled: !!data, isLoading };
};
