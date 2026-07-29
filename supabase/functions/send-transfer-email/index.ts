// deno-lint-ignore-file no-explicit-any
// send-transfer-email
// Manda al COMPRADOR el email con los datos para pagar su pedido. Cubre los DOS
// métodos manuales:
//   - transfer: datos bancarios (Santander / otro banco)
//   - deposit : redes de cobranza (Abitab / Redpagos)
// El slug quedó con el nombre viejo ("transfer") para no romper llamadas
// existentes. Se invoca después de crear la orden y también desde el panel
// (botón "Reenviar datos de pago"). Además avisa al admin, en un mail aparte,
// que hay un pedido esperando pago (antes era sólo un BCC: si el mail al
// cliente no salía, el admin tampoco se enteraba).
//
// Requiere env vars en Supabase:
//   RESEND_API_KEY      - API key de resend.com (re_xxxxxxxx)
//   FROM_EMAIL          - 'pedidos@rfstore.uy' (dominio verificado en Resend)
//   ADMIN_EMAIL         - opcional, destinatario del aviso al admin
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY (built-in)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'pedidos@rfstore.uy';
const ADMIN_EMAIL = Deno.env.get('ADMIN_EMAIL') ?? '';
const SALES_EMAIL = 'ventas@rfstore.uy';
const SALES_WHATSAPP_LABEL = '094 116 299';
const SALES_WHATSAPP_LINK = '59894116299';
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://rfstore.uy';

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE, {
	auth: { persistSession: false, autoRefreshToken: false },
});

