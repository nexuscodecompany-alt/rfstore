import { supabase } from '../supabase/client';
import { DEFAULT_ML_PRICING, MlPricingConfig } from '../helpers';

const ML_PRICING_KEY = 'ml_pricing_config';

const normalize = (raw: unknown): MlPricingConfig => {
	if (!raw || typeof raw !== 'object') return DEFAULT_ML_PRICING;
	const obj = raw as Partial<MlPricingConfig>;
	const iva = Number(obj.iva_percent);
	const threshold = Number(obj.usd_threshold);
	const tiers = Array.isArray(obj.tiers) ? obj.tiers : [];
	if (!tiers.length || isNaN(iva)) return DEFAULT_ML_PRICING;
	return {
		iva_percent: iva,
		usd_threshold: isNaN(threshold) ? DEFAULT_ML_PRICING.usd_threshold : threshold,
		tiers: tiers.map(t => ({
			max: t.max === null || t.max === undefined ? null : Number(t.max),
			pct: Number(t.pct),
		})),
		category_overrides: (obj.category_overrides && typeof obj.category_overrides === 'object'
			? Object.fromEntries(
					Object.entries(obj.category_overrides).map(([k, v]) => [k, Number(v)])
			  )
			: {}) as Record<string, number>,
		subcategory_overrides: (obj.subcategory_overrides && typeof obj.subcategory_overrides === 'object'
			? Object.fromEntries(
					Object.entries(obj.subcategory_overrides).map(([k, v]) => [k, Number(v)])
			  )
			: {}) as Record<string, number>,
	};
};

// Si todavía no existe ml_pricing_config, derivamos un default desde los settings
// viejos (ml_markup_percent / ml_usd_threshold / pricing_config.iva_percent) para
// que el precio ML quede idéntico al actual hasta que el admin configure reglas.
const deriveDefaultFromLegacy = async (): Promise<MlPricingConfig> => {
	const { data } = await supabase
		.from('app_settings')
		.select('key, value')
		.in('key', ['ml_markup_percent', 'ml_usd_threshold', 'pricing_config']);
	const map = new Map((data ?? []).map(r => [r.key, r.value]));
	const markup = Number(map.get('ml_markup_percent') ?? 30);
	const threshold = Number(map.get('ml_usd_threshold') ?? 100);
	const iva = Number((map.get('pricing_config') as { iva_percent?: number } | undefined)?.iva_percent ?? 22);
	return {
		iva_percent: isNaN(iva) ? 22 : iva,
		usd_threshold: isNaN(threshold) ? 100 : threshold,
		tiers: [{ max: null, pct: isNaN(markup) ? 30 : markup }],
		category_overrides: {},
		subcategory_overrides: {},
	};
};

export const getMlPricingConfig = async (): Promise<MlPricingConfig> => {
	const { data, error } = await supabase
		.from('app_settings')
		.select('value')
		.eq('key', ML_PRICING_KEY)
		.maybeSingle();
	if (error) {
		console.warn('getMlPricingConfig:', error.message);
		return DEFAULT_ML_PRICING;
	}
	if (data?.value == null) return await deriveDefaultFromLegacy();
	return normalize(data.value);
};

export const updateMlPricingConfig = async (cfg: MlPricingConfig) => {
	const { error } = await supabase.from('app_settings').upsert({
		key: ML_PRICING_KEY,
		value: cfg as never,
		updated_at: new Date().toISOString(),
	});
	if (error) throw new Error(error.message);
};
