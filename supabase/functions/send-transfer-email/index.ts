// deno-lint-ignore-file no-explicit-any
// send-transfer-email
// Manda al COMPRADOR (cuenta logueada) el email con los datos bancarios para
// que haga la transferencia. Se invoca despu\u00e9s de crear la orden por
// transferencia. Manda copia BCC al admin si ADMIN_EMAIL est\u00e1 seteado.
//
// Requiere env vars en Supabase:
//   RESEND_API_KEY      - API key de resend.com (re_xxxxxxxx)
//   FROM_EMAIL          - 'pedidos@rfstore.uy' (dominio verificado en Resend)
//   ADMIN_EMAIL         - opcional, email del admin para BCC
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY (built-in)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'pedidos@rfstore.uy';
const ADMIN_EMAIL = Deno.env.get('ADMIN_EMAIL') ?? '';

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

function renderEmail(opts: {
	orderId: number;
	customerName: string;
	totalUsd: number;
	totalUyu: number | null;
	transfer: { banco?: string; cuenta?: string; titular?: string; rut?: string };
	items: Array<{ name: string; quantity: number; price: number }>;
}): { subject: string; html: string; text: string } {
	const { orderId, customerName, totalUsd, totalUyu, transfer, items } = opts;
	const subject = `Datos para tu transferencia \u2014 Pedido #${orderId} \u2014 RF Store`;
	const safeName = escapeHtml(customerName || 'Cliente');
	const totalUsdLabel = `USD ${totalUsd.toFixed(0)}`;
	const totalUyuLabel = totalUyu !== null
		? `\u2248 UYU ${totalUyu.toLocaleString('es-UY')} (al BCU de hoy)`
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

	const bank = (label: string, value?: string) =>
		`<tr><td style="padding:6px 12px;color:#666;">${label}</td><td style="padding:6px 12px;font-weight:600;color:#111;">${escapeHtml(value || '\u2014')}</td></tr>`;

	const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
      <tr><td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:600px;">
          <tr><td style="padding:24px 32px;background:#111;color:#fff;">
            <h1 style="margin:0;font-size:20px;">RF Store</h1>
          </td></tr>
          <tr><td style="padding:32px;">
            <p style="margin:0 0 8px;font-size:16px;">\u00a1Gracias por tu compra, ${safeName}!</p>
            <p style="margin:0 0 24px;color:#555;line-height:1.5;">Recibimos tu pedido <b>#${orderId}</b>. Te dejamos los datos para que hagas la <b>transferencia bancaria</b>. Una vez recibida, vas a poder ver el estado actualizado en tu cuenta y te avisaremos por mail.</p>

            <h2 style="margin:0 0 12px;font-size:14px;text-transform:uppercase;color:#111;letter-spacing:0.5px;">Datos para transferir</h2>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:24px;">
              ${bank('Banco', transfer.banco)}
              ${bank('Cuenta', transfer.cuenta)}
              ${bank('Titular', transfer.titular)}
              ${bank('RUT', transfer.rut)}
              <tr><td style="padding:6px 12px;color:#666;">Monto</td><td style="padding:6px 12px;font-weight:600;color:#111;">${montoLine}</td></tr>
              ${bank('Concepto', `Pedido ${orderId}`)}
            </table>

            <h2 style="margin:0 0 12px;font-size:14px;text-transform:uppercase;color:#111;letter-spacing:0.5px;">Detalle del pedido</h2>
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:8px;">
              ${itemsHtml}
              <tr><td colspan="2" style="border-top:1px solid #e5e7eb;padding-top:12px;text-align:right;font-size:16px;font-weight:700;">Total: ${totalUsdLabel}${totalUyu !== null ? ` <span style="font-weight:400;font-size:12px;color:#666;">${totalUyuLabel}</span>` : ''}</td></tr>
            </table>

            <h2 style="margin:0 0 12px;font-size:14px;text-transform:uppercase;color:#111;letter-spacing:0.5px;">Siguiente paso</h2>
            <p style="margin:0 0 8px;color:#444;line-height:1.6;">1. Hac\u00e9 la transferencia desde tu banco a la cuenta indicada.</p>
            <p style="margin:0 0 8px;color:#444;line-height:1.6;">2. Subi el comprobante desde la p\u00e1gina de tu pedido o respond\u00e9 este mail con la imagen adjunta.</p>
            <p style="margin:0 0 24px;color:#444;line-height:1.6;">3. En cuanto verifiquemos el pago, despachamos tu pedido y te avisamos.</p>
          </td></tr>
          <tr><td style="padding:20px 32px;background:#f4f4f5;color:#666;font-size:12px;text-align:center;">RF Store \u2014 RUT 220006580014<br/>Si tenes dudas, respond\u00e9 este mail.</td></tr>
        </table>
      </td></tr>
    </table></body></html>`;

	const totalTextLine = totalUyu !== null
		? `${totalUsdLabel} (\u2248 UYU ${totalUyu.toLocaleString('es-UY')} al BCU de hoy)`
		: totalUsdLabel;
	const text = `Gracias por tu compra, ${customerName || 'Cliente'}!\n\nPedido #${orderId} \u2014 Total: ${totalTextLine}\n\nDatos para transferir:\nBanco: ${transfer.banco || '\u2014'}\nCuenta: ${transfer.cuenta || '\u2014'}\nTitular: ${transfer.titular || '\u2014'}\nRUT: ${transfer.rut || '\u2014'}\nConcepto: Pedido ${orderId}\n\nDespues de transferir, subi el comprobante desde tu cuenta o responde este mail con la imagen.`;

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
		if (!orderId) {
			return new Response(JSON.stringify({ error: 'order_id requerido' }), {
				status: 400,
				headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			});
		}

		// Bypass para reenv\u00edo admin: si llaman con SERVICE_ROLE_KEY como bearer,
		// saltamos la validaci\u00f3n de user/customer (la orden se identifica solo por id).
		const isServiceRoleCall = authHeader === `Bearer ${SERVICE_ROLE}`;
		let customer: { id: string; full_name: string | null; email: string | null } | null = null;
		let userEmail: string | null = null;

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
			const { data: c } = await supabaseAdmin
				.from('customers')
				.select('id, full_name, email')
				.eq('user_id', userData.user.id)
				.single();
			customer = c as any;
		}

		if (!customer) {
			return new Response(JSON.stringify({ error: 'cliente no encontrado' }), {
				status: 400,
				headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			});
		}

		let orderQ = supabaseAdmin
			.from('orders')
			.select('id, total_amount, payment_method, customer_id')
			.eq('id', orderId);
		if (!isServiceRoleCall) orderQ = orderQ.eq('customer_id', customer.id);
		const { data: order, error: orderErr } = await orderQ.single();
		if (orderErr || !order) {
			return new Response(JSON.stringify({ error: 'orden no encontrada' }), {
				status: 404,
				headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			});
		}
		if (order.payment_method !== 'transfer') {
			return new Response(JSON.stringify({ error: 'la orden no es por transferencia' }), {
				status: 400,
				headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			});
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
			.select('value')
			.eq('key', 'payment_transfer_info')
			.maybeSingle();
		const transfer = (settings?.value as any) ?? {};

		const toEmail = customer.email || userEmail;
		if (!toEmail) {
			return new Response(JSON.stringify({ error: 'cliente sin email' }), {
				status: 400,
				headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			});
		}

		// Cotizaci\u00f3n BCU para mostrar el equivalente en UYU. Si falla, mandamos
		// el mail sin UYU (mejor eso que romper el env\u00edo del comprobante).
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
			customerName: customer.full_name || '',
			totalUsd: Number(order.total_amount),
			totalUyu,
			transfer,
			items,
		});

		const result = await sendViaResend({
			to: toEmail,
			bcc: ADMIN_EMAIL || undefined,
			subject,
			html,
			text,
		});

		return new Response(
			JSON.stringify({ ok: true, message_id: result.id, sent_to: toEmail }),
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
