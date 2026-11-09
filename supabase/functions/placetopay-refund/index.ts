// deno-lint-ignore-file no-explicit-any
// placetopay-refund v1 (2026-10-29)
//
// Reembolso TOTAL de un pago con tarjeta (Placetopay action "reverse"). Sólo
// admins, desde el detalle de la orden. Marca payment_status = 'refunded'; el
// estado del pedido (Cancelado, devolución de stock) lo sigue manejando el admin
// como con cualquier otra orden.
//
// v2: al cliente le llega un mail avisando el reembolso (antes no se enteraba).
// { order_id, resend_notice: true } reenvía sólo el mail de un reembolso ya hecho.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';
import { ptpReverse, PtpError } from '../_shared/placetopay.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
	auth: { persistSession: false, autoRefreshToken: false },
});

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'ventas@send.rfstore.uy';
const WHATSAPP_LABEL = '098 732 327';
const WHATSAPP_LINK = '59898732327';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string) => String(s).replace(/[&<>"']/g, c => ESC[c]);

/** Mail al cliente: "te devolvimos la plata". No bloquea el reembolso si falla. */
async function sendRefundMail(orderId: number): Promise<{ sent: boolean; to?: string; error?: string }> {
	try {
		if (!RESEND_API_KEY) return { sent: false, error: 'RESEND_API_KEY no configurado' };
		const { data: o } = await admin.from('orders').select('id, customers(full_name, email)').eq('id', orderId).single();
		const c: any = Array.isArray(o?.customers) ? o?.customers[0] : o?.customers;
		if (!c?.email) return { sent: false, error: 'cliente sin email' };
		const { data: s } = await admin
			.from('placetopay_sessions')
			.select('currency, amount, paid_amount, payment_method_name, last_digits')
			.eq('order_id', orderId)
			.eq('refunded', true)
			.order('created_at', { ascending: false })
			.limit(1)
			.maybeSingle();
		const n = s ? Number(s.paid_amount ?? s.amount) : 0;
		const monto = s
			? `${s.currency === 'UYU' ? '$' : 'USD '}${n.toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${s.currency === 'UYU' ? ' (pesos uruguayos)' : ''}`
			: '';
		const tarjeta = s?.payment_method_name
			? `${s.payment_method_name}${s.last_digits ? ` terminada en ${s.last_digits}` : ''}`
			: 'la tarjeta con la que pagaste';
		const nombre = String(c.full_name ?? '').trim().split(/\s+/)[0] || '';
		const subject = `Reembolsamos tu pago del pedido #${orderId} — RF Store`;
		const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:560px;">
<tr><td align="center" style="padding:24px 28px 6px;"><img src="https://www.rfstore.uy/img/img-docs/logoblancorf.jpg" width="46" height="46" alt="RF Store" style="display:block;border:0;"></td></tr>
<tr><td style="padding:12px 32px 28px;color:#333;line-height:1.6;font-size:15px;">
<p style="margin:0 0 12px;font-size:18px;font-weight:600;color:#111;">${nombre ? `Hola ${esc(nombre)}, ` : ''}te devolvimos el pago</p>
<p style="margin:0 0 16px;">Cancelamos tu pedido <b>#${orderId}</b> y reembolsamos el pago a tu tarjeta.</p>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin:0 0 16px;font-size:14px;">
${monto ? `<tr><td style="padding:8px 12px;color:#666;">Monto reembolsado</td><td style="padding:8px 12px;text-align:right;font-weight:600;color:#111;">${esc(monto)}</td></tr>` : ''}
<tr><td style="padding:8px 12px;color:#666;border-top:1px solid #f0f0f0;">Tarjeta</td><td style="padding:8px 12px;text-align:right;font-weight:600;color:#111;border-top:1px solid #f0f0f0;">${esc(tarjeta)}</td></tr>
</table>
<p style="margin:0 0 16px;">La devolución ya está hecha de nuestro lado. Puede tardar <b>algunos días hábiles</b> en verse en tu cuenta o resumen, según tu banco o emisor de la tarjeta.</p>
<p style="margin:0;">¿Tenés alguna duda? Escribinos por WhatsApp al <a href="https://wa.me/${WHATSAPP_LINK}?text=Consulta%20reembolso%20pedido%20%23${orderId}" style="color:#0a7a4a;">${WHATSAPP_LABEL}</a> o respondé este mail.</p>
</td></tr>
<tr><td style="padding:16px 32px;background:#f4f4f5;color:#666;font-size:12px;text-align:center;">RF Store — RUT 220006580014</td></tr>
</table></td></tr></table></body></html>`;
		const text = [
			`${nombre ? `Hola ${nombre}, ` : ''}te devolvimos el pago.`,
			'',
			`Cancelamos tu pedido #${orderId} y reembolsamos el pago${monto ? ` (${monto})` : ''} a ${tarjeta}.`,
			'Puede tardar algunos días hábiles en verse en tu cuenta, según tu banco.',
			'',
			`Dudas: WhatsApp ${WHATSAPP_LABEL} o respondé este mail.`,
		].join('\n');
		const r = await fetch('https://api.resend.com/emails', {
			method: 'POST',
			headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ from: `RF Store <${FROM_EMAIL}>`, to: [c.email], subject, html, text }),
		});
		if (!r.ok) return { sent: false, error: `Resend ${r.status}: ${(await r.text()).slice(0, 200)}` };
		return { sent: true, to: c.email };
	} catch (e) {
		return { sent: false, error: e instanceof Error ? e.message : String(e) };
	}
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async req => {
	if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
	try {
		const asUser = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
			global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
			auth: { persistSession: false },
		});
		const { data: u } = await asUser.auth.getUser();
		if (!u?.user) return json({ error: 'no autenticado' }, 401);
		const { data: role } = await admin.from('user_roles').select('role').eq('user_id', u.user.id).eq('role', 'admin').maybeSingle();
		if (!role) return json({ error: 'Sólo administradores' }, 403);

		const body = await req.json().catch(() => ({}));
		const orderId = Number(body?.order_id) || 0;
		if (!orderId) return json({ error: 'Falta el pedido' }, 400);

		const { data: order } = await admin.from('orders').select('id, payment_method, payment_status').eq('id', orderId).maybeSingle();
		if (!order || order.payment_method !== 'placetopay') return json({ error: 'El pedido no es de pago con tarjeta' }, 400);

		// Reenviar sólo el aviso de un reembolso que ya se hizo.
		if (body?.resend_notice === true) {
			if (order.payment_status !== 'refunded') return json({ error: 'El pedido no figura reembolsado' }, 409);
			const mail = await sendRefundMail(orderId);
			return mail.sent ? json({ ok: true, mail }) : json({ error: `No se pudo mandar el mail: ${mail.error}` }, 502);
		}
		if (order.payment_status !== 'paid') return json({ error: 'El pedido no figura pago' }, 409);

		const { data: s } = await admin
			.from('placetopay_sessions')
			.select('id, internal_reference, refunded, status')
			.eq('order_id', orderId)
			.eq('status', 'APPROVED')
			.order('created_at', { ascending: false })
			.limit(1)
			.maybeSingle();
		if (!s?.internal_reference) return json({ error: 'No se encontró la transacción aprobada' }, 404);
		if (s.refunded) return json({ error: 'Ya fue reembolsado' }, 409);

		let res: any;
		try {
			res = await ptpReverse(Number(s.internal_reference));
		} catch (e) {
			const msg = e instanceof PtpError ? (e.body?.status?.message ?? e.message) : (e instanceof Error ? e.message : String(e));
			await admin.from('placetopay_sessions').update({ refund_status: 'FAILED', refund_message: String(msg).slice(0, 255), updated_at: new Date().toISOString() }).eq('id', s.id);
			return json({ error: `Getnet no hizo el reembolso: ${msg}` }, 502);
		}

		const st = String(res?.status?.status ?? '');
		const msg = res?.status?.message ?? null;
		const ok = st === 'APPROVED';
		await admin.from('placetopay_sessions').update({
			refunded: ok,
			refund_status: st || 'UNKNOWN',
			refund_message: msg,
			refunded_at: ok ? new Date().toISOString() : null,
			updated_at: new Date().toISOString(),
		}).eq('id', s.id);
		if (!ok) return json({ error: `Getnet respondió ${st || 'sin estado'}: ${msg ?? ''}` }, 502);

		await admin.from('orders').update({ payment_status: 'refunded' }).eq('id', orderId);
		const mail = await sendRefundMail(orderId);
		if (!mail.sent) console.warn(`[placetopay-refund] orden ${orderId}: mail de reembolso no salió: ${mail.error}`);
		return json({ ok: true, message: msg, mail });
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : String(e) }, 500);
	}
});
