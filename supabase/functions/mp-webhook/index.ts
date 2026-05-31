// Edge Function: mp-webhook
// Recibe notificaciones IPN/Webhook de MercadoPago.
// Acepta GET (verificación) y POST (notificación).
// Marca la orden como 'paid' si approved, 'rejected' si rejected.
// Descuenta stock local sólo cuando el pago se aprueba.

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MP_ACCESS_TOKEN = Deno.env.get('MP_ACCESS_TOKEN')!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
	auth: { persistSession: false, autoRefreshToken: false },
});

async function fetchPayment(paymentId: string): Promise<any> {
	const r = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
		headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
	});
	if (!r.ok) throw new Error(`MP get payment ${r.status}: ${await r.text()}`);
	return await r.json();
}

async function processApproved(orderId: number, paymentId: string): Promise<void> {
	// Idempotencia: si ya está paid no hacemos nada.
	// NOTA: el stock se decrementa al crear la orden (en mp-create-preference),
	// por lo que acá solo marcamos como pagado.
	const { data: existing } = await supabase
		.from('orders')
		.select('id, payment_status')
		.eq('id', orderId)
		.single();
	if (!existing || existing.payment_status === 'paid') return;

	await supabase
		.from('orders')
		.update({
			payment_status: 'paid',
			status: 'pagado',
			paid_at: new Date().toISOString(),
			mp_payment_id: paymentId,
		})
		.eq('id', orderId);
}

async function processRejected(orderId: number, paymentId: string): Promise<void> {
	// Guardar el mp_payment_id antes de liberar (release_order_stock cambia el status)
	await supabase
		.from('orders')
		.update({ mp_payment_id: paymentId })
		.eq('id', orderId);
	// Liberar stock (idempotente: si ya estaba rechazada/expirada no toca nada)
	try {
		await supabase.rpc('release_order_stock', {
			p_order_id: orderId,
			p_new_status: 'rechazado',
		});
	} catch (e) {
		console.warn('release_order_stock failed:', e);
	}
}

Deno.serve(async req => {
	if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

	if (req.method === 'GET') {
		// MP verifica con GET en algunos casos
		return new Response(JSON.stringify({ status: 'ok' }), {
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		});
	}

	try {
		const body = await req.json().catch(() => ({}));
		const topic = body.type ?? body.topic;

		if (topic === 'payment') {
			const paymentId = String(body.data?.id ?? '');
			if (!paymentId) {
				return new Response(JSON.stringify({ status: 'ok', note: 'sin paymentId' }), {
					headers: { ...corsHeaders, 'Content-Type': 'application/json' },
				});
			}
			const payment = await fetchPayment(paymentId);
			const externalRef = payment.external_reference;
			const status = payment.status;

			if (externalRef) {
				const orderId = Number(externalRef);
				if (status === 'approved') await processApproved(orderId, paymentId);
				else if (status === 'rejected' || status === 'cancelled')
					await processRejected(orderId, paymentId);
			}
		}

		// Siempre 200 para que MP no reintente eternamente
		return new Response(JSON.stringify({ status: 'ok' }), {
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		});
	} catch (e) {
		// Aún en error devolvemos 200 para evitar retries (logueamos en el body)
		const msg = e instanceof Error ? e.message : String(e);
		return new Response(JSON.stringify({ status: 'error', message: msg }), {
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		});
	}
});
