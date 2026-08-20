// deno-lint-ignore-file no-explicit-any
// mp-create-preference v24 (2026-08-11)
//  - Envio gratis SOLO en Montevideo (>= USD 150). La zona metropolitana llega
//    por agencia y se cobra siempre; el interior va por DAC y lo abona el
//    cliente al retirar (nunca entra en el total).
//  - order_items ahora guarda cost_usd: TODAS las ventas web por Mercado Pago
//    figuraban con ganancia CERO en el panel porque el costo quedaba null.
//  - La cotizacion usada queda CONGELADA en la orden (fx_rate/fx_source/
//    total_original) para que los mails no la vuelvan a pedir.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CDR_EMAIL = Deno.env.get('CDR_EMAIL')!;
const CDR_TOKEN = Deno.env.get('CDR_TOKEN')!;
const MP_ACCESS_TOKEN = Deno.env.get('MP_ACCESS_TOKEN')!;
const SITE_URL = Deno.env.get('SITE_URL') ?? 'http://localhost:5173';

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const SOAP_STOCKS_URL = 'https://www.cdrmedios.com/ws/productos/service.php?class=SublimewsProductosStocks';
function escapeXml(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }
function buildEnvelope(method: string, params: Record<string, string | string[]>): string {
	const args = Object.entries(params).map(([k, v]) => {
		if (Array.isArray(v)) { const items = v.map(it => `<item xsi:type="xsd:string">${escapeXml(it)}</item>`).join(''); return `<${k} xsi:type="SOAP-ENC:Array" SOAP-ENC:arrayType="xsd:string[${v.length}]">${items}</${k}>`; }
		return `<${k} xsi:type="xsd:string">${escapeXml(v)}</${k}>`;
	}).join('');
	return `<?xml version="1.0" encoding="UTF-8"?>\n<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/"><SOAP-ENV:Body><${method}>${args}</${method}></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
}
async function fetchGetStock(email: string, token: string, codigos: string[]): Promise<{ codigo: string; stock: number }[]> {
	const envelope = buildEnvelope('get_stock', { email, token, productos: codigos, formato: 'json' });
	const resp = await fetch(SOAP_STOCKS_URL, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '"get_stock"' }, body: envelope });
	if (!resp.ok) throw new Error(`SOAP ${resp.status}`);
	const xml = await resp.text();
	const match = xml.match(/<(?:[a-zA-Z0-9_:]+:)?(?:[a-zA-Z0-9_]*[Rr]eturn|return)\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_:]+:)?(?:[a-zA-Z0-9_]*[Rr]eturn|return)>/);
	if (!match) throw new Error('no_return_tag');
	const decoded = match[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
	const parsed = JSON.parse(decoded);
	if (!Array.isArray(parsed)) throw new Error('not_array');
	return parsed.map((it: any) => ({ codigo: String(it.codigo), stock: typeof it.stock === 'number' ? it.stock : Number(it.stock) }));
}

// external_code sólo lo tienen los productos CDR. Los manuales (source=local)
// habilitados con products.online_payment lo mandan null/ausente.
// is_extra / extra_source: marca de "entró como extra del checkout". Es SÓLO
// atribución para medir el módulo — el precio y el total se recalculan acá igual,
// así que un cliente que los falsifique no cambia un peso de lo que paga.
interface CartItem { external_code?: string | null; variant_id: string; quantity: number; title: string; unit_price_usd: number; is_extra?: boolean; extra_source?: 'product' | 'category' | null; }
// Datos fiscales para factura con RUT (opcional).
interface InvoiceData {
	requested?: boolean;
	rut?: string;
	business_name?: string;
	trade_name?: string | null;
	address?: string;
	city?: string | null;
	state?: string | null;
	email?: string | null;
}
interface ReqBody {
	items: CartItem[];
	address: { line1: string; line2?: string; city: string; state: string; postal_code: string; country: string; };
	customer_email?: string;
	customer_name?: string;
	shipping_zone?: 'montevideo' | 'metropolitana' | 'interior';
	shipping_barrio?: string;
	shipping_department?: string;
	shipping_cost_usd?: number;
	coupon_code?: string;
	invoice?: InvoiceData | null;
	// --- Modo pago combinado ---
	// La orden ya existe (la creó place_cdr_order con su stock reservado): acá
	// sólo se pide el link de pago por la parte que va con tarjeta.
	existing_order_id?: number;
	amount_usd?: number;
}
const FREE_SHIPPING_MIN_USD = 150;

Deno.serve(async req => {
	if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
	const authHeader = req.headers.get('Authorization') ?? '';
	const supabaseUser = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } });
	const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
	try {
		const body: ReqBody = await req.json();

		// ============ MODO PAGO COMBINADO ============
		// La orden ya existe y el stock ya está reservado. Sólo hay que cobrar la
		// parte de MercadoPago. NO se recalcula el carrito ni se toca el stock: eso
		// ya lo hizo place_cdr_order.
		if (body.existing_order_id) {
			const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
			if (userErr || !userData.user) return new Response(JSON.stringify({ error: 'no autenticado' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
			const { data: customer } = await supabaseAdmin.from('customers').select('id, full_name, email').eq('user_id', userData.user.id).single();
			if (!customer) return new Response(JSON.stringify({ error: 'cliente no encontrado' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

			const { data: order } = await supabaseAdmin
				.from('orders')
				.select('id, customer_id, payment_method, payment_status, payment_split, total_amount, fx_rate, mp_preference_id')
				.eq('id', body.existing_order_id)
				.single();
			if (!order) return new Response(JSON.stringify({ error: 'orden no encontrada' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
			// La orden tiene que ser DE ESTE cliente: si no, cualquiera podría pedir
			// un link de pago de un pedido ajeno.
			if (order.customer_id !== customer.id) return new Response(JSON.stringify({ error: 'no autorizado' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
			if (order.payment_method !== 'hybrid') return new Response(JSON.stringify({ error: 'la orden no es de pago combinado' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
			if (order.payment_status === 'paid') return new Response(JSON.stringify({ error: 'la orden ya está paga' }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

			// El monto NO se toma del cliente: sale del desglose guardado en la orden.
			const montoMp = Number((order.payment_split as any)?.mercadopago) || 0;
			if (montoMp <= 0) return new Response(JSON.stringify({ error: 'la orden no tiene monto de MercadoPago' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

			// Se usa la cotización CONGELADA en la orden: es la que vio el cliente al
			// confirmar. Si acá tomáramos la del día, el monto no coincidiría.
			const fxOrden = Number(order.fx_rate) || 0;
			const enUyu = fxOrden > 0;
			const moneda = enUyu ? 'UYU' : 'USD';
			const importe = enUyu ? Math.round(montoMp * fxOrden) : Number(montoMp.toFixed(2));

			const prefBody = {
				items: [{ title: `Pedido #${order.id} — parte con MercadoPago`, quantity: 1, currency_id: moneda, unit_price: Math.max(enUyu ? 1 : 0.01, importe) }],
				payer: { email: customer.email ?? userData.user.email, name: customer.full_name ?? undefined },
				back_urls: {
					success: `${SITE_URL}/checkout/${order.id}/thank-you?status=success`,
					failure: `${SITE_URL}/checkout/${order.id}/thank-you?status=failure`,
					pending: `${SITE_URL}/checkout/${order.id}/thank-you?status=pending`,
				},
				auto_return: 'approved',
				external_reference: String(order.id),
				notification_url: `${SUPABASE_URL}/functions/v1/mp-webhook`,
				statement_descriptor: 'RFSTORE',
			};
			const prefResp = await fetch('https://api.mercadopago.com/checkout/preferences', { method: 'POST', headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(prefBody) });
			if (!prefResp.ok) {
				const errText = await prefResp.text();
				// NO se cancela la orden: el stock sigue reservado y el admin puede
				// reintentar el cobro. Cancelarla acá perdería la venta entera por un
				// error de la pasarela.
				throw new Error(`MP API ${prefResp.status}: ${errText.slice(0, 500)}`);
			}
			const pref = await prefResp.json();
			await supabaseAdmin.from('orders').update({ mp_preference_id: pref.id }).eq('id', order.id);
			return new Response(JSON.stringify({ order_id: order.id, preference_id: pref.id, init_point: pref.init_point, sandbox_init_point: pref.sandbox_init_point, total_usd: montoMp, total_uyu: enUyu ? importe : 0, fx_rate: fxOrden, fx_source: 'orden' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
		}

		if (!body.items?.length) return new Response(JSON.stringify({ error: 'items vacío' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

		// Origen/precio/stock de cada item resueltos desde la DB por variant_id.
		// NUNCA confiamos en lo que manda el cliente: ni el external_code ni el
		// precio ni la condición de "vendible online".
		//   source = 'cdr'                         -> se vende online siempre (stock real vía SOAP)
		//   source = 'local' + online_payment=true -> se vende online (stock de variants)
		//   resto                                  -> sólo consulta, se rechaza acá
		const variantIds = [...new Set(body.items.map(i => i.variant_id))];
		const { data: variantRows, error: varErr } = await supabaseAdmin
			.from('variants')
			.select('id, price, stock, products(name, source, online_payment, external_code, price_usd, margin_override_percent)')
			.in('id', variantIds);
		if (varErr) throw new Error(`variants: ${varErr.message}`);
		interface VarInfo { price: number; stock: number; source: string; onlinePayment: boolean; externalCode: string | null; costUsd: number | null; marginOverride: number | null; }
		const infoByVariant = new Map<string, VarInfo>();
		for (const row of (variantRows ?? []) as any[]) {
			const p = Array.isArray(row.products) ? row.products[0] : row.products;
			const rawOverride = p?.margin_override_percent;
			infoByVariant.set(String(row.id), {
				price: Number(row.price) || 0,
				stock: Number(row.stock) || 0,
				source: String(p?.source ?? 'local'),
				onlinePayment: p?.online_payment === true,
				externalCode: p?.external_code ?? null,
				costUsd: p?.price_usd === null || p?.price_usd === undefined ? null : Number(p.price_usd),
				// Margen manual del producto: si el admin le puso precio a mano, el
				// precio canonico sale de ESE margen (igual que la web), no del tramo.
				marginOverride:
					rawOverride === null || rawOverride === undefined || isNaN(Number(rawOverride))
						? null
						: Number(rawOverride),
			});
		}
		for (const it of body.items) {
			const info = infoByVariant.get(it.variant_id);
			if (!info) return new Response(JSON.stringify({ error: `El item "${it.title}" ya no está disponible` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
			const buyable = info.source === 'cdr' || info.onlinePayment;
			if (!buyable) return new Response(JSON.stringify({ error: `El item "${it.title}" es solo por consulta` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
			if (info.source === 'cdr' && !info.externalCode) return new Response(JSON.stringify({ error: `El item "${it.title}" no es vendible online (sin external_code)` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
		}

		// --- Stock CDR (SOAP + fallback a la DB, igual que siempre) ---
		const cdrItems = body.items.filter(i => infoByVariant.get(i.variant_id)!.source === 'cdr');
		const codes = cdrItems.map(i => infoByVariant.get(i.variant_id)!.externalCode!);
		const qtyMap: Record<string, number> = {};
		for (const it of cdrItems) { const code = infoByVariant.get(it.variant_id)!.externalCode!; qtyMap[code] = (qtyMap[code] ?? 0) + it.quantity; }
		const soapMap = new Map<string, number>();
		if (codes.length > 0) {
			try { const soapStocks = await fetchGetStock(CDR_EMAIL, CDR_TOKEN, codes); for (const s of soapStocks) { if (s.stock === -999) continue; soapMap.set(s.codigo, s.stock); } } catch (e) { console.warn('SOAP stock failed:', e); }
		}
		const missingFromSoap = codes.filter(c => !soapMap.has(c));
		const dbStockMap = new Map<string, number>();
		if (missingFromSoap.length > 0) {
			const { data: prods } = await supabaseAdmin.from('products').select('external_code, variants(stock)').in('external_code', missingFromSoap);
			for (const p of prods ?? []) { const pr = p as unknown as { external_code: string; variants: { stock: number }[] }; const total = (pr.variants ?? []).reduce((acc, v) => acc + (Number(v.stock) || 0), 0); dbStockMap.set(pr.external_code, total); }
		}
		const insufficient: string[] = [];
		for (const code of new Set(codes)) { const stock = soapMap.get(code) ?? dbStockMap.get(code) ?? -1; const needed = qtyMap[code] ?? 0; if (stock < needed) insufficient.push(code); }

		// --- Stock de los manuales: la única fuente es variants.stock ---
		const localQtyByVariant: Record<string, number> = {};
		for (const it of body.items) { if (infoByVariant.get(it.variant_id)!.source !== 'cdr') localQtyByVariant[it.variant_id] = (localQtyByVariant[it.variant_id] ?? 0) + it.quantity; }
		for (const [vid, needed] of Object.entries(localQtyByVariant)) {
			if (infoByVariant.get(vid)!.stock < needed) {
				const title = body.items.find(i => i.variant_id === vid)?.title ?? vid;
				insufficient.push(title);
			}
		}
		if (insufficient.length > 0) return new Response(JSON.stringify({ error: 'stock_insuficiente', codes: insufficient }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

		const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
		if (userErr || !userData.user) return new Response(JSON.stringify({ error: 'no autenticado' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
		const { data: customer } = await supabaseAdmin.from('customers').select('id, full_name, email').eq('user_id', userData.user.id).single();
		if (!customer) return new Response(JSON.stringify({ error: 'cliente no encontrado' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

		// Precio de venta CANONICO server-side: margen por tramo + IVA, identico al
		// storefront (SQL rf_sale_price). NO se aplica ningun markup extra ni se confia
		// en el precio enviado por el cliente. ANTES se multiplicaba por
		// cdr_markup_percent_global -> DOBLE MARKUP: el cliente veia 62 y se le cobraba 74.4.
		// El COSTO sale de products.price_usd en los CDR y de variants.price en los
		// manuales (que es donde el admin lo carga: "Precio (USD, costo sin IVA)").
		// La clave es (costo + margen manual): dos productos con el mismo costo pueden
		// tener precios distintos si uno tiene precio puesto a mano.
		const costByVariant = new Map<string, number>();
		const priceKeyByVariant = new Map<string, string>();
		for (const [vid, info] of infoByVariant) {
			const cost = Number(info.source === 'cdr' ? (info.costUsd ?? info.price) : info.price) || 0;
			costByVariant.set(vid, cost);
			priceKeyByVariant.set(vid, `${cost}|${info.marginOverride ?? ''}`);
		}
		const saleByKey = new Map<string, number>();
		for (const key of new Set(priceKeyByVariant.values())) {
			const [costStr, overrideStr] = key.split('|');
			const { data: sp } = await supabaseAdmin.rpc('rf_sale_price', {
				cost: Number(costStr),
				p_override: overrideStr === '' ? null : Number(overrideStr),
			});
			saleByKey.set(key, Number(sp) || 0);
		}
		const lineTotals = body.items.map(it => {
			const sp = saleByKey.get(priceKeyByVariant.get(it.variant_id) ?? '') ?? 0;
			const unitFinal = sp > 0 ? sp : Number(Number(it.unit_price_usd).toFixed(2));
			return { ...it, unit_final_usd: unitFinal, line_total: unitFinal * it.quantity };
		});
		const subtotal = lineTotals.reduce((acc, l) => acc + l.line_total, 0);

		const requestedShipping = Number(body.shipping_cost_usd ?? 0);
		const isMvd = body.shipping_zone === 'montevideo';
		const isMetro = body.shipping_zone === 'metropolitana';
		// Montevideo y zona metropolitana (agencia) cobran envío; interior = DAC (0).
		// Envío gratis SOLO en Montevideo a partir de FREE_SHIPPING_MIN_USD.
		// La zona metropolitana llega por agencia y se cobra siempre; el interior
		// va por DAC y lo abona el cliente al retirar (nunca entra en el total).
		const chargesShipping = isMvd || isMetro;
		const qualifiesFree = isMvd && subtotal >= FREE_SHIPPING_MIN_USD;
		const shippingBase = !chargesShipping || qualifiesFree ? 0 : Math.max(0, Number(requestedShipping.toFixed(2)));

		// Cupon (server-side, anti-manipulacion). El descuento se calcula contra el subtotal REAL cobrado.
		let couponDiscount = 0, couponFree = false, couponId: string | null = null, couponValid = false, couponCodeNorm: string | null = null;
		if (body.coupon_code && body.coupon_code.trim()) {
			const couponItems = lineTotals.map(l => ({ variant_id: l.variant_id, price: l.unit_final_usd, quantity: l.quantity }));
			// Este camino SIEMPRE es MercadoPago: se lo declaramos a apply_coupon.
			// Un cupón restringido a transferencia queda afuera acá, aunque alguien
			// llame esta función directamente con curl.
			const { data: cres } = await supabaseAdmin.rpc('apply_coupon', { p_code: body.coupon_code, p_items: couponItems, p_subtotal: subtotal, p_shipping: shippingBase, p_payment_method: 'mercadopago' });
			if (cres && (cres as any).valid) { couponValid = true; couponDiscount = Number((cres as any).discount_usd) || 0; couponFree = (cres as any).free_shipping === true; couponId = (cres as any).coupon_id; couponCodeNorm = (cres as any).code ?? null; }
			else if (cres && (cres as any).reason) {
				// No se ignora en silencio: si el cliente puso un cupón que no aplica,
				// tiene que enterarse ANTES de pagar y no cobrarle un total distinto.
				return new Response(JSON.stringify({ error: (cres as any).reason, code: 'coupon_invalid' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
			}
		}
		const shippingCharge = couponFree ? 0 : shippingBase;
		const discountedProducts = Math.max(0, Number((subtotal - couponDiscount).toFixed(2)));
		const priceFactor = subtotal > 0 ? discountedProducts / subtotal : 1;
		const totalAmount = Number((discountedProducts + shippingCharge).toFixed(2));

		// Cotizacion USD->UYU (BROU eBROU venta) cacheada: la MISMA que muestra el checkout. La
		// preference se crea en UYU para que el cobro coincida EXACTO con lo mostrado.
		// (Si se mandara en USD, MP convierte a su propia tasa y cobra de mas.)
		// Sin cache valida, cae a USD para no romper el checkout.
		const { data: fxRow } = await supabaseAdmin.from('app_settings').select('value').eq('key', 'usd_uyu_rate_cache').maybeSingle();
		const fxRate = Number((fxRow?.value as any)?.rate) || 0;
		const fxSource = String((fxRow?.value as any)?.source ?? '') || null;
		const useUyu = fxRate > 0;
		const curId = useUyu ? 'UYU' : 'USD';
		const toCharge = (usd: number) => (useUyu ? Math.round(usd * fxRate) : Number(usd.toFixed(2)));
		const minUnit = useUyu ? 1 : 0.01;

		const { data: addressRow, error: addrErr } = await supabaseAdmin.from('addresses').insert({ address_line1: body.address.line1, address_line2: body.address.line2 ?? null, city: body.address.city, state: body.address.state, postal_code: body.address.postal_code, country: body.address.country, customer_id: customer.id }).select().single();
		if (addrErr) throw new Error(`addresses: ${addrErr.message}`);

		// Factura con RUT (opcional). Se normaliza el RUT a sólo dígitos y se exige
		// lo mínimo que pide DGI; si falta algo, se corta acá con un mensaje claro
		// en vez de dejar que reviente el check de la base.
		const inv = body.invoice ?? null;
		const quiereFactura = inv?.requested === true;
		const rutDigits = quiereFactura ? String(inv?.rut ?? '').replace(/\D/g, '') : '';
		if (quiereFactura) {
			if (rutDigits.length !== 12) return new Response(JSON.stringify({ error: 'El RUT tiene que tener 12 dígitos' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
			if (!String(inv?.business_name ?? '').trim()) return new Response(JSON.stringify({ error: 'Falta la razón social para la factura' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
			if (!String(inv?.address ?? '').trim()) return new Response(JSON.stringify({ error: 'Falta el domicilio fiscal para la factura' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
		}

		const { data: orderRow, error: orderErr } = await supabaseAdmin.from('orders').insert({ customer_id: customer.id, address_id: addressRow.id, total_amount: totalAmount, status: 'pago_pendiente', payment_method: 'mercadopago', payment_status: 'pending', shipping_zone: body.shipping_zone ?? null, shipping_barrio: body.shipping_barrio ?? null, shipping_department: body.shipping_department ?? null, shipping_cost_usd: shippingCharge, coupon_id: couponId, coupon_code: couponCodeNorm, discount_usd: couponDiscount, fx_rate: useUyu ? fxRate : null, fx_source: useUyu ? fxSource : null, total_original: useUyu ? Math.round(totalAmount * fxRate) : null,
			invoice_requested: quiereFactura,
			invoice_rut: quiereFactura ? rutDigits : null,
			invoice_business_name: quiereFactura ? String(inv?.business_name ?? '').trim() : null,
			invoice_trade_name: quiereFactura ? (String(inv?.trade_name ?? '').trim() || null) : null,
			invoice_address: quiereFactura ? String(inv?.address ?? '').trim() : null,
			invoice_city: quiereFactura ? (String(inv?.city ?? '').trim() || null) : null,
			invoice_state: quiereFactura ? (String(inv?.state ?? '').trim() || null) : null,
			invoice_email: quiereFactura ? (String(inv?.email ?? '').trim() || body.customer_email || null) : null,
		}).select().single();
		if (orderErr) throw new Error(`orders: ${orderErr.message}`);

		// cost_usd: costo congelado al momento de la venta (CDR -> products.price_usd;
		// propio -> costo cargado en la variante). Sin esto la venta figuraba con
		// ganancia CERO en el panel: pasaba en TODAS las ventas web por Mercado Pago.
		// (La base igual lo completa por trigger, esto lo deja explícito acá.)
		const { error: itemsErr } = await supabaseAdmin.from('order_items').insert(lineTotals.map(l => ({ order_id: orderRow.id, variant_id: l.variant_id, price: l.unit_final_usd, quantity: l.quantity, cost_usd: costByVariant.get(l.variant_id) || null, is_extra: l.is_extra === true, extra_source: l.is_extra === true ? l.extra_source ?? null : null })));
		if (itemsErr) throw new Error(`order_items: ${itemsErr.message}`);

		for (const l of lineTotals) { const { data: v } = await supabaseAdmin.from('variants').select('stock').eq('id', l.variant_id).single(); if (!v) continue; await supabaseAdmin.from('variants').update({ stock: Math.max(0, Number(v.stock) - l.quantity) }).eq('id', l.variant_id); }

		const mpItems: Array<{ title: string; quantity: number; currency_id: string; unit_price: number }> = lineTotals.map(l => ({ title: l.title, quantity: l.quantity, currency_id: curId, unit_price: Math.max(minUnit, toCharge(l.unit_final_usd * priceFactor)) }));
		if (shippingCharge > 0) {
			const zoneLabel = isMvd
				? `Montevideo${body.shipping_barrio ? ` — ${body.shipping_barrio}` : ''}`
				: isMetro
				? `Zona metropolitana${body.shipping_barrio ? ` — ${body.shipping_barrio}` : ''}`
				: 'Envío';
			mpItems.push({ title: `Envío (${zoneLabel})`, quantity: 1, currency_id: curId, unit_price: Math.max(minUnit, toCharge(shippingCharge)) });
		}
		const preferenceBody = { items: mpItems, payer: { email: body.customer_email ?? customer.email ?? userData.user.email, name: body.customer_name ?? customer.full_name ?? undefined }, back_urls: { success: `${SITE_URL}/checkout/${orderRow.id}/thank-you?status=success`, failure: `${SITE_URL}/checkout/${orderRow.id}/thank-you?status=failure`, pending: `${SITE_URL}/checkout/${orderRow.id}/thank-you?status=pending` }, auto_return: 'approved', external_reference: String(orderRow.id), notification_url: `${SUPABASE_URL}/functions/v1/mp-webhook`, statement_descriptor: 'RFSTORE' };
		const mpResp = await fetch('https://api.mercadopago.com/checkout/preferences', { method: 'POST', headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(preferenceBody) });
		if (!mpResp.ok) {
			const errText = await mpResp.text();
			try { await supabaseAdmin.rpc('release_order_stock', { p_order_id: orderRow.id, p_new_status: 'cancelado' }); } catch (relErr) { console.warn('release_order_stock on rollback failed:', relErr); }
			await supabaseAdmin.from('orders').delete().eq('id', orderRow.id);
			throw new Error(`MP API ${mpResp.status}: ${errText.slice(0, 500)}`);
		}
		const mpPref = await mpResp.json();
		await supabaseAdmin.from('orders').update({ mp_preference_id: mpPref.id }).eq('id', orderRow.id);
		if (couponValid && couponId) { const { data: cc } = await supabaseAdmin.from('coupons').select('used_count').eq('id', couponId).single(); if (cc) await supabaseAdmin.from('coupons').update({ used_count: Number(cc.used_count) + 1 }).eq('id', couponId); }
		return new Response(JSON.stringify({ order_id: orderRow.id, preference_id: mpPref.id, init_point: mpPref.init_point, sandbox_init_point: mpPref.sandbox_init_point }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
	} catch (e) { const msg = e instanceof Error ? e.message : String(e); return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
});
