// deno-lint-ignore-file no-explicit-any
// send-order-cancelled v1 (2026-10-29)
//
// Mail al cliente: "cancelamos tu pedido". Lo dispara el panel cuando un admin
// cancela un pedido (cambio de estado a Cancelado, o "no pagó" en una
// transferencia/depósito). Body: { order_id }. Sólo admins o service_role.
//
// NO se manda (y se devuelve skipped con el motivo):
//  - si el pedido no está cancelado;
//  - si ya se le avisó (orders.cancel_notified_at);
//  - ventas de Mercado Libre (ML avisa) y ventas manuales;
//  - checkouts de MercadoPago/Getnet que nunca se pagaron (no eran pedidos: la
//    persona llegó a la pasarela y se fue);
//  - pagos con tarjeta Getnet ya reembolsados (les llegó el mail de reembolso).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'ventas@send.rfstore.uy';
const WHATSAPP_LABEL = '098 732 327';
const WHATSAPP_LINK = '59898732327';
const CANCEL_STATES = ['cancelado', 'rechazado', 'expirado', 'cancelled'];

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string) => String(s).replace(/[&<>"']/g, c => ESC[c]);

function jwtRole(authHeader: string): string | null {
	try {
		const t = authHeader.replace(/^Bearer\s+/i, '').split('.');
		if (t.length !== 3) return null;
		const p = JSON.parse(atob(t[1].replace(/-/g, '+').replace(/_/g, '/')));
		return typeof p.role === 'string' ? p.role : null;
	} catch {
		return null;
	}
}

async function isAllowed(req: Request): Promise<boolean> {
	const auth = req.headers.get('Authorization') ?? '';
	if (jwtRole(auth) === 'service_role') return true;
	const asUser = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
		global: { headers: { Authorization: auth } },
		auth: { persistSession: false },
	});
	const { data: u } = await asUser.auth.getUser();
	if (!u?.user) return false;
	const { data: role } = await admin.from('user_roles').select('role').eq('user_id', u.user.id).eq('role', 'admin').maybeSingle();
	return !!role;
}

Deno.serve(async req => {
	if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
	try {
		if (!(await isAllowed(req))) return json({ error: 'Sólo administradores' }, 403);
		const body = await req.json().catch(() => ({}));
		const orderId = Number(body?.order_id) || 0;
		if (!orderId) return json({ error: 'Falta el pedido' }, 400);

		const { data: o } = await admin
			.from('orders')
			.select('id, status, channel, payment_method, payment_status, paid_mp_usd, paid_transfer_usd, cancel_notified_at, customers(full_name, email)')
			.eq('id', orderId)
			.maybeSingle();
		if (!o) return json({ error: 'Pedido no encontrado' }, 404);

		const skip = (reason: string) => json({ ok: true, sent: false, skipped: reason });
		if (!CANCEL_STATES.includes(String(o.status ?? '').toLowerCase())) return skip('el pedido no está cancelado');
		if (o.cancel_notified_at) return skip('ya se le había avisado');
		const channel = String(o.channel ?? 'web');
		if (channel === 'ml') return skip('venta de Mercado Libre (avisa ML)');
		if (channel === 'manual') return skip('venta manual');

		const method = String(o.payment_method ?? '');
		const pstatus = String(o.payment_status ?? '');
		const cobradoHibrido = (Number(o.paid_mp_usd) || 0) + (Number(o.paid_transfer_usd) || 0) > 0;
		const paid = pstatus === 'paid' || (method === 'hybrid' && cobradoHibrido);
		const refunded = pstatus === 'refunded';

		if ((method === 'mercadopago' || method === 'placetopay') && !paid && !refunded) {
			return skip('checkout que nunca se pagó');
		}
		if (method === 'placetopay' && refunded) return skip('ya recibió el mail de reembolso');

		const c: any = Array.isArray(o.customers) ? o.customers[0] : o.customers;
		const email = String(c?.email ?? '').trim();
		if (!email) return skip('el cliente no tiene mail');
		if (!RESEND_API_KEY) return json({ error: 'RESEND_API_KEY no configurado' }, 500);

		const nombre = String(c?.full_name ?? '').trim().split(/\s+/)[0] || '';
		const detalle = refunded
			? 'El dinero que pagaste ya te fue devuelto. Según tu banco o medio de pago, puede tardar algunos días hábiles en verse reflejado.'
			: paid
			? 'Como tu pedido ya estaba pago, nos vamos a comunicar con vos para coordinar la devolución del dinero.'
			: 'Si ya hiciste el pago, respondé este mail con el comprobante y lo revisamos enseguida.';

		const subject = `Tu pedido #${orderId} fue cancelado — RF Store`;
		const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:560px;">
<tr><td align="center" style="padding:24px 28px 6px;"><img src="https://www.rfstore.uy/img/img-docs/logoblancorf.jpg" width="46" height="46" alt="RF Store" style="display:block;border:0;"></td></tr>
<tr><td style="padding:12px 32px 28px;color:#333;line-height:1.6;font-size:15px;">
<p style="margin:0 0 12px;font-size:18px;font-weight:600;color:#111;">${nombre ? `Hola ${esc(nombre)}, ` : ''}cancelamos tu pedido #${orderId}</p>
<p style="margin:0 0 16px;">${esc(detalle)}</p>
<p style="margin:0;">¿Tenés alguna duda o fue un error? Escribinos por WhatsApp al <a href="https://wa.me/${WHATSAPP_LINK}?text=Consulta%20pedido%20cancelado%20%23${orderId}" style="color:#0a7a4a;">${WHATSAPP_LABEL}</a> o respondé este mail.</p>
</td></tr>
<tr><td style="padding:16px 32px;background:#f4f4f5;color:#666;font-size:12px;text-align:center;">RF Store — RUT 220006580014</td></tr>
</table></td></tr></table></body></html>`;
		const text = [
			`${nombre ? `Hola ${nombre}, ` : ''}cancelamos tu pedido #${orderId}.`,
			'',
			detalle,
			'',
			`Dudas: WhatsApp ${WHATSAPP_LABEL} o respondé este mail.`,
		].join('\n');

		// Se marca ANTES de mandar: dos clics seguidos no mandan dos mails.
		const { data: claimed } = await admin
			.from('orders')
			.update({ cancel_notified_at: new Date().toISOString() })
			.eq('id', orderId)
			.is('cancel_notified_at', null)
			.select('id')
			.maybeSingle();
		if (!claimed) return skip('ya se le había avisado');

		const r = await fetch('https://api.resend.com/emails', {
			method: 'POST',
			headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ from: `RF Store <${FROM_EMAIL}>`, to: [email], subject, html, text }),
		});
		if (!r.ok) {
			// No salió: se libera la marca para poder reintentar.
			await admin.from('orders').update({ cancel_notified_at: null }).eq('id', orderId);
			return json({ error: `No se pudo mandar el mail (Resend ${r.status})` }, 502);
		}
		return json({ ok: true, sent: true, to: email });
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : String(e) }, 500);
	}
});
