// deno-lint-ignore-file no-explicit-any
// placetopay-reconcile v1 (2026-10-29)
//
// Red de seguridad: Placetopay manda el aviso de pago UNA sola vez y no lo
// reintenta. Cada 10 minutos (pg_cron -> placetopay_reconcile_tick, que sólo
// llama si hay algo pendiente) se re-consultan las sesiones que siguen
// PENDING y se aplica su estado real.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';
import { syncSession } from '../_shared/placetopay.ts';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
	auth: { persistSession: false, autoRefreshToken: false },
});

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async req => {
	if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
	try {
		const since = new Date(Date.now() - 3 * 24 * 3600_000).toISOString();
		const recent = new Date(Date.now() - 5 * 60_000).toISOString();
		const { data: rows, error } = await supabase
			.from('placetopay_sessions')
			.select('request_id, order_id')
			.eq('status', 'PENDING')
			.gt('created_at', since)
			// Lo recién consultado (página de gracias / aviso) se deja para la próxima.
			.or(`last_checked_at.is.null,last_checked_at.lt.${recent}`)
			.order('created_at', { ascending: true })
			.limit(40);
		if (error) throw new Error(error.message);

		const results: any[] = [];
		for (const r of rows ?? []) {
			try {
				results.push(await syncSession(supabase, Number(r.request_id)));
			} catch (e) {
				results.push({ order_id: r.order_id, error: e instanceof Error ? e.message : String(e) });
			}
		}
		console.log(`[placetopay-reconcile] ${results.length} sesiones:`, JSON.stringify(results).slice(0, 2000));
		return json({ ok: true, checked: results.length, results });
	} catch (e) {
		return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
	}
});
