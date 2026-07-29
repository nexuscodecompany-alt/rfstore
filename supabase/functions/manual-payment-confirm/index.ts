// Edge Function: manual-payment-confirm
// Llamada por el admin para aprobar/rechazar un pago manual (transferencia/depósito).
// Body: { order_id: number, action: 'approve' | 'reject' }
// Solo permite si el caller tiene rol 'admin' en user_roles.
//
// Al APROBAR dispara send-order-confirmation (mail "pago confirmado" al cliente
// + "nueva venta" al admin), igual que hace mp-webhook cuando MP aprueba un
// pago. Antes no mandaba nada: el cliente que transfería nunca se enteraba de
// que le habíamos confirmado el pago.

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE, {
	auth: { persistSession: false, autoRefreshToken: false },
});

/** Mail de "pago confirmado" (cliente) + "nueva venta" (admin). No bloqueante. */
async function sendConfirmationMail(orderId: number): Promise<string | null> {
	try {
		const r = await fetch(`${SUPABASE_URL}/functions/v1/send-order-confirmation`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${SERVICE_ROLE}`,
				apikey: SERVICE_ROLE,
			},
			body: JSON.stringify({ order_id: orderId }),
		});
		const text = await r.text();
		if (!r.ok) {
			console.warn(`[manual-payment-confirm] send-order-confirmation ${r.status}: ${text.slice(0, 300)}`);
			return `mail ${r.status}`;
		}
		console.log(`[manual-payment-confirm] confirmación enviada para orden ${orderId}`);
		return null;
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		console.warn('[manual-payment-confirm] sendConfirmationMail error:', msg);
		return msg;
	}
}

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

		let mailError: string | null = null;
		let mailSent = false;

		if (body.action === 'approve') {
			// Si ya estaba pagada, no reenviamos el mail (aprobar dos veces no debe
			// spamear al cliente).
			const { data: before } = await supabaseAdmin
				.from('orders')
				.select('payment_status')
				.eq('id', body.order_id)
				.single();
			const wasPaid = before?.payment_status === 'paid';

			// El stock ya se decrementó al crear la orden (place_cdr_order).
			// Acá solo marcamos pagada.
			await supabaseAdmin
				.from('orders')
				.update({
					payment_status: 'paid',
					status: 'pagado',
					paid_at: new Date().toISOString(),
				})
				.eq('id', body.order_id);

			if (!wasPaid) {
				mailError = await sendConfirmationMail(body.order_id);
				mailSent = mailError === null;
			}
		} else {
			// Rechazar: liberar stock (release_order_stock es idempotente)
			try {
				await supabaseAdmin.rpc('release_order_stock', {
					p_order_id: body.order_id,
					p_new_status: 'rechazado',
				});
			} catch (e) {
				console.warn('release_order_stock failed:', e);
				// Igual marcamos la orden como rechazada aunque falle el release
				await supabaseAdmin
					.from('orders')
					.update({ payment_status: 'rejected', status: 'rechazado' })
					.eq('id', body.order_id);
			}
		}

		return new Response(JSON.stringify({ ok: true, mail_sent: mailSent, mail_error: mailError }), {
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
