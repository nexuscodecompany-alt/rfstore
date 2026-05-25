import { supabase } from '../supabase/client';
import { DEFAULT_PRICING, PricingConfig } from '../helpers';

const normalize = (raw: unknown): PricingConfig => {
	if (!raw || typeof raw !== 'object') return DEFAULT_PRICING;
	const obj = raw as Partial<PricingConfig>;
	const iva = Number(obj.iva_percent);
	const tiers = Array.isArray(obj.tiers) ? obj.tiers : [];
	if (!tiers.length || isNaN(iva)) return DEFAULT_PRICING;
	return {
		iva_percent: iva,
		tiers: tiers.map(t => ({
			max: t.max === null || t.max === undefined ? null : Number(t.max),
			pct: Number(t.pct),
		})),
	};
};

export const getPricingConfig = async (): Promise<PricingConfig> => {
	const { data, error } = await supabase
		.from('app_settings')
		.select('value')
		.eq('key', 'pricing_config')
		.maybeSingle();

	if (error) {
		console.warn('getPricingConfig:', error.message);
		return DEFAULT_PRICING;
	}
	return normalize(data?.value);
};

export const updatePricingConfig = async (cfg: PricingConfig) => {
	const { error } = await supabase.from('app_settings').upsert({
		key: 'pricing_config',
		value: cfg as never,
		updated_at: new Date().toISOString(),
	});
	if (error) throw new Error(error.message);
};
