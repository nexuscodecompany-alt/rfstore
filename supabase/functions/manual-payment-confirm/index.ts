// Edge Function: manual-payment-confirm
// Llamada por el admin para aprobar/rechazar un pago manual (transferencia/depósito).
// Body: { order_id: number, action: 'approve' | 'reject' }
// Solo permite si el caller tiene rol 'admin' en user_roles.

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE, {
	auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async req => {
	if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

	const authHeader = req.headers.get('Authorization') ?? '';
	const supabaseUser = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
		global: { headers: { Authorization: authHeader } },
		auth: { persistSession: false, autoRefreshToken: false },
	});

	try {
		const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
		if (userErr || !userData.user) {
			return new Response(JSON.stringify({ error: 'no autenticado' }), {
				status: 401,
				headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			});
		}

		const { data: roleRow } = await supabaseAdmin
			.from('user_roles')
			.select('role')
			.eq('user_id', userData.user.id)
			.single();

		if (!roleRow || roleRow.role !== 'admin') {
			return new Response(JSON.stringify({ error: 'requiere rol admin' }), {
				status: 403,
				headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			});
		}

		const body: { order_id: number; action: 'approve' | 'reject' } = await req.json();
		if (!body.order_id || !['approve', 'reject'].includes(body.action)) {
			return new Response(JSON.stringify({ error: 'parámetros inválidos' }), {
				status: 400,
				headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			});
		}

		if (body.action === 'approve') {
			await supabaseAdmin
				.from('orders')
				.update({
					payment_status: 'paid',
					status: 'pagado',
					paid_at: new Date().toISOString(),
				})
				.eq('id', body.order_id);

			// descuento de stock
			const { data: items } = await supabaseAdmin
				.from('order_items')
				.select('variant_id, quantity')
				.eq('order_id', body.order_id);
			for (const it of items ?? []) {
				const { data: v } = await supabaseAdmin
					.from('variants')
					.select('stock')
					.eq('id', it.variant_id)
					.single();
				if (!v) continue;
				await supabaseAdmin
					.from('variants')
					.update({ stock: Math.max(0, v.stock - it.quantity) })
					.eq('id', it.variant_id);
			}
		} else {
			await supabaseAdmin
				.from('orders')
				.update({ payment_status: 'rejected', status: 'rechazado' })
				.eq('id', body.order_id);
		}

		return new Response(JSON.stringify({ ok: true }), {
			status: 200,
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		});
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return new Response(JSON.stringify({ error: msg }), {
			status: 500,
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		});
	}
});
