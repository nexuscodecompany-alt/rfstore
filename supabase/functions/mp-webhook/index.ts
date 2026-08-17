// mp-webhook v14
// El stock se descuenta al crear la orden (mp-create-preference); acá solo
// marcamos pagado/rechazado, liberamos stock al rechazar, y MANDAMOS MAIL
// de confirmación al comprador cuando MP confirma el pago.
//
// v14: un pago aprobado por MercadoPago ya está cobrado — no espera confirmación
// del admin, así que la orden queda 'Concretado' directamente. Antes quedaba
// 'pagado', un estado que el selector del panel no ofrece, y el <select> caía en
// la primera opción: las ventas cobradas figuraban como "Cotización". Los únicos
// pagos que siguen esperando al admin son transferencia y depósito, que van por
// manual-payment-confirm.

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from './cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MP_ACCESS_TOKEN = Deno.env.get('MP_ACCESS_TOKEN')!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

async function fetchPayment(paymentId: string): Promise<any> {
	const r = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, { headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` } });
	if (!r.ok) throw new Error(`MP get payment ${r.status}: ${await r.text()}`);
	return await r.json();
}

async function sendConfirmationMail(orderId: number): Promise<void> {
	try {
		const r = await fetch(`${SUPABASE_URL}/functions/v1/send-order-confirmation`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${SERVICE_ROLE}`,
				'apikey': SERVICE_ROLE,
			},
			body: JSON.stringify({ order_id: orderId }),
		});
		const text = await r.text();
		if (!r.ok) console.warn(`[mp-webhook] send-order-confirmation failed: ${r.status} ${text.slice(0, 300)}`);
		else console.log(`[mp-webhook] confirmation mail sent for order ${orderId}: ${text.slice(0, 200)}`);
	} catch (e) {
		console.warn('[mp-webhook] sendConfirmationMail error:', e);
	}
}

async function processApproved(orderId: number, paymentId: string): Promise<void> {
	const { data: existing } = await supabase.from('orders').select('id, payment_status').eq('id', orderId).single();
	if (!existing) return;
	if (existing.payment_status === 'paid') {
		console.log(`[mp-webhook] order ${orderId} already paid, skipping`);
		return; // idempotente: no remand mail si ya estaba paid
	}

	await supabase.from('orders').update({
		payment_status: 'paid',
		status: 'Concretado',
		paid_at: new Date().toISOString(),
		mp_payment_id: paymentId,
	}).eq('id', orderId);

	// Mail de confirmación al comprador (no bloqueante)
	await sendConfirmationMail(orderId);
}

async function processRejected(orderId: number, paymentId: string): Promise<void> {
	await supabase.from('orders').update({ mp_payment_id: paymentId }).eq('id', orderId);
	try {
		await supabase.rpc('release_order_stock', { p_order_id: orderId, p_new_status: 'rechazado' });
	} catch (e) { console.warn('release_order_stock failed:', e); }
}

Deno.serve(async req => {
	if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
	if (req.method === 'GET') {
		return new Response(JSON.stringify({ status: 'ok' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
	}

	try {
		const body = await req.json().catch(() => ({}));
		const topic = body.type ?? body.topic;

		if (topic === 'payment') {
			const paymentId = String(body.data?.id ?? '');
			if (!paymentId) {
				return new Response(JSON.stringify({ status: 'ok', note: 'sin paymentId' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
			}
			const payment = await fetchPayment(paymentId);
			const externalRef = payment.external_reference;
			const status = payment.status;
			console.log(`[mp-webhook] payment ${paymentId} status=${status} order=${externalRef}`);

			if (externalRef) {
				const orderId = Number(externalRef);
				if (status === 'approved') await processApproved(orderId, paymentId);
				else if (status === 'rejected' || status === 'cancelled') await processRejected(orderId, paymentId);
			}
		}

		return new Response(JSON.stringify({ status: 'ok' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return new Response(JSON.stringify({ status: 'error', message: msg }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
	}
});
