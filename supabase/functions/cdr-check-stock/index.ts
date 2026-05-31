// Edge Function: cdr-check-stock
// Recibe { codes: string[], qty?: Record<string, number> }
// Devuelve { ok, stocks: [{codigo, stock, source}], insufficient, missing }
//
// Estrategia híbrida (2026-05-31):
//   1. Consultamos el WS SOAP de CDR (get_stock). Es la fuente más fresca.
//   2. Si el WS no responde para algún código (o falla todo), caemos al
//      stock cacheado en la tabla `variants` (campo `stock`, refrescado por
//      `cdr-sync-products` cada ~30 min).
//   3. Un código se marca `missing` solo si NINGUNA fuente lo conoce.
//      Se marca `insufficient` si el stock efectivo < cantidad pedida.
//
// Esto evita falsos negativos cuando el SOAP de CDR está intermitente
// (devuelve array vacío sin error HTTP) y mantiene la validación real.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';
import { fetchGetStock } from '../_shared/cdr-soap.ts';

const CDR_EMAIL = Deno.env.get('CDR_EMAIL')!;
const CDR_TOKEN = Deno.env.get('CDR_TOKEN')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE, {
	auth: { persistSession: false, autoRefreshToken: false },
});

interface StockResult {
	codigo: string;
	stock: number;
	source: 'soap' | 'db' | 'none';
}

Deno.serve(async req => {
	if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

	try {
		const body: { codes?: string[]; qty?: Record<string, number> } = await req
			.json()
			.catch(() => ({}));
		const codes = Array.isArray(body.codes) ? body.codes.filter(Boolean) : [];
		const qty = body.qty ?? {};

		if (codes.length === 0) {
			return new Response(JSON.stringify({ ok: false, error: 'codes vacío' }), {
				headers: { ...corsHeaders, 'Content-Type': 'application/json' },
				status: 400,
			});
		}

		// 1) SOAP CDR (puede fallar entero o devolver vacío para algunos códigos)
		const soapMap = new Map<string, number>();
		let soapError: string | null = null;
		try {
			const soapStocks = await fetchGetStock(CDR_EMAIL, CDR_TOKEN, codes);
			for (const it of soapStocks) {
				if (it.stock === -999) continue; // CDR marca "no existe"
				soapMap.set(it.codigo, it.stock);
			}
		} catch (e) {
			soapError = e instanceof Error ? e.message : String(e);
			console.warn('[cdr-check-stock] SOAP failed:', soapError);
		}

		// 2) Fallback DB: traemos los códigos que el SOAP no resolvió
		const missingFromSoap = codes.filter(c => !soapMap.has(c));
		const dbMap = new Map<string, number>();
		if (missingFromSoap.length > 0) {
			const { data: products, error: prodErr } = await supabaseAdmin
				.from('products')
				.select('external_code, variants(stock)')
				.in('external_code', missingFromSoap);
			if (prodErr) {
				console.warn('[cdr-check-stock] DB fallback failed:', prodErr.message);
			} else {
				for (const p of products ?? []) {
					const variants = (p as unknown as { external_code: string; variants: { stock: number }[] });
					const totalStock = (variants.variants ?? []).reduce(
						(acc, v) => acc + (typeof v.stock === 'number' ? v.stock : Number(v.stock) || 0),
						0
					);
					dbMap.set(variants.external_code, totalStock);
				}
			}
		}

		// 3) Consolidamos
		const stocks: StockResult[] = codes.map(c => {
			if (soapMap.has(c)) return { codigo: c, stock: soapMap.get(c)!, source: 'soap' };
			if (dbMap.has(c)) return { codigo: c, stock: dbMap.get(c)!, source: 'db' };
			return { codigo: c, stock: 0, source: 'none' };
		});

		const insufficient: string[] = [];
		const missing: string[] = [];
		for (const it of stocks) {
			if (it.source === 'none') {
				missing.push(it.codigo);
				continue;
			}
			const needed = qty[it.codigo] ?? 1;
			if (it.stock < needed) insufficient.push(it.codigo);
		}

		const ok = insufficient.length === 0 && missing.length === 0;

		return new Response(
			JSON.stringify({ ok, stocks, insufficient, missing, soap_error: soapError }),
			{ headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
		);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return new Response(JSON.stringify({ ok: false, error: msg }), {
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			status: 500,
		});
	}
});
