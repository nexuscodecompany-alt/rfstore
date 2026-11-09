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

/**
 * Pago con tarjeta por Getnet (Placetopay): 'off' | 'admins' | 'all'.
 * Con 'admins' sólo lo ve un administrador (para probar en la tienda real).
 * El servidor vuelve a chequear lo mismo: esto es sólo para mostrar la opción.
 */
export const usePlacetopayMode = () => {
	return useQuery({
		queryKey: ['feature_flag', 'placetopay_mode'],
		queryFn: async (): Promise<'off' | 'admins' | 'all'> => {
			const { data, error } = await supabase
				.from('app_settings')
				.select('value')
				.eq('key', 'placetopay_mode')
				.maybeSingle();
			if (error) return 'off';
			const v = String(data?.value ?? 'off');
			return v === 'admins' || v === 'all' ? v : 'off';
		},
		staleTime: 60_000,
	});
};
