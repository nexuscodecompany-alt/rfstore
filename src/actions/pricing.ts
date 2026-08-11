import { supabase } from '../supabase/client';
import {
	DEFAULT_PRICING,
	PricingConfig,
	CompareAtConfig,
	DEFAULT_COMPARE_AT,
} from '../helpers';

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

/* ====================================================================== */
/*  PRECIO "ANTES / AHORA" (vidriera)                                     */
/* ====================================================================== */

const normalizeCompareAt = (raw: unknown): CompareAtConfig => {
	if (!raw || typeof raw !== 'object') return DEFAULT_COMPARE_AT;
	const obj = raw as Partial<CompareAtConfig>;
	const percents = Array.isArray(obj.percents)
		? obj.percents.map(Number).filter(n => n > 0 && n < 90)
		: [];
	return {
		enabled: obj.enabled === true,
		percents: percents.length ? percents : DEFAULT_COMPARE_AT.percents,
	};
};

export const getCompareAtConfig = async (): Promise<CompareAtConfig> => {
	const { data, error } = await supabase
		.from('app_settings')
		.select('value')
		.eq('key', 'compare_at_config')
		.maybeSingle();

	if (error) {
		console.warn('getCompareAtConfig:', error.message);
		return DEFAULT_COMPARE_AT;
	}
	return normalizeCompareAt(data?.value);
};

export const updateCompareAtConfig = async (cfg: CompareAtConfig) => {
	const { error } = await supabase.from('app_settings').upsert({
		key: 'compare_at_config',
		value: cfg as never,
		updated_at: new Date().toISOString(),
	});
	if (error) throw new Error(error.message);
};
