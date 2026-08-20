// send-order-confirmation v3
// Manda DOS mails cuando un pago queda confirmado:
//  1) Cliente: 'pago confirmado' con detalle del pedido
//  2) Admin (si ADMIN_EMAIL está seteado): notificación operativa con datos
//     completos (cliente, dirección, método, total, items, link al pedido)
//
// La invocan mp-webhook (cuando MP aprueba) y manual-payment-confirm (cuando el
// admin aprueba una transferencia/depósito). Requiere service_role.
//
// v3 (2026-07-29): shippingLabel contemplaba sólo montevideo/interior, así que
// los envíos de zona metropolitana salían sin línea de envío en los dos mails.

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// Encabezado con el logo, arriba de todo. El archivo vive en el sitio público
// (los clientes de mail no leen assets locales) y es JPG de fondo blanco, así
// que la banda que lo contiene también va en blanco.
// OJO: el mail de carrito abandonado NO lleva logo a propósito — se midió que
// las imágenes lo mandan a la pestaña Promociones de Gmail.
const LOGO_ROW =
	`<tr><td align="center" style="padding:24px 28px 6px;background:#ffffff;"><img src="https://www.rfstore.uy/img/img-docs/logoblancorf.jpg" width="46" height="46" alt="RF Store" style="display:block;border:0;outline:none;text-decoration:none;"></td></tr>`;


const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'ventas@send.rfstore.uy';
const ADMIN_EMAIL = Deno.env.get('ADMIN_EMAIL') ?? '';
const SITE_URL = Deno.env.get('SITE_URL') || 'https://www.rfstore.uy';

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

