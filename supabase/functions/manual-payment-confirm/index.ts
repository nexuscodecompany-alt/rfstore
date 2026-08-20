// Edge Function: manual-payment-confirm
// Llamada por el admin para aprobar/rechazar un pago manual (transferencia/depósito).
// Body: { order_id: number, action: 'approve' | 'reject' }
// Solo permite si el caller tiene rol 'admin' en user_roles.
//
// Al APROBAR dispara send-order-confirmation (mail "pago confirmado" al cliente
// + "nueva venta" al admin), igual que hace mp-webhook cuando MP aprueba un
// pago. Antes no mandaba nada: el cliente que transfería nunca se enteraba de
// que le habíamos confirmado el pago.
//
// v13: los estados que escribíamos ('pagado' / 'rechazado') no existen en el
// panel (usa Cotización / Concretado / Modificado / Cancelado), así que la orden
// quedaba con un estado que el listado no sabía mostrar ni editar. Ahora
// aprobar deja 'Concretado' y rechazar 'Cancelado'. El rechazo va por
// reject_manual_payment, que devuelve el stock de forma idempotente: el RPC
// viejo (release_order_stock) sólo hacía algo si la orden seguía en
// 'pago_pendiente' y si no devolvía false en silencio.
//
// OJO: transferencia y depósito son los ÚNICOS pagos que esperan al admin. Los
// de MercadoPago y los de Mercado Libre entran ya cobrados y sus webhooks los
// dejan 'Concretado' directamente.

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

/**
 * Saca del catálogo las unidades del pedido. Se llama con la plata ya
 * confirmada. Idempotente: confirmar dos veces no descuenta dos veces.
 *
 * Devuelve el detalle de lo que faltó, si faltó algo. No se puede rechazar el
 * cobro a esta altura, así que la orden queda marcada y el admin lo resuelve.
 */
async function tomarStock(orderId: number): Promise<any[]> {
	try {
		const { data, error } = await supabaseAdmin.rpc('take_order_stock', { p_order_id: orderId });
		if (error) { console.error(`[manual-payment-confirm] take_order_stock ${orderId}: ${error.message}`); return []; }
		const faltantes = (data as any)?.faltantes ?? [];
		if (Array.isArray(faltantes) && faltantes.length > 0) {
			console.error(`[manual-payment-confirm] ORDEN ${orderId} CONFIRMADA SIN STOCK:`, JSON.stringify(faltantes));
			return faltantes;
		}
		return [];
	} catch (e) {
		console.error('[manual-payment-confirm] tomarStock:', e);
		return [];
	}
}

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

		const body: { order_id: number; action: 'approve' | 'reject' | 'send_confirmation' } = await req.json();
		if (!body.order_id || !['approve', 'reject', 'send_confirmation'].includes(body.action)) {
			return new Response(JSON.stringify({ error: 'parámetros inválidos' }), {
				status: 400,
				headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			});
		}

		// Reenviar el mail de confirmación sin tocar el estado de la orden. Lo usa
		// la venta manual: el admin la carga con los datos del cliente y le manda
		// la misma confirmación que recibiría comprando por la web.
		// send-order-confirmation sólo acepta service_role, así que la llamada tiene
		// que pasar por acá (que ya validó que quien pide es admin).
		if (body.action === 'send_confirmation') {
			const { data: ord } = await supabaseAdmin
				.from('orders')
				.select('id, customer_id, payment_status')
				.eq('id', body.order_id)
				.single();
			if (!ord) {
				return new Response(JSON.stringify({ error: 'orden no encontrada' }), {
					status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
				});
			}
			if (!ord.customer_id) {
				return new Response(JSON.stringify({ error: 'La venta no tiene un cliente cargado: agregale el mail para poder enviarle la confirmación.' }), {
					status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
				});
			}
			const err = await sendConfirmationMail(body.order_id);
			if (err) {
				return new Response(JSON.stringify({ error: `No se pudo enviar el mail: ${err}` }), {
					status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
				});
			}
			return new Response(JSON.stringify({ ok: true, mail_sent: true }), {
				status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			});
		}

		let mailError: string | null = null;
		let mailSent = false;
		let faltantes: any[] = [];

		if (body.action === 'approve') {
			// Si ya estaba pagada, no reenviamos el mail (aprobar dos veces no debe
			// spamear al cliente).
			const { data: before } = await supabaseAdmin
				.from('orders')
				.select('payment_status, payment_method, payment_split, paid_mp_usd, paid_transfer_usd, total_amount')
				.eq('id', body.order_id)
				.single();
			const wasPaid = before?.payment_status === 'paid';

			// --- PAGO COMBINADO ---
			// Lo que el admin está confirmando es SÓLO la parte que vino por
			// transferencia. El pedido se concreta si con eso ya se cubre el total;
			// si todavía falta la parte de MercadoPago, sigue Pendiente.
			if (before?.payment_method === 'hybrid') {
				const montoTr = Number((before.payment_split as any)?.transfer) || 0;
				const { data: completa, error: hybErr } = await supabaseAdmin.rpc('register_hybrid_payment', {
					p_order_id: body.order_id,
					p_method: 'transfer',
					p_amount: montoTr,
				});
				if (hybErr) throw new Error(hybErr.message);

				// register_hybrid_payment toma el stock por dentro apenas entra la
				// primera parte. Acá sólo levantamos el faltante, si hubo.
				const { data: post } = await supabaseAdmin
					.from('orders').select('stock_shortfall').eq('id', body.order_id).single();
				const faltaHib = Array.isArray(post?.stock_shortfall) ? (post!.stock_shortfall as any[]) : [];

				if (completa === true) {
					mailError = await sendConfirmationMail(body.order_id);
					mailSent = mailError === null;
				}
				const faltaMp = !(Number(before.paid_mp_usd) > 0);
				return new Response(
					JSON.stringify({
						ok: true,
						hybrid: true,
						completed: completa === true,
						pending_part: completa === true ? null : faltaMp ? 'mercadopago' : null,
						mail_sent: mailSent,
						mail_error: mailError,
						stock_shortfall: faltaHib,
					}),
					{ status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
				);
			}

			const { error: updErr } = await supabaseAdmin
				.from('orders')
				.update({
					payment_status: 'paid',
					status: 'Concretado',
					paid_at: new Date().toISOString(),
				})
				.eq('id', body.order_id);
			if (updErr) throw new Error(updErr.message);

			// Desde el 20/08/2026 la orden por transferencia NO reserva stock: las
			// unidades salen del catálogo recién acá, cuando el admin confirma que
			// la plata entró.
			faltantes = await tomarStock(body.order_id);

			if (!wasPaid) {
				mailError = await sendConfirmationMail(body.order_id);
				mailSent = mailError === null;
			}
		} else {
			// Rechazar: cancela, devuelve stock (idempotente) y marca el pago rechazado.
			const { error: rejErr } = await supabaseAdmin.rpc('reject_manual_payment', {
				p_order_id: body.order_id,
			});
			if (rejErr) throw new Error(rejErr.message);
		}

		return new Response(
			JSON.stringify({ ok: true, mail_sent: mailSent, mail_error: mailError, stock_shortfall: faltantes }),
			{ status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
		);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return new Response(JSON.stringify({ error: msg }), {
			status: 500,
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		});
	}
});
