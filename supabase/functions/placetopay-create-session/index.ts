// deno-lint-ignore-file no-explicit-any
// placetopay-create-session v1 (2026-10-29)
//
// La orden YA existe: la creó el checkout con place_cdr_order
// (payment_method = 'placetopay'), que calculó precio, envío, cupón y factura
// en el servidor. Acá sólo se pide la sesión de pago a Placetopay por el total
// en PESOS congelado en la orden (total_original = total USD × dólar BROU, el
// mismo criterio que MercadoPago) y se devuelve el link para ir a pagar.
//
// Si Placetopay no crea la sesión, la orden se cancela (libera el cupón) y el
// cliente sigue en el checkout con su carrito.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';
import { ptpConfigured, ptpCreateSession, isoNoMs, PtpError, alertAdmin } from '../_shared/placetopay.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SITE_URL = (Deno.env.get('SITE_URL') ?? 'https://www.rfstore.uy').replace(/\/+$/, '');
// A dónde puede volver el cliente después de pagar. localhost sólo sirve para
// probar desde la compu del desarrollador (con el interruptor en 'admins').
const RETURN_ORIGINS = new Set([SITE_URL, 'https://rfstore.uy', 'https://www.rfstore.uy', 'http://localhost:5173']);
const SESSION_MINUTES = 60;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

/**
 * Descripción del pago = los productos ("Auriculares X + Cable Y"), hasta 250
 * caracteres; si no entran todos, "y N productos más". Sin productos, el pedido.
 */
