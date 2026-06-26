// deno-lint-ignore-file no-explicit-any
// Helpers compartidos para integraciones Mercado Libre.
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const ML_TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';
const ML_API_BASE = 'https://api.mercadolibre.com';

// ---------- Access token con auto-refresh ----------
export async function getValidAccessToken(supabase: SupabaseClient): Promise<{ token: string; ml_user_id: number }> {
	const { data: cred } = await supabase
		.from('ml_credentials')
		.select('id, access_token, refresh_token, expires_at, ml_user_id')
		.order('id', { ascending: false })
		.limit(1)
		.maybeSingle();

	if (!cred) throw new Error('no_ml_credentials');

	const expiresAt = new Date(cred.expires_at).getTime();
	const now = Date.now();
	// Refresh si vence en menos de 5min
	if (expiresAt - now < 5 * 60 * 1000) {
		const ML_CLIENT_ID = Deno.env.get('ML_CLIENT_ID')!;
		const ML_CLIENT_SECRET = Deno.env.get('ML_CLIENT_SECRET')!;
		const resp = await fetch(ML_TOKEN_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
			body: new URLSearchParams({
				grant_type: 'refresh_token',
				client_id: ML_CLIENT_ID,
				client_secret: ML_CLIENT_SECRET,
				refresh_token: cred.refresh_token,
			}).toString(),
		});
		const data: any = await resp.json().catch(() => ({}));
		if (!resp.ok) throw new Error(`refresh_failed: ${JSON.stringify(data).slice(0, 200)}`);
		const newExpires = new Date(Date.now() + (Number(data.expires_in) - 30) * 1000).toISOString();
		await supabase
			.from('ml_credentials')
			.update({
				access_token: data.access_token,
				refresh_token: data.refresh_token ?? cred.refresh_token,
				expires_at: newExpires,
			})
			.eq('id', cred.id);
		return { token: data.access_token, ml_user_id: cred.ml_user_id };
	}

	return { token: cred.access_token, ml_user_id: cred.ml_user_id };
}

// ---------- ML API fetch wrapper ----------
export async function mlFetch(
	path: string,
	options: { method?: string; token: string; body?: any } = { token: '' }
): Promise<{ ok: boolean; status: number; data: any }> {
	const resp = await fetch(`${ML_API_BASE}${path}`, {
		method: options.method ?? 'GET',
		headers: {
			Authorization: `Bearer ${options.token}`,
			'Content-Type': 'application/json',
			Accept: 'application/json',
		},
		body: options.body ? JSON.stringify(options.body) : undefined,
	});
	const text = await resp.text();
	let data: any = {};
	try { data = JSON.parse(text); } catch { data = { raw: text }; }
	return { ok: resp.ok, status: resp.status, data };
}

// ---------- FX rate USD → UYU ----------
export async function getFxRate(supabaseUrl: string, anonKey: string): Promise<number> {
	const resp = await fetch(`${supabaseUrl}/functions/v1/get-fx-rate`, {
		headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
	});
	if (!resp.ok) throw new Error(`fx_rate_fetch_failed: ${resp.status}`);
	const j = await resp.json();
	const rate = Number(j.rate);
	if (!rate || rate <= 0) throw new Error('invalid_fx_rate');
	return rate;
}

// ---------- Pricing: cost USD → ML price UYU ----------
export interface PricingInput {
	cost_usd: number;
	markup_percent: number; // ej: 30
	iva_percent: number; // ej: 22
	fx_rate: number; // UYU por USD
}
export function computeMlPriceUyu({ cost_usd, markup_percent, iva_percent, fx_rate }: PricingInput): number {
	const withMarkup = cost_usd * (1 + markup_percent / 100);
	const withIva = withMarkup * (1 + iva_percent / 100);
	const inUyu = withIva * fx_rate;
	// Precio redondo: ML acepta enteros para UYU; siempre hacia arriba, sin decimales
	return Math.ceil(inUyu);
}

