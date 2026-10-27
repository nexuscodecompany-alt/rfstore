import { supabase } from '../supabase/client';
import { DEFAULT_SHIPPING_RATES, ShippingRates } from '../constants/shipping';

const num = (v: unknown, fallback: number) => {
	const n = Number(v);
	return v === null || v === undefined || isNaN(n) ? fallback : n;
};

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
	const v = (data?.value ?? {}) as Partial<ShippingRates>;
	// Sanitización defensiva
	return {
		montevideo_usd: num(v.montevideo_usd, DEFAULT_SHIPPING_RATES.montevideo_usd),
		canelones_usd: num(v.canelones_usd, DEFAULT_SHIPPING_RATES.canelones_usd),
		free_min_usd: num(v.free_min_usd, DEFAULT_SHIPPING_RATES.free_min_usd),
		free_includes_canelones:
			typeof v.free_includes_canelones === 'boolean'
				? v.free_includes_canelones
				: DEFAULT_SHIPPING_RATES.free_includes_canelones,
		same_day_cutoff_hour: num(v.same_day_cutoff_hour, DEFAULT_SHIPPING_RATES.same_day_cutoff_hour),
	};
};

// Se mezcla con lo que ya hay guardado: mientras conviva el checkout viejo,
// app_settings.shipping_rates conserva sus claves de zonas PQuick.
export const updateShippingRates = async (rates: ShippingRates) => {
	const { data: current } = await supabase
		.from('app_settings')
		.select('value')
		.eq('key', 'shipping_rates')
		.maybeSingle();
	const { error } = await supabase.from('app_settings').upsert({
		key: 'shipping_rates',
		value: { ...((current?.value as object) ?? {}), ...rates } as never,
		updated_at: new Date().toISOString(),
	});
	if (error) throw new Error(error.message);
};