function escapeHtml(s: string): string { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

function decodeJwtRole(authHeader: string): string | null {
	try {
		const m = authHeader.match(/^Bearer\s+(.+)$/i);
		if (!m) return null;
		const parts = m[1].split('.');
		if (parts.length !== 3) return null;
		const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
		return typeof payload.role === 'string' ? payload.role : null;
	} catch { return null; }
}

function methodLabel(m: string): string {
	return m === 'mercadopago' ? 'Mercado Pago' : m === 'transfer' ? 'Transferencia bancaria' : m === 'deposit' ? 'Depósito en redes' : m;
}

function shippingLabel(zone: string | null, barrio: string | null, dept: string | null): string {
	if (zone === 'montevideo') return `Montevideo${barrio ? ' — ' + barrio : ''}`;
	if (zone === 'metropolitana') return `Zona metropolitana (agencia)${barrio ? ' — ' + barrio : ''}`;
	if (zone === 'interior') return `Interior${dept ? ' — ' + dept : ''}`;
	return '';
}

function renderCustomerEmail(opts: { orderId: number; customerName: string; totalUsd: number; totalUyu: number | null; paymentMethod: string; items: Array<{ name: string; quantity: number; price: number }>; shippingZone: string | null; shippingBarrio: string | null; shippingDepartment: string | null; }): { subject: string; html: string; text: string } {
	const { orderId, customerName, totalUsd, totalUyu, paymentMethod, items, shippingZone, shippingBarrio, shippingDepartment } = opts;
	const subject = `¡Pago confirmado! Pedido #${orderId} — RF Store`;
	const safeName = escapeHtml(customerName || 'Cliente');
	const totalUsdLabel = `USD ${totalUsd.toFixed(0)}`;
	const totalUyuLabel = totalUyu !== null ? `≈ UYU ${totalUyu.toLocaleString('es-UY')} (al BROU de hoy)` : '';
	const ml = methodLabel(paymentMethod);
	const sl = shippingLabel(shippingZone, shippingBarrio, shippingDepartment);
	const itemsHtml = items.map(it => `<tr><td style="padding:8px 0;">${escapeHtml(it.name)} <span style="color:#888">x${it.quantity}</span></td><td style="padding:8px 0;text-align:right;font-weight:600;">USD ${(it.price * it.quantity).toFixed(0)}</td></tr>`).join('');
	const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:600px;">${LOGO_ROW}<tr><td style="padding:24px 32px;background:#111;color:#fff;"><h1 style="margin:0;font-size:20px;">RF Store</h1></td></tr><tr><td style="padding:32px;"><div style="text-align:center;margin-bottom:24px;"><div style="display:inline-block;width:48px;height:48px;background:#10b981;border-radius:50%;line-height:48px;text-align:center;color:#fff;font-size:24px;font-weight:bold;">✓</div></div><p style="margin:0 0 8px;font-size:18px;text-align:center;font-weight:600;">¡Tu pago fue confirmado!</p><p style="margin:0 0 24px;color:#555;line-height:1.5;text-align:center;">Gracias por tu compra, ${safeName}. Recibimos tu pago del pedido <b>#${orderId}</b>.</p><h2 style="margin:0 0 12px;font-size:14px;text-transform:uppercase;color:#111;letter-spacing:0.5px;">Detalle del pedido</h2><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:16px;">${itemsHtml}<tr><td colspan="2" style="border-top:1px solid #e5e7eb;padding-top:12px;text-align:right;font-size:16px;font-weight:700;">Total: ${totalUsdLabel}${totalUyu !== null ? ` <span style="font-weight:400;font-size:12px;color:#666;">${totalUyuLabel}</span>` : ''}</td></tr></table><table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:24px;"><tr><td style="padding:8px 12px;color:#666;">Método de pago</td><td style="padding:8px 12px;font-weight:600;color:#111;text-align:right;">${escapeHtml(ml)}</td></tr>${sl ? `<tr><td style="padding:8px 12px;color:#666;">Envío</td><td style="padding:8px 12px;font-weight:600;color:#111;text-align:right;">${escapeHtml(sl)}</td></tr>` : ''}</table><h2 style="margin:0 0 12px;font-size:14px;text-transform:uppercase;color:#111;letter-spacing:0.5px;">Qué sigue</h2><p style="margin:0 0 8px;color:#444;line-height:1.6;">1. Preparamos tu pedido (1-2 días hábiles).</p><p style="margin:0 0 8px;color:#444;line-height:1.6;">2. Te avisamos cuando se despache.</p><p style="margin:0 0 24px;color:#444;line-height:1.6;">3. Podés ver el estado en tu cuenta de RF Store cuando quieras.</p></td></tr><tr><td style="padding:20px 32px;background:#f4f4f5;color:#666;font-size:12px;text-align:center;">RF Store — RUT 220006580014<br/>Si tenes dudas, respondé este mail.</td></tr></table></td></tr></table></body></html>`;
	const lines = [`¡Pago confirmado!`, '', `Gracias por tu compra, ${customerName || 'Cliente'}.`, `Pedido #${orderId}.`, '', `Total: ${totalUsdLabel}${totalUyu !== null ? ` (≈ UYU ${totalUyu.toLocaleString('es-UY')} al BROU de hoy)` : ''}`, `Método: ${ml}`];
	if (sl) lines.push(`Envío: ${sl}`);
	const text = lines.join('\n');
	return { subject, html, text };
}

function renderAdminEmail(opts: { orderId: number; customerName: string; customerEmail: string; customerPhone: string; totalUsd: number; totalUyu: number | null; paymentMethod: string; mpPaymentId: string | null; items: Array<{ name: string; quantity: number; price: number; externalCode: string | null }>; shippingZone: string | null; shippingBarrio: string | null; shippingDepartment: string | null; address: { line1: string; line2: string | null; city: string; state: string; postal: string | null; country: string | null }; }): { subject: string; html: string; text: string } {
	const { orderId, customerName, customerEmail, customerPhone, totalUsd, totalUyu, paymentMethod, mpPaymentId, items, shippingZone, shippingBarrio, shippingDepartment, address } = opts;
	const subject = `📦 Nueva venta #${orderId} — ${methodLabel(paymentMethod)} — USD ${totalUsd.toFixed(0)}`;
	const totalUsdLabel = `USD ${totalUsd.toFixed(0)}`;
	const totalUyuLabel = totalUyu !== null ? ` (≈ UYU ${totalUyu.toLocaleString('es-UY')})` : '';
	const sl = shippingLabel(shippingZone, shippingBarrio, shippingDepartment);
	const itemsHtml = items.map(it => `<tr><td style="padding:6px 0;">${escapeHtml(it.name)} <span style="color:#888">x${it.quantity}</span>${it.externalCode ? `<br/><span style="font-family:monospace;font-size:11px;color:#888">${escapeHtml(it.externalCode)}</span>` : ''}</td><td style="padding:6px 0;text-align:right;font-weight:600;">USD ${(it.price * it.quantity).toFixed(0)}</td></tr>`).join('');
	const addressHtml = `${escapeHtml(address.line1)}${address.line2 ? '<br/>' + escapeHtml(address.line2) : ''}<br/>${escapeHtml(address.city)}, ${escapeHtml(address.state)}${address.postal ? ' (' + escapeHtml(address.postal) + ')' : ''}<br/>${escapeHtml(address.country ?? 'Uruguay')}`;
	const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;"><tr><td align="center"><table width="640" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:640px;">${LOGO_ROW}<tr><td style="padding:20px 28px;background:#10b981;color:#fff;"><h1 style="margin:0;font-size:18px;">📦 Nueva venta #${orderId}</h1><p style="margin:4px 0 0;opacity:0.95;font-size:13px;">${escapeHtml(methodLabel(paymentMethod))} — ${totalUsdLabel}${totalUyuLabel}</p></td></tr><tr><td style="padding:24px 28px;"><table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;"><tr><td style="width:50%;vertical-align:top;padding-right:12px;"><h3 style="margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#666;">Cliente</h3><p style="margin:0;font-weight:600;color:#111;">${escapeHtml(customerName || 'Sin nombre')}</p><p style="margin:2px 0 0;font-size:13px;color:#555;"><a href="mailto:${escapeHtml(customerEmail)}" style="color:#0ea5e9;">${escapeHtml(customerEmail)}</a></p>${customerPhone ? `<p style="margin:2px 0 0;font-size:13px;color:#555;"><a href="tel:${escapeHtml(customerPhone)}" style="color:#0ea5e9;">${escapeHtml(customerPhone)}</a></p>` : ''}</td><td style="width:50%;vertical-align:top;padding-left:12px;border-left:1px solid #e5e7eb;"><h3 style="margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#666;">Dirección de envío</h3><p style="margin:0;font-size:13px;color:#444;line-height:1.5;">${addressHtml}</p>${sl ? `<p style="margin:6px 0 0;font-size:12px;color:#666;"><b>Zona:</b> ${escapeHtml(sl)}</p>` : ''}</td></tr></table><h3 style="margin:0 0 10px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#666;">Items</h3><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:16px;font-size:13px;">${itemsHtml}<tr><td colspan="2" style="border-top:1px solid #e5e7eb;padding-top:10px;text-align:right;font-size:15px;font-weight:700;">Total: ${totalUsdLabel}${totalUyuLabel}</td></tr></table><table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;"><tr><td style="padding:8px 12px;color:#666;width:140px;">Método de pago</td><td style="padding:8px 12px;font-weight:600;color:#111;">${escapeHtml(methodLabel(paymentMethod))}</td></tr>${mpPaymentId ? `<tr><td style="padding:8px 12px;color:#666;border-top:1px solid #f3f4f6;">MP payment ID</td><td style="padding:8px 12px;font-family:monospace;color:#111;border-top:1px solid #f3f4f6;">${escapeHtml(mpPaymentId)}</td></tr>` : ''}</table><div style="margin-top:24px;text-align:center;"><a href="${SITE_URL}/dashboard/ordenes/${orderId}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:600;">Ver pedido en el dashboard →</a></div></td></tr><tr><td style="padding:14px 28px;background:#f4f4f5;color:#888;font-size:11px;text-align:center;">RF Store — Notificación automática</td></tr></table></td></tr></table></body></html>`;
	const text = `¡Nueva venta #${orderId}!\n\nCliente: ${customerName} (${customerEmail})${customerPhone ? ' — ' + customerPhone : ''}\nTotal: ${totalUsdLabel}${totalUyuLabel}\nMétodo: ${methodLabel(paymentMethod)}\n${mpPaymentId ? 'MP payment ID: ' + mpPaymentId + '\n' : ''}\nEnvío: ${sl || 'sin definir'}\nDirección: ${address.line1}, ${address.city}, ${address.state}\n\nItems:\n${items.map(it => `  - ${it.name} x${it.quantity} (USD ${(it.price * it.quantity).toFixed(0)})`).join('\n')}\n\nVer pedido: ${SITE_URL}/dashboard/ordenes/${orderId}`;
	return { subject, html, text };
}

async function sendViaResend(payload: { to: string; subject: string; html: string; text: string; }): Promise<{ id: string }> {
	if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY no configurado');
	const body: any = { from: `RF Store <${FROM_EMAIL}>`, to: [payload.to], subject: payload.subject, html: payload.html, text: payload.text };
	const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
	if (!r.ok) { const errText = await r.text(); throw new Error(`Resend ${r.status}: ${errText.slice(0, 500)}`); }
	return await r.json();
}

Deno.serve(async req => {
	if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

	const authHeader = req.headers.get('Authorization') ?? '';
	const jwtRole = decodeJwtRole(authHeader);
	if (jwtRole !== 'service_role') return new Response(JSON.stringify({ error: 'requiere service_role' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

	try {
		const body = await req.json().catch(() => ({}));
		const orderId = Number(body.order_id);
		if (!orderId) return new Response(JSON.stringify({ error: 'order_id requerido' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

		const { data: order, error: orderErr } = await supabaseAdmin
			.from('orders')
			.select('id, total_amount, payment_method, payment_status, customer_id, mp_payment_id, shipping_zone, shipping_barrio, shipping_department, address_id')
			.eq('id', orderId).single();
		if (orderErr || !order) return new Response(JSON.stringify({ error: 'orden no encontrada' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
		if (order.payment_status !== 'paid') return new Response(JSON.stringify({ error: 'orden no pagada', payment_status: order.payment_status }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

		const { data: customer } = await supabaseAdmin.from('customers').select('id, full_name, email, phone').eq('id', order.customer_id).single();
		if (!customer?.email) return new Response(JSON.stringify({ error: 'cliente sin email' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

		const { data: addressData } = await supabaseAdmin.from('addresses').select('address_line1, address_line2, city, state, postal_code, country').eq('id', order.address_id).single();
		const address = {
			line1: addressData?.address_line1 ?? '',
			line2: addressData?.address_line2 ?? null,
			city: addressData?.city ?? '',
			state: addressData?.state ?? '',
			postal: addressData?.postal_code ?? null,
			country: addressData?.country ?? null,
		};

		const { data: itemsRaw } = await supabaseAdmin.from('order_items').select('quantity, price, variants(products(name, external_code))').eq('order_id', orderId);
		const items = (itemsRaw ?? []).map((it: any) => ({
			name: it.variants?.products?.name ?? 'Producto',
			quantity: it.quantity,
			price: Number(it.price),
			externalCode: it.variants?.products?.external_code ?? null,
		}));

		let totalUyu: number | null = null;
		try {
			const fxRes = await fetch(`${SUPABASE_URL}/functions/v1/get-fx-rate`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });
			if (fxRes.ok) { const fx = await fxRes.json(); if (fx?.rate > 0) totalUyu = Math.round(Number(order.total_amount) * Number(fx.rate)); }
		} catch (fxErr) { console.warn('fx fetch failed:', fxErr); }

		const customerMail = renderCustomerEmail({
			orderId: order.id,
			customerName: customer.full_name || '',
			totalUsd: Number(order.total_amount), totalUyu,
			paymentMethod: order.payment_method ?? 'mercadopago',
			items: items.map(({ externalCode: _, ...rest }) => rest),
			shippingZone: order.shipping_zone, shippingBarrio: order.shipping_barrio, shippingDepartment: order.shipping_department,
		});
		const customerRes = await sendViaResend({ to: customer.email, ...customerMail });

		let adminRes: { id: string } | null = null;
		let adminError: string | null = null;
		if (ADMIN_EMAIL) {
			try {
				const adminMail = renderAdminEmail({
					orderId: order.id,
					customerName: customer.full_name || '', customerEmail: customer.email, customerPhone: customer.phone ?? '',
					totalUsd: Number(order.total_amount), totalUyu,
					paymentMethod: order.payment_method ?? 'mercadopago',
					mpPaymentId: order.mp_payment_id ?? null,
					items,
					shippingZone: order.shipping_zone, shippingBarrio: order.shipping_barrio, shippingDepartment: order.shipping_department,
					address,
				});
				adminRes = await sendViaResend({ to: ADMIN_EMAIL, ...adminMail });
			} catch (e) {
				adminError = e instanceof Error ? e.message : String(e);
				console.warn('[send-order-confirmation] admin mail failed:', adminError);
			}
		}

		return new Response(JSON.stringify({
			ok: true,
			customer: { message_id: customerRes.id, sent_to: customer.email },
			admin: ADMIN_EMAIL ? { message_id: adminRes?.id, sent_to: ADMIN_EMAIL, error: adminError } : { skipped: 'ADMIN_EMAIL no seteado' },
		}), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
	}
});
