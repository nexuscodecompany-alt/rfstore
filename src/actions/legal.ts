import { supabase } from '../supabase/client';

export interface LegalPage {
	title: string;
	content: string;
}
export type LegalPagesMap = Record<string, LegalPage>;

export const getLegalPages = async (): Promise<LegalPagesMap> => {
	const { data, error } = await supabase
		.from('app_settings')
		.select('value')
		.eq('key', 'legal_pages')
		.maybeSingle();
	if (error) {
		console.warn('getLegalPages:', error.message);
		return {};
	}
	const v = data?.value;
	return v && typeof v === 'object' && !Array.isArray(v)
		? (v as unknown as LegalPagesMap)
		: {};
};

export const updateLegalPages = async (map: LegalPagesMap) => {
	const { error } = await supabase.from('app_settings').upsert({
		key: 'legal_pages',
		value: map as never,
		updated_at: new Date().toISOString(),
	});
	if (error) throw new Error(error.message);
};
