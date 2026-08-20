// Edge Function: manual-sale-payment-link
//
// Le manda al comprador CÓMO PAGAR una venta manual que quedó pendiente de
// cobro. Body: { order_id: number }. Sólo admin.
//
// Según el método que eligió el admin al cargar la venta:
//   mercadopago -> link de pago por el total
//   hybrid      -> link de pago por su parte + datos bancarios por la otra
//   deposit     -> datos de Abitab / Redpagos
//   transfer    -> NO se manda nada. Decisión del dueño: en transferencia sola
//                  la cuenta se la pasa él en persona.
//
// Va aparte de send-transfer-email a propósito: esa función la usa el checkout
// en vivo, son 37 KB y su mirror local ya se desincronizó de producción una vez.
//
// El stock NO se toca acá. Sale del catálogo cuando el cobro se registra
// (mp-webhook o el botón de confirmar del panel), vía take_order_stock.

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MP_ACCESS_TOKEN = Deno.env.get('MP_ACCESS_TOKEN')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'ventas@send.rfstore.uy';
const FROM_NAME = Deno.env.get('FROM_NAME') ?? 'RF Store';
const SITE_URL = Deno.env.get('SITE_URL') || 'https://www.rfstore.uy';
const SALES_EMAIL = Deno.env.get('SALES_EMAIL') ?? 'ventas@rfstore.uy';

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE, {
	auth: { persistSession: false, autoRefreshToken: false },
});

const LOGO_ROW =
	`<tr><td align="center" style="padding:24px 28px 6px;background:#ffffff;"><img src="https://www.rfstore.uy/img/img-docs/logoblancorf.jpg" width="46" height="46" alt="RF Store" style="display:block;border:0;outline:none;text-decoration:none;"></td></tr>`;

interface TransferInfo {
	banco?: string; titular?: string; rut?: string; moneda?: string;
	cuenta?: string; cuenta_santander?: string; sucursal_santander?: string; cuenta_externa?: string;
}
interface DepositInfo { abitab?: string; redpagos?: string; instrucciones?: string; }

const escapeHtml = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Filas del bloque bancario. Mismo criterio que send-transfer-email. */
function bankRows(t: TransferInfo): Array<[string, string]> {
	const rows: Array<[string, string]> = [];
	// La clave `cuenta` quedó vacía en producción; el número real vive en
	// cuenta_santander / cuenta_externa.
	const cuenta = t.cuenta || t.cuenta_santander || t.cuenta_externa;
	if (t.banco) rows.push(['Banco', t.banco]);
	if (cuenta) rows.push(['Cuenta', cuenta]);
	if (t.sucursal_santander) rows.push(['Sucursal', t.sucursal_santander]);
	if (t.cuenta_externa && t.cuenta_externa !== cuenta) rows.push(['Desde otro banco', t.cuenta_externa]);
	if (t.titular) rows.push(['Titular', t.titular]);
	if (t.rut) rows.push(['RUT', t.rut]);
	if (t.moneda) rows.push(['Moneda', t.moneda]);
	return rows;
}

function depositRows(d: DepositInfo): Array<[string, string]> {
	const rows: Array<[string, string]> = [];
	if (d.abitab) rows.push(['Abitab', d.abitab]);
	if (d.redpagos) rows.push(['Redpagos', d.redpagos]);
	return rows;
}

const rowsHtml = (rows: Array<[string, string]>) =>
	rows.map(([k, v]) =>
		`<tr><td style="padding:9px 14px;color:#6b7280;font-size:13px;border-bottom:1px solid #f1f5f9;width:150px;">${escapeHtml(k)}</td>
		     <td style="padding:9px 14px;color:#111827;font-size:14px;font-weight:600;border-bottom:1px solid #f1f5f9;">${escapeHtml(v)}</td></tr>`
	).join('');

interface MailCtx {
	orderId: number;
	customerName: string;
	/** Etiqueta del total tal como se le cobra (ej "USD 250" o "$ 10.000"). */
	totalLabel: string;
	/** Link de MercadoPago, si corresponde. */
	mpLink: string | null;
	mpLabel: string | null;
	/** Bloque manual (banco o Abitab), si corresponde. */
	manualTitle: string | null;
	manualRows: Array<[string, string]>;
	manualLabel: string | null;
	instrucciones: string | null;
	esCombinado: boolean;
}

