// Edge Function: cdr-check-stock
// Recibe { codes: string[], qty?: Record<string, number> }
// Devuelve { ok: boolean, stocks: { code, stock }[], insufficient: string[] }
// Si se pasa `qty`, marca como insufficient los códigos con stock < qty.

import { corsHeaders } from '../_shared/cors.ts';
import { fetchGetStock } from '../_shared/cdr-soap.ts';

const CDR_EMAIL = Deno.env.get('CDR_EMAIL')!;
const CDR_TOKEN = Deno.env.get('CDR_TOKEN')!;

Deno.serve(async req => {
	if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

	try {
		const body: { codes?: string[]; qty?: Record<string, number> } = await req
			.json()
			.catch(() => ({}));
		const codes = Array.isArray(body.codes) ? body.codes.filter(Boolean) : [];

		if (codes.length === 0) {
			return new Response(JSON.stringify({ ok: false, error: 'codes vacío' }), {
				headers: { ...corsHeaders, 'Content-Type': 'application/json' },
				status: 400,
			});
		}

		const stocks = await fetchGetStock(CDR_EMAIL, CDR_TOKEN, codes);

		const insufficient: string[] = [];
		const missing: string[] = [];
		const qty = body.qty ?? {};

		for (const it of stocks) {
			if (it.stock === -999) {
				missing.push(it.codigo);
				continue;
			}
			const needed = qty[it.codigo] ?? 1;
			if (it.stock < needed) insufficient.push(it.codigo);
		}

		const ok = insufficient.length === 0 && missing.length === 0;

		return new Response(
			JSON.stringify({ ok, stocks, insufficient, missing }),
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