function escapeHtml(s: string): string {
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

// Datos configurados en el panel (app_settings).
interface TransferInfo {
	banco?: string;
	titular?: string;
	rut?: string;
	moneda?: string;
	cuenta?: string;
	cuenta_santander?: string;
	sucursal_santander?: string;
	cuenta_externa?: string;
}
interface DepositInfo {
	abitab?: string;
	redpagos?: string;
	instrucciones?: string;
}

/** Filas (label, valor) del bloque de datos de pago según el método. */
function paymentRows(
	method: 'transfer' | 'deposit',
	transfer: TransferInfo,
	deposit: DepositInfo
): Array<[string, string]> {
	const rows: Array<[string, string]> = [];
	if (method === 'transfer') {
		// OJO: la clave `cuenta` quedó vacía en producción; el número real vive en
		// cuenta_santander / cuenta_externa. Si tomáramos sólo `cuenta`, el mail
		// salía con "Cuenta: —" y el cliente no podía pagar.
		const cuenta = transfer.cuenta || transfer.cuenta_santander || transfer.cuenta_externa;
		if (transfer.banco) rows.push(['Banco', transfer.banco]);
		if (cuenta) rows.push(['Cuenta', cuenta]);
		if (transfer.sucursal_santander) rows.push(['Sucursal', transfer.sucursal_santander]);
		if (transfer.cuenta_externa && transfer.cuenta_externa !== cuenta) {
			rows.push(['Desde otro banco', transfer.cuenta_externa]);
		}
		if (transfer.titular) rows.push(['Titular', transfer.titular]);
		if (transfer.rut) rows.push(['RUT', transfer.rut]);
		if (transfer.moneda) rows.push(['Moneda', transfer.moneda]);
	} else {
		if (deposit.abitab) rows.push(['Abitab', deposit.abitab]);
		if (deposit.redpagos) rows.push(['Redpagos', deposit.redpagos]);
	}
	return rows;
}

function renderEmail(opts: {
	orderId: number;
	method: 'transfer' | 'deposit';
	customerName: string;
	totalUsd: number;
	totalUyu: number | null;
	transfer: TransferInfo;
	deposit: DepositInfo;
	items: Array<{ name: string; quantity: number; price: number }>;
}): { subject: string; html: string; text: string } {
	const { orderId, method, customerName, totalUsd, totalUyu, transfer, deposit, items } = opts;
	const isDeposit = method === 'deposit';
	const subject = isDeposit
		? `Datos para tu depósito (Abitab / Redpagos) — Pedido #${orderId} — RF Store`
		: `Datos para tu transferencia — Pedido #${orderId} — RF Store`;
	const safeName = escapeHtml(customerName || 'Cliente');
	const totalUsdLabel = `USD ${totalUsd.toFixed(0)}`;
	const totalUyuLabel = totalUyu !== null
		? `≈ UYU ${totalUyu.toLocaleString('es-UY')} (al BROU de hoy)`
		: '';
	const montoLine = totalUyu !== null
		? `${totalUsdLabel} <span style="color:#666;font-weight:400;">${totalUyuLabel}</span>`
		: totalUsdLabel;

	const itemsHtml = items
		.map(
			it => `<tr>
        <td style="padding:8px 0;">${escapeHtml(it.name)} <span style="color:#888">x${it.quantity}</span></td>
        <td style="padding:8px 0;text-align:right;font-weight:600;">USD ${(it.price * it.quantity).toFixed(0)}</td>
      </tr>`
		)
		.join('');

	const row = (label: string, value: string) =>
		`<tr><td style="padding:6px 12px;color:#666;">${escapeHtml(label)}</td><td style="padding:6px 12px;font-weight:600;color:#111;">${escapeHtml(value)}</td></tr>`;

	const rows = paymentRows(method, transfer, deposit);
	const dataRowsHtml =
		rows.map(([l, v]) => row(l, v)).join('') ||
		row('Datos', 'Te los pasamos por WhatsApp');

	const bloqueTitulo = isDeposit ? 'Dónde depositar' : 'Datos para transferir';
	const introAccion = isDeposit
		? 'Te dejamos los datos para que hagas el <b>depósito en Abitab o Redpagos</b>.'
		: 'Te dejamos los datos para que hagas la <b>transferencia bancaria</b>.';
	const instruccionesHtml =
		isDeposit && deposit.instrucciones
			? `<p style="margin:0 0 24px;color:#444;line-height:1.6;white-space:pre-line;">${escapeHtml(deposit.instrucciones)}</p>`
			: '';

	const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
      <tr><td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:600px;">
          <tr><td style="padding:24px 32px;background:#111;color:#fff;">
            <h1 style="margin:0;font-size:20px;">RF Store</h1>
          </td></tr>
          <tr><td style="padding:32px;">
            <p style="margin:0 0 8px;font-size:16px;">¡Gracias por tu compra, ${safeName}!</p>
            <p style="margin:0 0 24px;color:#555;line-height:1.5;">Recibimos tu pedido <b>#${orderId}</b>. ${introAccion} Una vez recibido el pago, vas a poder ver el estado actualizado en tu cuenta y te avisaremos por mail.</p>

            <h2 style="margin:0 0 12px;font-size:14px;text-transform:uppercase;color:#111;letter-spacing:0.5px;">${bloqueTitulo}</h2>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:24px;">
              ${dataRowsHtml}
              <tr><td style="padding:6px 12px;color:#666;">Monto</td><td style="padding:6px 12px;font-weight:600;color:#111;">${montoLine}</td></tr>
              ${row('Concepto', `Pedido ${orderId}`)}
            </table>
            ${instruccionesHtml}

            <h2 style="margin:0 0 12px;font-size:14px;text-transform:uppercase;color:#111;letter-spacing:0.5px;">Detalle del pedido</h2>
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:8px;">
              ${itemsHtml}
              <tr><td colspan="2" style="border-top:1px solid #e5e7eb;padding-top:12px;text-align:right;font-size:16px;font-weight:700;">Total: ${totalUsdLabel}${totalUyu !== null ? ` <span style="font-weight:400;font-size:12px;color:#666;">${totalUyuLabel}</span>` : ''}</td></tr>
            </table>

            <h2 style="margin:0 0 12px;font-size:14px;text-transform:uppercase;color:#111;letter-spacing:0.5px;">Cómo nos hacés llegar el comprobante</h2>
            <p style="margin:0 0 8px;color:#444;line-height:1.6;">Elegí la opción que más te convenga:</p>
            <ul style="margin:0 0 16px;padding-left:18px;color:#444;line-height:1.7;">
              <li>Subiendo el archivo desde la página de tu pedido: <a href="${SITE_URL}/checkout/${orderId}/thank-you?status=pending" style="color:#0a7a4a;">ver mi pedido</a></li>
              <li>Por mail a <a href="mailto:${SALES_EMAIL}?subject=Comprobante Pedido %23${orderId}" style="color:#0a7a4a;">${SALES_EMAIL}</a></li>
              <li>Por WhatsApp al <a href="https://wa.me/${SALES_WHATSAPP_LINK}?text=Comprobante%20Pedido%20%23${orderId}" style="color:#0a7a4a;">${SALES_WHATSAPP_LABEL}</a></li>
            </ul>
            <p style="margin:0 0 24px;color:#444;line-height:1.6;">En cuanto verifiquemos el pago, despachamos tu pedido y te avisamos.</p>
          </td></tr>
          <tr><td style="padding:20px 32px;background:#f4f4f5;color:#666;font-size:12px;text-align:center;">RF Store — RUT 220006580014<br/>Si tenes dudas, respondé este mail.</td></tr>
        </table>
      </td></tr>
    </table></body></html>`;

	const totalTextLine = totalUyu !== null
		? `${totalUsdLabel} (≈ UYU ${totalUyu.toLocaleString('es-UY')} al BROU de hoy)`
		: totalUsdLabel;
	const rowsText = rows.map(([l, v]) => `${l}: ${v}`).join('\n');
	const text = `Gracias por tu compra, ${customerName || 'Cliente'}!\n\nPedido #${orderId} — Total: ${totalTextLine}\n\n${bloqueTitulo}:\n${rowsText}\nConcepto: Pedido ${orderId}\n${isDeposit && deposit.instrucciones ? `\n${deposit.instrucciones}\n` : ''}\nDespues de pagar, mandanos el comprobante por:\n- Web: ${SITE_URL}/checkout/${orderId}/thank-you?status=pending\n- Mail: ${SALES_EMAIL}\n- WhatsApp: ${SALES_WHATSAPP_LABEL}`;

	return { subject, html, text };
}

/** Aviso al ADMIN de que el cliente subió el comprobante de pago. */
function renderProofEmail(opts: {
	orderId: number;
	method: 'transfer' | 'deposit';
	customerName: string;
	customerEmail: string;
	totalUsd: number;
}): { subject: string; html: string; text: string } {
	const { orderId, method, customerName, customerEmail, totalUsd } = opts;
	const metodo = method === 'deposit' ? 'Depósito (Abitab / Redpagos)' : 'Transferencia bancaria';
	const subject = `📎 Comprobante subido — Pedido #${orderId} — USD ${totalUsd.toFixed(0)}`;
	const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;"><tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:600px;">
        <tr><td style="padding:20px 28px;background:#0ea5e9;color:#fff;">
          <h1 style="margin:0;font-size:18px;">📎 Comprobante subido — Pedido #${orderId}</h1>
          <p style="margin:4px 0 0;opacity:0.95;font-size:13px;">${escapeHtml(metodo)} — USD ${totalUsd.toFixed(0)}</p>
        </td></tr>
        <tr><td style="padding:24px 28px;">
          <p style="margin:0 0 16px;color:#444;line-height:1.6;">${escapeHtml(customerName || 'El cliente')} (<a href="mailto:${escapeHtml(customerEmail)}" style="color:#0ea5e9;">${escapeHtml(customerEmail)}</a>) subió el comprobante de pago. Revisalo y aprobá el pago para que salga la confirmación al cliente.</p>
          <div style="text-align:center;">
            <a href="${SITE_URL}/dashboard/ordenes/${orderId}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:600;">Ver comprobante en el dashboard →</a>
          </div>
        </td></tr>
        <tr><td style="padding:14px 28px;background:#f4f4f5;color:#888;font-size:11px;text-align:center;">RF Store — Notificación automática</td></tr>
      </table>
    </td></tr></table></body></html>`;
	const text = `Comprobante subido — Pedido #${orderId} (${metodo}, USD ${totalUsd.toFixed(0)})\n\n${customerName || 'El cliente'} (${customerEmail}) subió el comprobante.\n\nVer pedido: ${SITE_URL}/dashboard/ordenes/${orderId}`;
	return { subject, html, text };
}

/**
 * Aviso al ADMIN de que entró un pedido esperando pago manual. Antes esto era
 * sólo un BCC del mail del cliente: si el mail al cliente no salía (p. ej. los
 * pedidos por depósito, que nunca lo disparaban), el admin tampoco se enteraba.
 * La notificación de "venta confirmada" (send-order-confirmation) recién sale
 * cuando el pago se marca como recibido, o sea nunca para un pedido pendiente.
 */
function renderAdminEmail(opts: {
	orderId: number;
	method: 'transfer' | 'deposit';
	customerName: string;
	customerEmail: string;
	totalUsd: number;
	totalUyu: number | null;
	items: Array<{ name: string; quantity: number; price: number }>;
}): { subject: string; html: string; text: string } {
	const { orderId, method, customerName, customerEmail, totalUsd, totalUyu, items } = opts;
	const metodo = method === 'deposit' ? 'Depósito (Abitab / Redpagos)' : 'Transferencia bancaria';
	const totalLabel = `USD ${totalUsd.toFixed(0)}${totalUyu !== null ? ` (≈ UYU ${totalUyu.toLocaleString('es-UY')})` : ''}`;
	const subject = `🕒 Pedido #${orderId} esperando pago — ${metodo} — USD ${totalUsd.toFixed(0)}`;
	const itemsHtml = items
		.map(
			it =>
				`<tr><td style="padding:6px 0;">${escapeHtml(it.name)} <span style="color:#888">x${it.quantity}</span></td><td style="padding:6px 0;text-align:right;font-weight:600;">USD ${(it.price * it.quantity).toFixed(0)}</td></tr>`
		)
		.join('');
	const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;"><tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:600px;">
        <tr><td style="padding:20px 28px;background:#f59e0b;color:#fff;">
          <h1 style="margin:0;font-size:18px;">🕒 Pedido #${orderId} esperando pago</h1>
          <p style="margin:4px 0 0;opacity:0.95;font-size:13px;">${escapeHtml(metodo)} — ${totalLabel}</p>
        </td></tr>
        <tr><td style="padding:24px 28px;">
          <p style="margin:0 0 4px;font-size:13px;color:#666;">Cliente</p>
          <p style="margin:0 0 16px;font-weight:600;color:#111;">${escapeHtml(customerName || 'Sin nombre')} — <a href="mailto:${escapeHtml(customerEmail)}" style="color:#0ea5e9;">${escapeHtml(customerEmail)}</a></p>
          <p style="margin:0 0 6px;font-size:13px;color:#666;">Items</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;">${itemsHtml}
            <tr><td colspan="2" style="border-top:1px solid #e5e7eb;padding-top:10px;text-align:right;font-size:15px;font-weight:700;">Total: ${totalLabel}</td></tr>
          </table>
          <p style="margin:16px 0 0;color:#555;font-size:13px;line-height:1.6;">Ya le mandamos al cliente los datos para pagar. Cuando llegue el comprobante, aprobá el pago en el panel.</p>
          <div style="margin-top:20px;text-align:center;">
            <a href="${SITE_URL}/dashboard/ordenes/${orderId}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:600;">Ver pedido en el dashboard →</a>
          </div>
        </td></tr>
        <tr><td style="padding:14px 28px;background:#f4f4f5;color:#888;font-size:11px;text-align:center;">RF Store — Notificación automática</td></tr>
      </table>
    </td></tr></table></body></html>`;
	const text = `Pedido #${orderId} esperando pago (${metodo})\n\nCliente: ${customerName || 'Sin nombre'} (${customerEmail})\nTotal: ${totalLabel}\n\nItems:\n${items.map(it => `  - ${it.name} x${it.quantity} (USD ${(it.price * it.quantity).toFixed(0)})`).join('\n')}\n\nVer pedido: ${SITE_URL}/dashboard/ordenes/${orderId}`;
	return { subject, html, text };
}

async function sendViaResend(payload: {
	to: string;
	bcc?: string;
	subject: string;
	html: string;
	text: string;
}): Promise<{ id: string }> {
	if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY no configurado');
	const body: any = {
		from: `RF Store <${FROM_EMAIL}>`,
		to: [payload.to],
		subject: payload.subject,
		html: payload.html,
		text: payload.text,
	};
	if (payload.bcc) body.bcc = [payload.bcc];
	const r = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${RESEND_API_KEY}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body),
	});
	if (!r.ok) {
		const errText = await r.text();
		throw new Error(`Resend ${r.status}: ${errText.slice(0, 500)}`);
	}
	return await r.json();
}