function renderMail(c: MailCtx): { subject: string; html: string; text: string } {
	const subject = `Cómo pagar tu pedido #${c.orderId}`;

	const mpBlock = c.mpLink
		? `<tr><td style="padding:4px 28px 8px;">
		     <div style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
		       <div style="background:#f8fafc;padding:10px 14px;font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:#475569;font-weight:700;">
		         ${c.esCombinado ? 'Parte 1 — con MercadoPago' : 'Pagar con MercadoPago'}
		       </div>
		       <div style="padding:18px 14px;text-align:center;">
		         <p style="margin:0 0 14px;font-size:15px;color:#111827;">Monto: <b>${escapeHtml(c.mpLabel ?? '')}</b></p>
		         <a href="${c.mpLink}" style="display:inline-block;background:#009ee3;color:#fff;text-decoration:none;padding:13px 26px;border-radius:8px;font-size:15px;font-weight:700;">Pagar ahora</a>
		         <p style="margin:12px 0 0;font-size:12px;color:#6b7280;">Tarjeta, débito o dinero en cuenta.</p>
		       </div>
		     </div>
		   </td></tr>`
		: '';

	const manualBlock = c.manualRows.length
		? `<tr><td style="padding:4px 28px 8px;">
		     <div style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
		       <div style="background:#f8fafc;padding:10px 14px;font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:#475569;font-weight:700;">
		         ${c.esCombinado ? 'Parte 2 — ' : ''}${escapeHtml(c.manualTitle ?? '')}
		       </div>
		       <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
		         ${rowsHtml(c.manualRows)}
		         <tr><td style="padding:9px 14px;color:#6b7280;font-size:13px;">Monto</td>
		             <td style="padding:9px 14px;color:#111827;font-size:15px;font-weight:700;">${escapeHtml(c.manualLabel ?? c.totalLabel)}</td></tr>
		         <tr><td style="padding:9px 14px;color:#6b7280;font-size:13px;">Concepto</td>
		             <td style="padding:9px 14px;color:#111827;font-size:14px;font-weight:600;">Pedido ${c.orderId}</td></tr>
		       </table>
		       ${c.instrucciones ? `<div style="padding:12px 14px;background:#fffbeb;color:#78350f;font-size:13px;">${escapeHtml(c.instrucciones)}</div>` : ''}
		     </div>
		   </td></tr>`
		: '';

	const avisoCombinado = c.esCombinado
		? `<tr><td style="padding:0 28px 10px;">
		     <p style="margin:0;background:#fef2f2;border-left:4px solid #dc2626;padding:12px 14px;font-size:13px;color:#7f1d1d;">
		       Son <b>dos pagos</b> y hay que hacer los dos. El pedido se prepara cuando estén acreditados ambos.
		     </p>
		   </td></tr>`
		: '';

	const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
	<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;"><tr><td align="center">
	<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:600px;">
	${LOGO_ROW}
	<tr><td style="padding:8px 28px 18px;text-align:center;">
	  <h1 style="margin:0 0 6px;font-size:20px;color:#111827;">Tu pedido #${c.orderId}</h1>
	  <p style="margin:0;font-size:14px;color:#6b7280;">Total: <b style="color:#111827;">${escapeHtml(c.totalLabel)}</b></p>
	</td></tr>
	<tr><td style="padding:0 28px 14px;">
	  <p style="margin:0;font-size:15px;color:#374151;line-height:1.6;">Hola ${escapeHtml(c.customerName || '')}, acá va cómo abonarlo.</p>
	</td></tr>
	${avisoCombinado}
	${mpBlock}
	${manualBlock}
	<tr><td style="padding:14px 28px 24px;">
	  <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6;">
	    Cualquier duda respondé este mail o escribinos a
	    <a href="mailto:${SALES_EMAIL}" style="color:#0ea5e9;">${SALES_EMAIL}</a>.
	  </p>
	</td></tr>
	<tr><td style="padding:14px 28px;background:#f4f4f5;color:#9ca3af;font-size:11px;text-align:center;">RF Store — ${SITE_URL.replace(/^https?:\/\//, '')}</td></tr>
	</table></td></tr></table></body></html>`;

	const text = [
		`Tu pedido #${c.orderId}`,
		`Total: ${c.totalLabel}`,
		'',
		`Hola ${c.customerName || ''}, acá va cómo abonarlo.`,
		c.esCombinado ? '\nSon DOS pagos y hay que hacer los dos.' : '',
		c.mpLink ? `\n${c.esCombinado ? 'Parte 1 — ' : ''}MercadoPago (${c.mpLabel}):\n${c.mpLink}` : '',
		c.manualRows.length
			? `\n${c.esCombinado ? 'Parte 2 — ' : ''}${c.manualTitle}:\n` +
			  c.manualRows.map(([k, v]) => `  ${k}: ${v}`).join('\n') +
			  `\n  Monto: ${c.manualLabel ?? c.totalLabel}\n  Concepto: Pedido ${c.orderId}`
			: '',
		c.instrucciones ? `\n${c.instrucciones}` : '',
		`\nDudas: ${SALES_EMAIL}`,
	].filter(Boolean).join('\n');

	return { subject, html, text };
}

/** Crea la preferencia de MercadoPago por un monto puntual de la orden. */
async function crearPreferencia(
	orderId: number, montoUsd: number, fxRate: number,
	payerEmail: string, payerName: string
): Promise<{ initPoint: string; prefId: string; importe: number; moneda: string }> {
	const enUyu = fxRate > 0;
	const moneda = enUyu ? 'UYU' : 'USD';
	const importe = enUyu ? Math.round(montoUsd * fxRate) : Number(montoUsd.toFixed(2));

	const body = {
		items: [{
			title: `Pedido #${orderId} — RF Store`,
			quantity: 1,
			currency_id: moneda,
			unit_price: Math.max(enUyu ? 1 : 0.01, importe),
		}],
		payer: { email: payerEmail, name: payerName || undefined },
		back_urls: {
			success: `${SITE_URL}/checkout/${orderId}/thank-you?status=success`,
			failure: `${SITE_URL}/checkout/${orderId}/thank-you?status=failure`,
			pending: `${SITE_URL}/checkout/${orderId}/thank-you?status=pending`,
		},
		auto_return: 'approved',
		external_reference: String(orderId),
		notification_url: `${SUPABASE_URL}/functions/v1/mp-webhook`,
		statement_descriptor: 'RFSTORE',
	};

	const r = await fetch('https://api.mercadopago.com/checkout/preferences', {
		method: 'POST',
		headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	if (!r.ok) throw new Error(`MercadoPago ${r.status}: ${(await r.text()).slice(0, 300)}`);
	const pref = await r.json();
	return { initPoint: pref.init_point, prefId: pref.id, importe, moneda };
}

Deno.serve(async req => {
	if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

	const json = (body: unknown, status = 200) =>
		new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

	try {
		// --- Sólo admin (o el propio servidor) ---
		// Se acepta el JWT de un admin logueado (el botón del panel) o el de
		// service_role, que sólo existe del lado del servidor y nunca viaja al
		// navegador. Sin esto no hay forma de disparar un envío de prueba.
		const authHeader = req.headers.get('Authorization') ?? '';
		const token = authHeader.replace(/^Bearer\s+/i, '');
		let rol = '';
		try {
			rol = JSON.parse(atob(token.split('.')[1] ?? '')).role ?? '';
		} catch { /* token no-JWT: se resuelve abajo */ }

		if (rol !== 'service_role') {
			const supabaseUser = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
				global: { headers: { Authorization: authHeader } },
				auth: { persistSession: false, autoRefreshToken: false },
			});
			const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
			if (userErr || !userData.user) return json({ error: 'no autenticado' }, 401);

			const { data: roleRow } = await supabaseAdmin
				.from('user_roles').select('role').eq('user_id', userData.user.id).single();
			if (!roleRow || roleRow.role !== 'admin') return json({ error: 'requiere rol admin' }, 403);
		}

		const body = await req.json().catch(() => ({}));
		const orderId = Number(body.order_id);
		if (!orderId) return json({ error: 'order_id requerido' }, 400);

		const { data: order } = await supabaseAdmin
			.from('orders')
			.select('id, channel, payment_method, payment_status, payment_split, total_amount, total_original, ml_currency, fx_rate, customer_id')
			.eq('id', orderId)
			.single();
		if (!order) return json({ error: 'orden no encontrada' }, 404);
		if (order.channel !== 'manual') return json({ error: 'esta función es sólo para ventas manuales' }, 400);
		if (order.payment_status === 'paid') return json({ error: 'la venta ya figura cobrada' }, 409);

		const metodo = String(order.payment_method ?? '');

		// Regla del dueño: en transferencia sola la cuenta se la pasa él en persona.
		if (metodo === 'transfer') {
			return json({ error: 'En transferencia los datos se los pasás vos. Acá no se manda mail de cobro.' }, 400);
		}
		if (metodo !== 'mercadopago' && metodo !== 'hybrid' && metodo !== 'deposit') {
			return json({ error: `Método sin instrucciones de pago: ${metodo || 'sin definir'}` }, 400);
		}

		const { data: customer } = await supabaseAdmin
			.from('customers').select('full_name, email').eq('id', order.customer_id ?? '').single();
		if (!customer?.email) {
			return json({ error: 'La venta no tiene un cliente con mail cargado: agregáselo para poder enviarle el cobro.' }, 400);
		}

		// Cotización: la congelada en la venta; si no tiene, la del día.
		let fx = Number(order.fx_rate) || 0;
		if (fx <= 0) {
			const { data: fxRow } = await supabaseAdmin
				.from('app_settings').select('value').eq('key', 'usd_uyu_rate_cache').maybeSingle();
			fx = Number((fxRow?.value as any)?.rate) || 0;
		}
		const totalUsd = Number(order.total_amount) || 0;
		const money = (usd: number) =>
			fx > 0 ? `$ ${Math.round(usd * fx).toLocaleString('es-UY')}` : `USD ${usd.toFixed(2)}`;

		// --- Parte MercadoPago ---
		let mpLink: string | null = null;
		let mpLabel: string | null = null;
		if (metodo === 'mercadopago' || metodo === 'hybrid') {
			const montoMp = metodo === 'hybrid'
				? Number((order.payment_split as any)?.mercadopago) || 0
				: totalUsd;
			if (montoMp <= 0) return json({ error: 'la venta no tiene monto para cobrar por MercadoPago' }, 400);

			const pref = await crearPreferencia(orderId, montoMp, fx, customer.email, customer.full_name ?? '');
			mpLink = pref.initPoint;
			mpLabel = money(montoMp);
			await supabaseAdmin.from('orders').update({ mp_preference_id: pref.prefId }).eq('id', orderId);
		}

		// --- Parte manual (banco o Abitab) ---
		const { data: settings } = await supabaseAdmin
			.from('app_settings').select('key, value').in('key', ['payment_transfer_info', 'payment_deposit_info']);
		const map = new Map((settings ?? []).map(r => [r.key, r.value]));
		const transferInfo = (map.get('payment_transfer_info') as TransferInfo) ?? {};
		const depositInfo = (map.get('payment_deposit_info') as DepositInfo) ?? {};

		let manualTitle: string | null = null;
		let manualRows: Array<[string, string]> = [];
		let manualLabel: string | null = null;
		let instrucciones: string | null = null;

		if (metodo === 'hybrid') {
			manualTitle = 'Transferencia bancaria';
			manualRows = bankRows(transferInfo);
			manualLabel = money(Number((order.payment_split as any)?.transfer) || 0);
		} else if (metodo === 'deposit') {
			manualTitle = 'Depósito (Abitab / Redpagos)';
			manualRows = depositRows(depositInfo);
			manualLabel = money(totalUsd);
			instrucciones = depositInfo.instrucciones ?? null;
		}

		const mail = renderMail({
			orderId,
			customerName: customer.full_name ?? '',
			totalLabel: money(totalUsd),
			mpLink, mpLabel,
			manualTitle, manualRows, manualLabel, instrucciones,
			esCombinado: metodo === 'hybrid',
		});

		const r = await fetch('https://api.resend.com/emails', {
			method: 'POST',
			headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				from: `${FROM_NAME} <${FROM_EMAIL}>`,
				to: [customer.email],
				reply_to: SALES_EMAIL,
				subject: mail.subject,
				html: mail.html,
				text: mail.text,
			}),
		});
		if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 300)}`);

		return json({ ok: true, sent_to: customer.email, method: metodo, init_point: mpLink });
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return json({ error: msg }, 500);
	}
});