function buildDescription(names: string[], orderId: number): string {
	if (names.length === 0) return `Pedido ${orderId} - RF Store`;
	const MAX = 250;
	let out = '';
	for (let i = 0; i < names.length; i++) {
		const rest = names.length - i - 1;
		const candidate = out ? `${out} + ${names[i]}` : names[i];
		const suffix = rest > 0 ? ` y ${rest} producto${rest === 1 ? '' : 's'} más` : '';
		if (candidate.length + suffix.length > MAX) {
			const left = names.length - i;
			if (!out) return `${names[0].slice(0, MAX - 30)}… y ${left - 1} más`.slice(0, MAX);
			return `${out} y ${left} producto${left === 1 ? '' : 's'} más`.slice(0, MAX);
		}
		out = candidate;
	}
	return out;
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async req => {
	if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
	if (req.method !== 'POST') return json({ error: 'método no permitido' }, 405);

	let orderId = 0;
	let sessionCreated = false;
	try {
		const body = await req.json().catch(() => ({}));
		orderId = Number(body?.order_id) || 0;
		if (!orderId) return json({ error: 'Falta el pedido' }, 400);

		// --- Quién llama ---
		const authHeader = req.headers.get('Authorization') ?? '';
		const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
		const { data: u } = await asUser.auth.getUser();
		if (!u?.user) return json({ error: 'Iniciá sesión para pagar' }, 401);

		const { data: modeRow } = await admin.from('app_settings').select('value').eq('key', 'placetopay_mode').maybeSingle();
		const mode = String(modeRow?.value ?? 'off');
		const { data: role } = await admin.from('user_roles').select('role').eq('user_id', u.user.id).eq('role', 'admin').maybeSingle();
		const isAdmin = !!role;
		const available = (mode === 'all' || (mode === 'admins' && isAdmin)) && ptpConfigured();

		// --- La orden: tiene que ser de este cliente, de Placetopay y estar sin pagar ---
		const { data: order } = await admin
			.from('orders')
			.select('id, status, payment_method, payment_status, total_amount, total_original, fx_rate, customer_id, customers(user_id, full_name, email, phone)')
			.eq('id', orderId)
			.maybeSingle();
		const cust: any = Array.isArray(order?.customers) ? order?.customers[0] : order?.customers;
		if (!order || cust?.user_id !== u.user.id) return json({ error: 'Pedido no encontrado' }, 404);
		if (order.payment_method !== 'placetopay') return json({ error: 'El pedido no es de pago con tarjeta' }, 400);
		if (order.payment_status === 'paid') return json({ error: 'El pedido ya está pago' }, 409);
		if (order.status !== 'pago_pendiente') return json({ error: 'El pedido ya no está pendiente de pago' }, 409);

		// Medio apagado o sin credenciales: la orden que se acaba de crear no se
		// puede cobrar; se cancela para no dejar un cupón trabado.
		if (!available) {
			if (!ptpConfigured()) console.error('[placetopay-create-session] faltan los secrets PTP_*');
			try { await admin.rpc('release_order_stock', { p_order_id: orderId, p_new_status: 'cancelado' }); } catch (_) { /* ya estaba cerrada */ }
			return json({ error: 'El pago con tarjeta no está disponible por el momento. Elegí otro medio de pago.' }, 503);
		}

		// Doble clic / volver atrás: si ya hay una sesión viva, se reusa.
		const { data: live } = await admin
			.from('placetopay_sessions')
			.select('process_url, expires_at')
			.eq('order_id', orderId)
			.eq('status', 'PENDING')
			.order('created_at', { ascending: false })
			.limit(1)
			.maybeSingle();
		if (live?.process_url && live.expires_at && new Date(live.expires_at).getTime() > Date.now() + 2 * 60_000) {
			return json({ order_id: orderId, process_url: live.process_url, reused: true });
		}
		if (live) return json({ error: 'Ya hay un pago en curso para este pedido. Esperá unos minutos o hacé un pedido nuevo.' }, 409);

		// --- Monto: pesos congelados en la orden (dólar BROU), igual que MercadoPago ---
		const totalUyu = Math.round(Number(order.total_original));
		if (!Number.isFinite(totalUyu) || totalUyu <= 0) {
			throw new Error('El pedido no tiene la cotización del dólar para cobrar en pesos');
		}

		const origin = String(body?.return_origin ?? '').replace(/\/+$/, '');
		const base = RETURN_ORIGINS.has(origin) ? origin : SITE_URL;
		const returnUrl = `${base}/checkout/${orderId}/thank-you?pago=tarjeta`;

		const fullName = String(cust?.full_name ?? '').trim();
		const [name, ...rest] = fullName.split(/\s+/);
		const buyer: Record<string, unknown> = {};
		if (name) buyer.name = name.slice(0, 60);
		if (rest.length) buyer.surname = rest.join(' ').slice(0, 60);
		// Sólo datos con formato válido: si Placetopay rechaza el comprador, no se
		// crea la sesión. (Igual se reintenta sin comprador más abajo.)
		const email = String(cust?.email ?? '').trim();
		if (email.length <= 80 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) buyer.email = email;
		const phone = String(cust?.phone ?? '').replace(/[^\d+]/g, '');
		if (phone.length >= 8 && phone.length <= 15) buyer.mobile = phone;

		const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || '127.0.0.1';
		const ua = (req.headers.get('user-agent') ?? 'RF Store').slice(0, 255);
		const expiresAt = new Date(Date.now() + SESSION_MINUTES * 60_000);

		// Lo que se compra, para que el cliente lo reconozca en la página de pago
		// (la API no admite imágenes: van los nombres).
		const { data: lines } = await admin
			.from('order_items')
			.select('quantity, price, variant_id, variants(products(name))')
			.eq('order_id', orderId);
		const fx = Number(order.fx_rate) || 0;
		const prods = (lines ?? []).map((l: any) => {
			const v = Array.isArray(l.variants) ? l.variants[0] : l.variants;
			const p = Array.isArray(v?.products) ? v.products[0] : v?.products;
			return {
				name: String(p?.name ?? 'Producto').replace(/\s+/g, ' ').trim(),
				qty: Number(l.quantity) || 1,
				priceUsd: Number(l.price) || 0,
				sku: String(l.variant_id ?? '').slice(0, 30),
			};
		});
		const description = buildDescription(prods.map(p => (p.qty > 1 ? `${p.name} (x${p.qty})` : p.name)), orderId);
		const items = fx > 0
			? prods.map(p => ({
				sku: p.sku || 'item',
				name: p.name.slice(0, 120),
				category: 'physical' as const,
				qty: p.qty,
				price: Math.round(p.priceUsd * fx * p.qty), // costo total del artículo, en pesos
			}))
			: undefined;

		const sessionInput = {
			reference: `RF-${orderId}`,
			description,
			currency: 'UYU',
			total: totalUyu,
			expiration: isoNoMs(expiresAt),
			returnUrl,
			ipAddress: ip,
			userAgent: ua,
			buyer: Object.keys(buyer).length ? buyer : undefined,
			items,
		};
		let session;
		try {
			session = await ptpCreateSession(sessionInput);
		} catch (e) {
			// Un dato del comprador o de la lista de productos que Placetopay no
			// acepte no puede impedir pagar: se reintenta una vez sólo con lo
			// indispensable. Errores de autenticación (401) no se reintentan.
			if ((!sessionInput.buyer && !sessionInput.items) || (e instanceof PtpError && e.httpStatus === 401)) throw e;
			console.warn(`[placetopay-create-session] orden ${orderId}: reintento sin buyer/items:`, e instanceof Error ? e.message : e);
			session = await ptpCreateSession({ ...sessionInput, buyer: undefined, items: undefined });
		}
		sessionCreated = true;

		const { error: insErr } = await admin.from('placetopay_sessions').insert({
			order_id: orderId,
			request_id: session.requestId,
			reference: `RF-${orderId}`,
			process_url: session.processUrl,
			currency: 'UYU',
			amount: totalUyu,
			expires_at: expiresAt.toISOString(),
			status: 'PENDING',
		});
		if (insErr) {
			// La sesión existe en Placetopay pero no la pudimos anotar: si el cliente
			// paga, el aviso no encontraría la orden. Se avisa con el número de sesión.
			await alertAdmin(
				`Pedido #${orderId}: sesión de Getnet sin registrar`,
				`Se creó la sesión ${session.requestId} por UYU ${totalUyu} pero no se pudo guardar (${insErr.message}). Si el cliente paga, hay que concretar el pedido a mano.`,
			);
			throw new Error(`placetopay_sessions: ${insErr.message}`);
		}

		return json({ order_id: orderId, process_url: session.processUrl });
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		console.error(`[placetopay-create-session] orden ${orderId}:`, msg, e instanceof PtpError ? JSON.stringify(e.body).slice(0, 800) : '');
		// Sin sesión no hay cobro posible: se cae la orden (y devuelve el cupón).
		// Si la sesión SÍ se creó (falló sólo el registro), la orden queda viva para
		// no perder un pago: la revisión de pendientes no la ve, así que se avisa.
		if (orderId && !sessionCreated) {
			try { await admin.rpc('release_order_stock', { p_order_id: orderId, p_new_status: 'cancelado' }); } catch (_) { /* ya estaba cerrada */ }
		}
		return json({ error: 'No pudimos iniciar el pago con tarjeta. Probá de nuevo o elegí otro medio de pago.', detail: msg }, 502);
	}
});
