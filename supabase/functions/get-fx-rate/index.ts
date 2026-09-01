// get-fx-rate v17 (BROU mostrador venta)
// Cotización USD→UYU dólar BROU — fila "Dólar" (pizarra/mostrador), lado VENTA.
// Historial de la fuente: BCU (dolarapi) → "Dólar eBROU" venta → AHORA "Dólar" venta.
// La fila de mostrador es la MÁS CARA de las dos del BROU (ej. 41,35 vs 40,85 eBROU),
// que es la que queremos cobrarle al cliente.
// El portlet del BROU es una sola tabla con todas las monedas; cada fila arranca con
// <p class="moneda">NOMBRE</p> y sigue con: compra, (vacío), venta, (vacío), arbitrajes.
// Recorremos esas celdas y nos quedamos con la que se llama "Dólar" a secas,
// descartando explícitamente "Dólar eBROU" (y sin depender del encoding del acento).
// Estrategia (en orden):
//   1. Cache fresca (< 1h) de mostrador en app_settings.usd_uyu_rate_cache
//   2. BROU en vivo (portlet oficial brou.com.uy → fila "Dólar", venta)
//   3. DolarAPI UY (espeja la MISMA pizarra del BROU: /cotizaciones/usd venta) — se cachea
//   4. Cache stale de mostrador (cualquier edad)
//   5. Hardcoded 41 — último recurso
// Nota: cualquier cache con source viejo de eBROU se ignora (fresca o stale).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CACHE_KEY = 'usd_uyu_rate_cache';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h
const HARDCODED_FALLBACK = 41;

const BROU_PORTLET_URL =
	'https://www.brou.com.uy/c/portal/render_portlet?p_l_id=20593&p_p_id=cotizacionfull_WAR_broutmfportlet_INSTANCE_otHfewh1klyS&p_p_lifecycle=0&p_t_lifecycle=0&p_p_state=normal&p_p_mode=view&p_p_col_id=column-1&p_p_col_pos=0&p_p_col_count=2&p_p_isolated=1';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
	auth: { persistSession: false, autoRefreshToken: false },
});

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
	'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

interface RateCache { rate: number; source: string; fetched_at: string; }

// Una cache sirve sólo si es de la fuente actual (mostrador). Descartamos las
// manuales/hardcoded/emergencia y las que quedaron del eBROU.
function cacheIsUsable(c: RateCache | null): c is RateCache {
	if (!c) return false;
	const s = (c.source || '').toLowerCase();
	return !s.includes('manual') && !s.includes('hardcoded') && !s.includes('emergencia') && !s.includes('ebrou');
}

async function readCache(): Promise<RateCache | null> {
	try {
		const { data } = await supabase.from('app_settings').select('value').eq('key', CACHE_KEY).maybeSingle();
		if (!data?.value) return null;
		const v = data.value as RateCache;
		if (typeof v.rate !== 'number' || v.rate <= 0) return null;
		return v;
	} catch {
		return null;
	}
}

async function writeCache(rate: number, source: string): Promise<void> {
	try {
		await supabase.from('app_settings').upsert({
			key: CACHE_KEY,
			value: { rate, source, fetched_at: new Date().toISOString() },
			updated_at: new Date().toISOString(),
		});
	} catch (e) { console.warn('[get-fx-rate] writeCache failed:', e); }
}

// Devuelve la VENTA de la fila "Dólar" (mostrador) del portlet del BROU.
// Orden de celdas en la fila: compra, venta, arbitraje compra, arbitraje venta.
// Tomamos el 2º número con decimales = venta.
function parseBrouMostradorVenta(html: string): number | null {
	const re = /class="moneda"[^>]*>([^<]*)</gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(html)) !== null) {
		const label = m[1].replace(/&nbsp;/gi, ' ').trim().toLowerCase();
		if (label.includes('ebrou')) continue; // esa es la de home banking, más barata
		if (!/lar$/.test(label)) continue;     // "Dólar" a secas (el acento puede venir roto)
		const after = html.slice(m.index, m.index + 700);
		const nums = after.match(/\d{1,3}[.,]\d{2,6}/g);
		if (!nums || nums.length < 2) return null;
		const venta = Number(nums[1].replace(',', '.')); // [0]=compra, [1]=venta
		return venta > 0 && venta < 1000 ? venta : null;
	}
	return null;
}

async function fetchBrouMostradorVenta(): Promise<number | null> {
	try {
		const r = await fetch(BROU_PORTLET_URL, {
			headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (compatible; rfstore-fx/1.0)' },
			signal: AbortSignal.timeout(8000),
		});
		if (!r.ok) { console.warn('[get-fx-rate] brou portlet', r.status); return null; }
		const html = await r.text();
		const v = parseBrouMostradorVenta(html);
		if (!v) console.warn('[get-fx-rate] brou parse: no mostrador venta found');
		return v;
	} catch (e) { console.warn('[get-fx-rate] brou fetch failed:', e); return null; }
}

// Espejo de la MISMA pizarra del BROU (no es el BCU): dolarapi UY publica
// compra/venta de mostrador del BROU. Sirve si el portlet no responde.
async function fetchDolarApiMostrador(): Promise<number | null> {
	try {
		const r = await fetch('https://uy.dolarapi.com/v1/cotizaciones/usd', {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(6000),
		});
		if (!r.ok) return null;
		const j = await r.json();
		const venta = Number(j?.venta);
		return venta > 0 && venta < 1000 ? venta : null;
	} catch { return null; }
}

Deno.serve(async req => {
	if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

	const json = (body: unknown, status = 200) =>
		new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

	const cache = await readCache();
	const now = Date.now();
	const cacheAgeMs = cache ? now - new Date(cache.fetched_at).getTime() : Infinity;

	// 1) Cache fresca de mostrador
	if (cacheIsUsable(cache) && cacheAgeMs < CACHE_TTL_MS) {
		return json({ ...cache, source: cache.source + ' (cache)' });
	}

	// 2) BROU en vivo
	const brou = await fetchBrouMostradorVenta();
	if (brou) {
		const source = 'BROU mostrador venta';
		await writeCache(brou, source);
		return json({ rate: brou, source, fetched_at: new Date().toISOString() });
	}

	// 3) DolarAPI (misma pizarra del BROU) — se cachea porque es el mismo número
	const api = await fetchDolarApiMostrador();
	if (api) {
		const source = 'BROU mostrador venta (dolarapi)';
		await writeCache(api, source);
		return json({ rate: api, source, fetched_at: new Date().toISOString() });
	}

	// 4) Cache stale de mostrador (cualquier edad)
	if (cacheIsUsable(cache)) {
		return json({ ...cache, source: cache.source + ' (stale)', stale: true });
	}

	// 5) Hardcoded — evita 500
	console.warn('[get-fx-rate] using hardcoded fallback, all sources failed');
	return json({ rate: HARDCODED_FALLBACK, source: 'hardcoded_fallback', fetched_at: new Date().toISOString(), stale: true });
});
