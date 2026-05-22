// Edge Function: mp-create-preference
// Crea una orden en estado 'pending' y una preferencia de MercadoPago.
// Body esperado:
// {
//   items: [{ external_code, variant_id, quantity, title, unit_price_usd }],
//   address: { line1, line2, city, state, postal_code, country },
//   customer_email?, customer_name?
// }
// IMPORTANTE: solo acepta items con external_code (productos CDR).

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';
import { fetchGetStock } from '../_shared/cdr-soap.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CDR_EMAIL = Deno.env.get('CDR_EMAIL')!;
const CDR_TOKEN = Deno.env.get('CDR_TOKEN')!;
const MP_ACCESS_TOKEN = Deno.env.get('MP_ACCESS_TOKEN')!;
const SITE_URL = Deno.env.get('SITE_URL') ?? 'http://localhost:5173';

interface CartItem {
	external_code: string;
	variant_id: string;
	quantity: number;
	title: string;
	unit_price_usd: number;
}

interface ReqBody {
	items: CartItem[];
	address: {
		line1: string;
		line2?: string;
		city: string;
		state: string;
		postal_code: string;
		country: string;
	};
	customer_email?: string;
	customer_name?: string;
}

Deno.serve(async req => {
	if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

	// Cliente con auth del usuario (para getUser)
	const authHeader = req.headers.get('Authorization') ?? '';
	const supabaseUser = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
		global: { headers: { Authorization: authHeader } },
		auth: { persistSession: false, autoRefreshToken: false },
	});

	const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE, {
		auth: { persistSession: false, autoRefreshToken: false },
	});

	try {
		const body: ReqBody = await req.json();

		if (!body.items?.length) {
			return new Response(JSON.stringify({ error: 'items vacío' }), {
				status: 400,
				headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			});
		}

		// 1. Validar que todos los items son CDR (tienen external_code)
		for (const it of body.items) {
			if (!it.external_code) {
				return new Response(
					JSON.stringify({
						error: `El item "${it.title}" no es vendible online (sin external_code)`,
					}),
					{ status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
				);
			}
		}

		// 2. Validar stock en tiempo real contra CDR
		const codes = body.items.map(i => i.external_code);
		const qtyMap: Record<string, number> = {};
		for (const it of body.items) {
			qtyMap[it.external_code] = (qtyMap[it.external_code] ?? 0) + it.quantity;
		}
		const stocks = await fetchGetStock(CDR_EMAIL, CDR_TOKEN, codes);
		const insufficient: string[] = [];
		for (const s of stocks) {
			const needed = qtyMap[s.codigo] ?? 0;
			if (s.stock === -999 || s.stock < needed) insufficient.push(s.codigo);
		}
		if (insufficient.length > 0) {
			return new Response(
				JSON.stringify({ error: 'stock_insuficiente', codes: insufficient }),
				{ status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
			);
		}

		// 3. Obtener customer del usuario logueado
		const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
		if (userErr || !userData.user) {
			return new Response(JSON.stringify({ error: 'no autenticado' }), {
				status: 401,
				headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			});
		}
		const { data: customer } = await supabaseAdmin
			.from('customers')
			.select('id, full_name, email')
			.eq('user_id', userData.user.id)
			.single();
		if (!customer) {
			return new Response(JSON.stringify({ error: 'cliente no encontrado' }), {
				status: 400,
				headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			});
		}

		// 4. Obtener márgen global y calcular precios finales
		const { data: markupRow } = await supabaseAdmin
			.from('app_settings')
			.select('value')
			.eq('key', 'cdr_markup_percent_global')
			.single();
		const markup = Number(markupRow?.value ?? 0);
		const factor = 1 + markup / 100;

		// Margen por producto opcional
		const { data: productsMeta } = await supabaseAdmin
			.from('products')
			.select('external_code, markup_percent')
			.in('external_code', codes);
		const perProductMarkup = new Map(
			(productsMeta ?? []).map(p => [p.external_code, p.markup_percent])
		);

		const lineTotals = body.items.map(it => {
			const own = perProductMarkup.get(it.external_code);
			const f = own != null ? 1 + Number(own) / 100 : factor;
			const unitFinal = Number((it.unit_price_usd * f).toFixed(2));
			return { ...it, unit_final_usd: unitFinal, line_total: unitFinal * it.quantity };
		});
		const totalAmount = lineTotals.reduce((acc, l) => acc + l.line_total, 0);

		// 5. Guardar dirección
		const { data: addressRow, error: addrErr } = await supabaseAdmin
			.from('addresses')
			.insert({
				address_line1: body.address.line1,
				address_line2: body.address.line2 ?? null,
				city: body.address.city,
				state: body.address.state,
				postal_code: body.address.postal_code,
				country: body.address.country,
				customer_id: customer.id,
			})
			.select()
			.single();
		if (addrErr) throw new Error(`addresses: ${addrErr.message}`);

		// 6. Crear orden en estado pending
		const { data: orderRow, error: orderErr } = await supabaseAdmin
			.from('orders')
			.insert({
				customer_id: customer.id,
				address_id: addressRow.id,
				total_amount: totalAmount,
				status: 'pago_pendiente',
				payment_method: 'mercadopago',
				payment_status: 'pending',
			})
			.select()
			.single();
		if (orderErr) throw new Error(`orders: ${orderErr.message}`);

		// 7. Crear order_items
		const { error: itemsErr } = await supabaseAdmin.from('order_items').insert(
			lineTotals.map(l => ({
				order_id: orderRow.id,
				variant_id: l.variant_id,
				price: l.unit_final_usd,
				quantity: l.quantity,
			}))
		);
		if (itemsErr) throw new Error(`order_items: ${itemsErr.message}`);

		// 8. Crear preference en MercadoPago
		const preferenceBody = {
			items: lineTotals.map(l => ({
				title: l.title,
				quantity: l.quantity,
				currency_id: 'USD',
				unit_price: l.unit_final_usd,
			})),
			payer: {
				email: body.customer_email ?? customer.email ?? userData.user.email,
				name: body.customer_name ?? customer.full_name ?? undefined,
			},
			back_urls: {
				success: `${SITE_URL}/checkout/${orderRow.id}/thank-you?status=success`,
				failure: `${SITE_URL}/checkout/${orderRow.id}/thank-you?status=failure`,
				pending: `${SITE_URL}/checkout/${orderRow.id}/thank-you?status=pending`,
			},
			auto_return: 'approved',
			external_reference: String(orderRow.id),
			notification_url: `${SUPABASE_URL}/functions/v1/mp-webhook`,
			statement_descriptor: 'RFSTORE',
		};

		const mpResp = await fetch('https://api.mercadopago.com/checkout/preferences', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(preferenceBody),
		});

		if (!mpResp.ok) {
			const errText = await mpResp.text();
			// rollback orden
			await supabaseAdmin.from('orders').delete().eq('id', orderRow.id);
			throw new Error(`MP API ${mpResp.status}: ${errText.slice(0, 500)}`);
		}

		const mpPref = await mpResp.json();

		await supabaseAdmin
			.from('orders')
			.update({ mp_preference_id: mpPref.id })
			.eq('id', orderRow.id);

		return new Response(
			JSON.stringify({
				order_id: orderRow.id,
				preference_id: mpPref.id,
				init_point: mpPref.init_point,
				sandbox_init_point: mpPref.sandbox_init_point,
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
