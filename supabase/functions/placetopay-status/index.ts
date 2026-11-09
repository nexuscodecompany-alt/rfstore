// deno-lint-ignore-file no-explicit-any
// placetopay-status v1 (2026-10-29)
//
// La página de gracias pregunta cómo quedó el pago con tarjeta. Si la sesión
// todavía figura pendiente en nuestra tabla, se consulta a Placetopay en el
// momento (así el cliente ve el resultado aunque el aviso no haya llegado).
// Sólo el dueño del pedido o un admin.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';
import { syncSession } from '../_shared/placetopay.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
	auth: { persistSession: false, autoRefreshToken: false },
});

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// No consultar a Placetopay más de una vez cada tantos segundos por sesión
// (la página consulta seguido mientras espera).
const MIN_RECHECK_MS = 8_000;

Deno.serve(async req => {
	if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
	try {
		const body = await req.json().catch(() => ({}));
		const orderId = Number(body?.order_id) || 0;
		if (!orderId) return json({ error: 'Falta el pedido' }, 400);

		const asUser = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
			global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
			auth: { persistSession: false },
		});
		const { data: u } = await asUser.auth.getUser();
		if (!u?.user) return json({ error: 'no autenticado' }, 401);

		const { data: order } = await admin
			.from('orders')
			.select('id, status, payment_method, payment_status, customers(user_id)')
			.eq('id', orderId)
			.maybeSingle();
		const cust: any = Array.isArray(order?.customers) ? order?.customers[0] : order?.customers;
		let allowed = !!order && cust?.user_id === u.user.id;
		if (order && !allowed) {
			const { data: role } = await admin.from('user_roles').select('role').eq('user_id', u.user.id).eq('role', 'admin').maybeSingle();
			allowed = !!role;
		}
		if (!order || !allowed) return json({ error: 'Pedido no encontrado' }, 404);
		if (order.payment_method !== 'placetopay') return json({ error: 'El pedido no es de pago con tarjeta' }, 400);

		const { data: s } = await admin
			.from('placetopay_sessions')
			.select('request_id, status, message, last_checked_at')
			.eq('order_id', orderId)
			.order('created_at', { ascending: false })
			.limit(1)
			.maybeSingle();

		if (s && s.status === 'PENDING' && order.payment_status !== 'paid') {
			const last = s.last_checked_at ? new Date(s.last_checked_at).getTime() : 0;
			if (Date.now() - last > MIN_RECHECK_MS) {
				try { await syncSession(admin, Number(s.request_id)); }
				catch (e) { console.warn(`[placetopay-status] orden ${orderId}:`, e instanceof Error ? e.message : e); }
			}
		}

		const { data: o2 } = await admin.from('orders').select('status, payment_status').eq('id', orderId).single();
		const { data: s2 } = await admin
			.from('placetopay_sessions')
			.select('status, message, payment_method_name, last_digits, process_url, expires_at')
			.eq('order_id', orderId)
			.order('created_at', { ascending: false })
			.limit(1)
			.maybeSingle();

		// Resultado para la pantalla: paid | rejected | pending
		const result = o2?.payment_status === 'paid'
			? 'paid'
			: (o2?.payment_status === 'rejected' || ['rechazado', 'expirado', 'cancelado'].includes(String(o2?.status)) || (s2 && ['REJECTED', 'PARTIAL_EXPIRED'].includes(s2.status)))
			? 'rejected'
			: 'pending';

		return json({
			result,
			order_status: o2?.status ?? null,
			session_status: s2?.status ?? null,
			message: s2?.message ?? null,
			card: s2?.payment_method_name ? `${s2.payment_method_name}${s2.last_digits ? ` terminada en ${s2.last_digits}` : ''}` : null,
			// Si sigue pendiente y no venció, se puede volver a la página de pago.
			process_url: result === 'pending' && s2?.process_url && s2.expires_at && new Date(s2.expires_at).getTime() > Date.now() ? s2.process_url : null,
		});
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : String(e) }, 500);
	}
});