// ---------- Description HTML → plain text ----------
export function htmlToPlainText(html: string): string {
	return html
		.replace(/<br\s*\/?\>/gi, '\n')
		.replace(/<\/p\s*>/gi, '\n\n')
		.replace(/<\/?[^>]+>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

export function descriptionToText(description: any): string {
	if (!description) return '';
	if (typeof description === 'string') return description;
	if (description.content && Array.isArray(description.content)) {
		const parts: string[] = [];
		for (const node of description.content) {
			if (node?.type === 'html' && typeof node.html === 'string') {
				parts.push(htmlToPlainText(node.html));
			} else if (typeof node?.text === 'string') {
				parts.push(node.text);
			}
		}
		return parts.join('\n').trim();
	}
	return '';
}

// ---------- Warranty parser ----------
export interface WarrantyResult {
	months: number;
	type: 'seller' | 'manufacturer';
	source: 'parsed' | 'default';
}
export function parseWarranty(text: string, defaultMonths = 6): WarrantyResult {
	const lower = text.toLowerCase();
	// Detectar tipo
	const isOfficial = /garant[ií]a\s+(oficial|de\s+f[aá]brica|del\s+fabricante)/i.test(text) ||
		/fabricante/i.test(lower);
	const type: 'seller' | 'manufacturer' = isOfficial ? 'manufacturer' : 'seller';

	// Patrones de duración
	// "12 meses", "12 mes", "12-meses"
	let months: number | null = null;
	const mesMatch = lower.match(/(\d{1,3})\s*(meses?|mes)\s*(de\s+)?garant/i);
	if (mesMatch) months = parseInt(mesMatch[1], 10);
	if (!months) {
		// "garantia ... 12 meses"
		const altMatch = lower.match(/garant[ií]a[^\d]{0,40}(\d{1,3})\s*(meses?|mes)/i);
		if (altMatch) months = parseInt(altMatch[1], 10);
	}
	if (!months) {
		// "1 año", "2 años"
		const anioMatch = lower.match(/(\d{1,2})\s*a[ñn]os?\s*(de\s+)?garant/i) ||
			lower.match(/garant[ií]a[^\d]{0,40}(\d{1,2})\s*a[ñn]os?/i);
		if (anioMatch) months = parseInt(anioMatch[1], 10) * 12;
	}

	if (months && months > 0 && months <= 60) {
		return { months, type, source: 'parsed' };
	}
	return { months: defaultMonths, type: 'seller', source: 'default' };
}

// ---------- Features parser: GTIN, MODEL ----------
export function extractFromFeatures(features: string[] | null | undefined): { gtin?: string; model?: string; nro_parte?: string } {
	const result: { gtin?: string; model?: string; nro_parte?: string } = {};
	if (!features) return result;
	for (const f of features) {
		const gtinMatch = f.match(/GTIN[:\s]+(\d{8,14})/i);
		if (gtinMatch) result.gtin = gtinMatch[1];
		const modelMatch = f.match(/Modelo[:\s]+(.+?)(?:\s*$|\s*\.)/i);
		if (modelMatch) result.model = modelMatch[1].trim();
		const partMatch = f.match(/Nro\.?\s*parte[:\s]+(.+?)(?:\s*$|\s*\.)/i);
		if (partMatch) result.nro_parte = partMatch[1].trim();
	}
	return result;
}

// ---------- Title cleanup: max 60 chars, sin precio ni emojis ni teléfonos ----------
export function buildTitle(productName: string, brand?: string | null, maxLen = 60): string {
	let t = productName.trim();
	// Sacar referencias a precio/llamadas/contacto
	t = t.replace(/\$\s*\d[\d.,]*/g, '').replace(/\b\d{8,}\b/g, '');
	// Si tiene brand al principio y duplicada, no problem
	if (brand && !new RegExp(`^${brand}`, 'i').test(t)) {
		t = `${brand} ${t}`;
	}
	t = t.replace(/\s+/g, ' ').trim();
	if (t.length <= maxLen) return t;
	return t.slice(0, maxLen).trim();
}
