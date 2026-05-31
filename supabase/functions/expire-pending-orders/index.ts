// Edge Function: expire-pending-orders
// Marca como 'expirado' las órdenes pago_pendiente más viejas que 6 horas
// y libera su stock vía release_order_stock (idempotente).
//
// Está pensada para ejecutarse periódicamente (pg_cron cada hora).
// Idempotente: release_order_stock devuelve false si la orden ya fue
// finalizada, así que correrla múltiples veces es seguro.

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const EXPIRE_HOURS = 6;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
	auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async req => {
	if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

	try {
		const cutoff = new Date(Date.now() - EXPIRE_HOURS * 60 * 60 * 1000).toISOString();
		const { data: stale, error } = await supabase
			.from('orders')
			.select('id, payment_method, payment_status')
			.eq('status', 'pago_pendiente')
			.lt('created_at', cutoff);

		if (error) throw new Error(error.message);

		const expired: number[] = [];
		const skipped: { id: number; reason: string }[] = [];

		for (const o of stale ?? []) {
			// No expirar si ya pagó con MP pero el webhook todavía no llegó.
			// Mejor mantener pago_pendiente para que el webhook lo procese.
			if (o.payment_status === 'paid' || o.payment_status === 'in_process') {
				skipped.push({ id: o.id, reason: o.payment_status });
				continue;
			}
			try {
				const { data: released } = await supabase.rpc('release_order_stock', {
					p_order_id: o.id,
					p_new_status: 'expirado',
				});
				if (released) expired.push(o.id);
				else skipped.push({ id: o.id, reason: 'no-op' });
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				skipped.push({ id: o.id, reason: msg });
			}
		}

		return new Response(
			JSON.stringify({
				ok: true,
				checked: stale?.length ?? 0,
				expired,
				skipped,
				cutoff_iso: cutoff,
			}),
			{ status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
		);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return new Response(JSON.stringify({ ok: false, error: msg }), {
			status: 500,
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		});
	}
});
