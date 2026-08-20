// mp-webhook v16
// Marcamos pagado/rechazado, DESCONTAMOS EL STOCK y mandamos el mail de
// confirmación al comprador cuando MP confirma el pago.
//
// v16 (2026-08-20): el stock ya no se reserva al crear la orden — sale del
// catálogo recién acá, con el pago aprobado. Si en el medio se agotó, el cobro
// NO se rechaza (la plata ya entró): se descuenta lo que hay y queda constancia
// en orders.stock_shortfall para que el admin lo resuelva con el cliente.
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

/**
 * Saca del catálogo las unidades de la orden. Se llama SÓLO con el pago ya
 * aprobado. Es idempotente, así que el webhook repetido de MP no descuenta dos
 * veces.
 *
 * Si algo se agotó mientras el cliente pagaba no se puede echar atrás el cobro,
 * así que se descuenta lo que haya y se avisa al admin.
 */
async function tomarStock(orderId: number): Promise<void> {
	try {
		const { data, error } = await supabase.rpc('take_order_stock', { p_order_id: orderId });
		if (error) { console.error(`[mp-webhook] take_order_stock orden ${orderId}: ${error.message}`); return; }
		const faltantes = (data as any)?.faltantes ?? [];
		if (Array.isArray(faltantes) && faltantes.length > 0) {
			console.error(`[mp-webhook] ORDEN ${orderId} COBRADA SIN STOCK SUFICIENTE:`, JSON.stringify(faltantes));
			await avisarFaltante(orderId, faltantes);
		}
	} catch (e) {
		console.error('[mp-webhook] tomarStock:', e);
	}
}

/** Mail al admin: se cobró algo que no había. Hay que hablar con el cliente. */
async function avisarFaltante(orderId: number, faltantes: any[]): Promise<void> {
	const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
	const ADMIN_EMAIL = Deno.env.get('ADMIN_EMAIL') ?? 'ventas@rfstore.uy';
	const FROM = Deno.env.get('RESEND_FROM') ?? 'RF Store <ventas@send.rfstore.uy>';
	if (!RESEND_API_KEY) { console.warn('[mp-webhook] sin RESEND_API_KEY, no se avisa el faltante'); return; }

	const filas = faltantes.map((f: any) =>
		`<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${f.producto ?? f.codigo ?? '—'}</td>
		     <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center">${f.pedido}</td>
		     <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center;color:#b91c1c"><b>${f.habia}</b></td></tr>`
	).join('');

	try {
		await fetch('https://api.resend.com/emails', {
			method: 'POST',
			headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				from: FROM,
				to: [ADMIN_EMAIL],
				subject: `Pedido #${orderId}: cobrado sin stock suficiente`,
				html: `<div style="font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;max-width:560px">
					<img src="https://www.rfstore.uy/img/img-docs/logoblancorf.jpg" width="46" height="46" alt="RF Store" style="display:block;border:0;margin:0 0 18px">
					<p style="background:#fef2f2;border-left:4px solid #dc2626;padding:12px 14px;margin:0 0 16px">
						<b>El pago del pedido #${orderId} entró, pero no había stock de todo.</b><br>
						Hay que conseguirlo, ofrecer un reemplazo o devolverle la parte que falte.
					</p>
					<table style="border-collapse:collapse;width:100%;font-size:14px">
						<tr style="background:#f8fafc"><th style="padding:6px 10px;text-align:left">Producto</th>
							<th style="padding:6px 10px">Pedido</th><th style="padding:6px 10px">Había</th></tr>
						${filas}
					</table>
				</div>`,
			}),
		});
	} catch (e) { console.warn('[mp-webhook] avisarFaltante:', e); }
}

async function processApproved(orderId: number, paymentId: string): Promise<void> {
	const { data: existing } = await supabase.from('orders').select('id, payment_status, payment_method, payment_split').eq('id', orderId).single();
	if (!existing) return;
	if (existing.payment_status === 'paid') {
		console.log(`[mp-webhook] order ${orderId} already paid, skipping`);
		return; // idempotente: no remand mail si ya estaba paid
	}

	// --- PAGO COMBINADO ---
	// Este pago cubre SÓLO la parte de MercadoPago. El pedido no se concreta
	// hasta que el admin confirme también la transferencia, así que acá se
	// registra la parte y se deja que register_hybrid_payment decida.
	if (existing.payment_method === 'hybrid') {
		const montoMp = Number((existing.payment_split as any)?.mercadopago) || 0;
		await supabase.from('orders').update({ mp_payment_id: paymentId }).eq('id', orderId);
		const { data: completa, error } = await supabase.rpc('register_hybrid_payment', {
			p_order_id: orderId,
			p_method: 'mercadopago',
			p_amount: montoMp,
		});
		if (error) { console.warn('[mp-webhook] register_hybrid_payment:', error.message); return; }

		// register_hybrid_payment ya tomó el stock por dentro (entró plata real,
		// aunque falte la otra parte). Acá sólo levantamos el faltante para avisar.
		const { data: post } = await supabase.from('orders').select('stock_shortfall').eq('id', orderId).single();
		const faltantes = (post?.stock_shortfall as any) ?? null;
		if (Array.isArray(faltantes) && faltantes.length > 0) await avisarFaltante(orderId, faltantes);

		if (completa === true) {
			// Las dos partes están cobradas: recién ahora es una venta cerrada.
			await sendConfirmationMail(orderId);
		} else {
			console.log(`[mp-webhook] order ${orderId} (híbrida): parte MP cobrada, falta la transferencia`);
		}
		return;
	}

	await supabase.from('orders').update({
		payment_status: 'paid',
		status: 'Concretado',
		paid_at: new Date().toISOString(),
		mp_payment_id: paymentId,
	}).eq('id', orderId);

	// Recién con el pago aprobado sale el stock del catálogo.
	await tomarStock(orderId);

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
