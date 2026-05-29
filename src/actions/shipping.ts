import { supabase } from '../supabase/client';
import { DEFAULT_SHIPPING_RATES, ShippingRates } from '../constants/shipping';

export const getShippingRates = async (): Promise<ShippingRates> => {
	const { data, error } = await supabase
		.from('app_settings')
		.select('value')
		.eq('key', 'shipping_rates')
		.maybeSingle();
	if (error) {
		console.warn('getShippingRates:', error.message);
		return DEFAULT_SHIPPING_RATES;
	}
	const v = data?.value as unknown as ShippingRates | null;
	if (!v) return DEFAULT_SHIPPING_RATES;
	// Sanitización defensiva
	const mvd = v.montevideo ?? DEFAULT_SHIPPING_RATES.montevideo;
	return {
		montevideo: {
			centro: Number(mvd.centro) || 0,
			periferia: Number(mvd.periferia) || 0,
			costa: Number(mvd.costa) || 0,
		},
		interior_uyu: Number(v.interior_uyu) || 0,
	};
};

export const updateShippingRates = async (rates: ShippingRates) => {
	const { error } = await supabase.from('app_settings').upsert({
		key: 'shipping_rates',
		value: rates as never,
		updated_at: new Date().toISOString(),
	});
	if (error) throw new Error(error.message);
};