Deno.serve(async req => {
	if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

	const authHeader = req.headers.get('Authorization') ?? '';
	const supabaseUser = createClient(SUPABASE_URL, ANON, {
		global: { headers: { Authorization: authHeader } },
		auth: { persistSession: false, autoRefreshToken: false },
	});

	try {
		const body = await req.json().catch(() => ({}));
		const orderId = Number(body.order_id);
		// 'instructions' (default) = datos para pagar al cliente + aviso al admin.
		// 'proof_uploaded'         = el cliente subió el comprobante -> sólo admin.
		const kind: 'instructions' | 'proof_uploaded' =
			body.kind === 'proof_uploaded' ? 'proof_uploaded' : 'instructions';
		if (!orderId) {
			return new Response(JSON.stringify({ error: 'order_id requerido' }), {
				status: 400,
				headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			});
		}

		// Bypass para reenvío admin: si llaman con SERVICE_ROLE_KEY como bearer,
		// saltamos la validación de user/customer (la orden se identifica solo por id).
		const isServiceRoleCall = authHeader === `Bearer ${SERVICE_ROLE}`;
		let customer: { id: string; full_name: string | null; email: string | null } | null = null;
		let userEmail: string | null = null;
		let isAdminCall = isServiceRoleCall;

		if (isServiceRoleCall) {
			const { data: ord } = await supabaseAdmin
				.from('orders')
				.select('customer_id')
				.eq('id', orderId)
				.single();
			if (!ord) {
				return new Response(JSON.stringify({ error: 'orden no encontrada' }), {
					status: 404,
					headers: { ...corsHeaders, 'Content-Type': 'application/json' },
				});
			}
			const { data: c } = await supabaseAdmin
				.from('customers')
				.select('id, full_name, email')
				.eq('id', ord.customer_id)
				.single();
			customer = c as any;
		} else {
			const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
			if (userErr || !userData.user) {
				return new Response(JSON.stringify({ error: 'no autenticado' }), {
					status: 401,
					headers: { ...corsHeaders, 'Content-Type': 'application/json' },
				});
			}
			userEmail = userData.user.email ?? null;
			// Un admin logueado puede reenviar el mail de CUALQUIER orden desde el
			// panel; el resto sólo de las propias.
			const { data: role } = await supabaseAdmin
				.from('user_roles')
				.select('role')
				.eq('user_id', userData.user.id)
				.eq('role', 'admin')
				.maybeSingle();
			isAdminCall = !!role;
			const { data: c } = await supabaseAdmin
				.from('customers')
				.select('id, full_name, email')
				.eq('user_id', userData.user.id)
				.single();
			customer = c as any;
		}

		let orderQ = supabaseAdmin
			.from('orders')
			.select('id, total_amount, payment_method, customer_id')
			.eq('id', orderId);
		if (!isAdminCall) {
			if (!customer) {
				return new Response(JSON.stringify({ error: 'cliente no encontrado' }), {
					status: 400,
					headers: { ...corsHeaders, 'Content-Type': 'application/json' },
				});
			}
			orderQ = orderQ.eq('customer_id', customer.id);
		}
		const { data: order, error: orderErr } = await orderQ.single();
		if (orderErr || !order) {
			return new Response(JSON.stringify({ error: 'orden no encontrada' }), {
				status: 404,
				headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			});
		}

		// El admin puede pedir el mail de una orden de otro cliente: en ese caso el
		// destinatario es el cliente DE LA ORDEN, no quien apretó el botón.
		if (isAdminCall && (!customer || customer.id !== order.customer_id)) {
			const { data: c } = await supabaseAdmin
				.from('customers')
				.select('id, full_name, email')
				.eq('id', order.customer_id)
				.single();
			customer = (c as any) ?? customer;
			userEmail = null;
		}
		if (!customer) {
			return new Response(JSON.stringify({ error: 'cliente no encontrado' }), {
				status: 400,
				headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			});
		}

		// Los dos métodos manuales necesitan que el cliente reciba dónde pagar.
		// Mercado Pago no: ahí el cobro se hace en la pasarela.
		const method = order.payment_method as string | null;
		if (method !== 'transfer' && method !== 'deposit') {
			return new Response(
				JSON.stringify({ error: 'la orden no es por transferencia ni depósito' }),
				{ status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
			);
		}

		// Comprobante subido: sólo avisamos al admin. Al cliente no le mandamos
		// nada (ya vio la confirmación en pantalla al subirlo).
		if (kind === 'proof_uploaded') {
			if (!ADMIN_EMAIL) {
				return new Response(
					JSON.stringify({ ok: true, skipped: 'ADMIN_EMAIL no seteado' }),
					{ status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
				);
			}
			const proofMail = renderProofEmail({
				orderId: order.id,
				method,
				customerName: customer.full_name || '',
				customerEmail: customer.email || '',
				totalUsd: Number(order.total_amount),
			});
			const proofRes = await sendViaResend({ to: ADMIN_EMAIL, ...proofMail });
			return new Response(
				JSON.stringify({ ok: true, kind, message_id: proofRes.id, sent_to: ADMIN_EMAIL }),
				{ status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
			);
		}

		const { data: itemsRaw } = await supabaseAdmin
			.from('order_items')
			.select('quantity, price, variants(products(name))')
			.eq('order_id', orderId);
		const items = (itemsRaw ?? []).map((it: any) => ({
			name: it.variants?.products?.name ?? 'Producto',
			quantity: it.quantity,
			price: Number(it.price),
		}));

		const { data: settings } = await supabaseAdmin
			.from('app_settings')
			.select('key, value')
			.in('key', ['payment_transfer_info', 'payment_deposit_info']);
		const settingsMap = new Map((settings ?? []).map((s: any) => [s.key, s.value]));
		const transfer = (settingsMap.get('payment_transfer_info') as TransferInfo) ?? {};
		const deposit = (settingsMap.get('payment_deposit_info') as DepositInfo) ?? {};

		const toEmail = customer.email || userEmail;
		if (!toEmail) {
			return new Response(JSON.stringify({ error: 'cliente sin email' }), {
				status: 400,
				headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			});
		}

		// Cotización BROU para mostrar el equivalente en UYU. Si falla, mandamos
		// el mail sin UYU (mejor eso que romper el envío del comprobante).
		let totalUyu: number | null = null;
		try {
			const fxRes = await fetch(`${SUPABASE_URL}/functions/v1/get-fx-rate`, {
				headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
			});
			if (fxRes.ok) {
				const fx = await fxRes.json();
				if (fx?.rate > 0) {
					totalUyu = Math.round(Number(order.total_amount) * Number(fx.rate));
				}
			}
		} catch (fxErr) {
			console.warn('fx fetch failed:', fxErr);
		}

		const { subject, html, text } = renderEmail({
			orderId: order.id,
			method,
			customerName: customer.full_name || '',
			totalUsd: Number(order.total_amount),
			totalUyu,
			transfer,
			deposit,
			items,
		});

		const result = await sendViaResend({ to: toEmail, subject, html, text });

		// Aviso al admin (mail propio, no BCC). Si falla, NO rompemos: el cliente ya
		// recibió sus datos de pago, que es lo crítico.
		let adminMessageId: string | null = null;
		let adminError: string | null = null;
		if (ADMIN_EMAIL) {
			try {
				const adminMail = renderAdminEmail({
					orderId: order.id,
					method,
					customerName: customer.full_name || '',
					customerEmail: toEmail,
					totalUsd: Number(order.total_amount),
					totalUyu,
					items,
				});
				const adminRes = await sendViaResend({ to: ADMIN_EMAIL, ...adminMail });
				adminMessageId = adminRes.id;
			} catch (e) {
				adminError = e instanceof Error ? e.message : String(e);
				console.warn('[send-transfer-email] admin mail failed:', adminError);
			}
		}

		return new Response(
			JSON.stringify({
				ok: true,
				message_id: result.id,
				sent_to: toEmail,
				method,
				admin: ADMIN_EMAIL
					? { message_id: adminMessageId, sent_to: ADMIN_EMAIL, error: adminError }
					: { skipped: 'ADMIN_EMAIL no seteado' },
			}),
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
