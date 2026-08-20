import { supabase } from '../supabase/client';

// ── Conceptos y ventas manuales ─────────────────────────────────────────────
// El admin registra ventas que hace por fuera (web/ML), agrupadas por "concepto"
// (ej: la empresa Sunfer). Guarda precio de venta, costo y costos extra (envío).
// Se almacenan como orders con channel='manual' y se centralizan con el resto.

export interface SaleConcept {
	id: string;
	name: string;
	color: string | null;
	created_at: string;
}

export interface ManualSaleItem {
	variantId: string;
	quantity: number;
	label: string; // "Producto · color/almacenamiento" para mostrar
}

/**
 * Por dónde cobra el cliente. Antes no se guardaba (quedaba null) y el panel
 * mostraba todas las ventas manuales como MercadoPago.
 *
 * Sólo MercadoPago y transferencia, o las dos combinadas — decisión del dueño.
 * `deposit` sigue en el tipo porque las órdenes de la WEB sí lo usan, pero no
 * se ofrece al cargar una venta manual.
 */
export type ManualPaymentMethod =
	| 'transfer'
	| 'deposit'
	| 'mercadopago'
	| 'hybrid';

export const manualPaymentMethodLabels: Record<ManualPaymentMethod, string> = {
	mercadopago: 'MercadoPago',
	transfer: 'Transferencia bancaria',
	hybrid: 'Combinado (MercadoPago + transferencia)',
	deposit: 'Depósito (Abitab / Redpagos)',
};

/** Los que se pueden elegir al cargar una venta manual. */
export const manualPaymentMethodOptions: ManualPaymentMethod[] = [
	'mercadopago',
	'transfer',
	'hybrid',
];

/** Reparto del pago combinado, en la moneda de la venta. */
export interface ManualPaymentSplit {
	mercadopago: number;
	transfer: number;
}

export interface ManualSale {
	id: number;
	created_at: string;
	status: string;
	conceptId: string | null;
	conceptName: string | null;
	conceptColor: string | null;
	description: string | null;
	currency: 'USD' | 'UYU';
	fxRate: number;
	// Montos en la moneda real de la venta (la que se eligió al registrarla).
	saleAmount: number;
	cost: number;
	commission: number;
	shipping: number;
	other: number;
	grossProfit: number; // venta - costo
	profit: number; // neta = venta - costo - comisión - envío - otros
	// Cómo paga y si ya pagó. Una venta pendiente NO descontó stock todavía.
	// null = ventas cargadas antes del 20/08/2026, cuando el método no se pedía.
	// NO se adivina: el panel las muestra como "Sin especificar".
	paymentMethod: ManualPaymentMethod | null;
	paid: boolean;
	paymentSplit: ManualPaymentSplit | null;
	// Productos del catálogo vinculados (los que descontaron stock).
	items: ManualSaleItem[];
	// Datos del comprador, si se cargaron. Con esto la venta se puede confirmar
	// por mail igual que una compra web.
	customer: { id: string; fullName: string; email: string; phone: string | null } | null;
	address: {
		line1: string;
		line2: string | null;
		city: string;
		state: string;
		postalCode: string | null;
		country: string | null;
	} | null;
	invoice: {
		rut: string;
		businessName: string;
		tradeName: string | null;
		address: string;
		city: string | null;
		state: string | null;
		email: string | null;
	} | null;
}

/**
 * Datos del comprador en una venta manual. Son los MISMOS que cargaría el
 * cliente comprando por la web: con esto la venta deja de ser un asiento suelto
 * y queda asociada a un cliente, con su historial y su mail de confirmación.
 */
export interface ManualSaleCustomer {
	fullName: string;
	email: string;
	phone: string;
}
export interface ManualSaleAddress {
	line1: string;
	line2?: string;
	city: string;
	state: string;
	postalCode?: string;
	country?: string;
}
export interface ManualSaleInvoice {
	rut: string;
	businessName: string;
	tradeName?: string;
	address: string;
	city?: string;
	state?: string;
	email?: string;
}

export interface ManualSaleInput {
	conceptId: string | null;
	description: string;
	currency: 'USD' | 'UYU';
	saleAmount: number;
	cost: number;
	commission: number;
	shipping: number;
	other: number;
	fxRate: number; // pesos por USD (se usa solo si currency === 'UYU')
	saleDate?: string | null; // ISO; si no viene, ahora
	/** Por dónde paga. null en una edición = dejar el que ya tenía. */
	paymentMethod: ManualPaymentMethod | null;
	/** ¿Ya entró la plata? Si es false, la venta queda Pendiente y NO toca stock. */
	paid: boolean;
	/** Sólo para 'hybrid': cuánto por cada vía, en la moneda de la venta. */
	paymentSplit?: ManualPaymentSplit | null;
	// Productos del catálogo a descontar de stock (opcional). Vacío = venta libre.
	items: ManualSaleItem[];
	// Opcionales: si se cargan, la venta queda igual que una compra web.
	customer?: ManualSaleCustomer | null;
	address?: ManualSaleAddress | null;
	invoice?: ManualSaleInvoice | null;
}

/** Convierte los datos del formulario al formato que esperan las RPC. */
const customerPayload = (input: ManualSaleInput) =>
	input.customer && input.customer.email.trim()
		? {
				full_name: input.customer.fullName.trim(),
				email: input.customer.email.trim(),
				phone: input.customer.phone.trim(),
		  }
		: null;

const addressPayload = (input: ManualSaleInput) =>
	input.address && input.address.line1.trim()
		? {
				address_line1: input.address.line1.trim(),
				address_line2: input.address.line2?.trim() || null,
				city: input.address.city.trim(),
				state: input.address.state.trim(),
				postal_code: input.address.postalCode?.trim() || null,
				country: input.address.country?.trim() || 'Uruguay',
		  }
		: null;

/**
 * El reparto del pago combinado viaja en USD, igual que `orders.payment_split`
 * de la web. La base valida que los dos montos sumen el total, así que la
 * conversión tiene que usar exactamente el mismo redondeo que `p_total_usd`.
 */
const splitPayload = (input: ManualSaleInput, toUsd: (n: number) => number) => {
	if (input.paymentMethod !== 'hybrid' || !input.paymentSplit) return null;
	const round2 = (n: number) => Math.round(n * 100) / 100;
	const mp = round2(toUsd(input.paymentSplit.mercadopago));
	const total = round2(toUsd(input.saleAmount));
	// La transferencia se calcula como el RESTO, no convirtiéndola aparte: dos
	// redondeos independientes pueden no sumar el total y la base lo rechaza.
	return { mercadopago: mp, transfer: round2(total - mp) };
};

const invoicePayload = (input: ManualSaleInput) =>
	input.invoice && input.invoice.rut.trim()
		? {
				requested: true,
				rut: input.invoice.rut.replace(/\D/g, ''),
				business_name: input.invoice.businessName.trim(),
				trade_name: input.invoice.tradeName?.trim() || null,
				address: input.invoice.address.trim(),
				city: input.invoice.city?.trim() || null,
				state: input.invoice.state?.trim() || null,
				email: input.invoice.email?.trim() || input.customer?.email?.trim() || null,
		  }
		: { requested: false };

/* ------------------------------ Conceptos ------------------------------ */
export const getSaleConcepts = async (): Promise<SaleConcept[]> => {
	const { data, error } = await (supabase as any)
		.from('sale_concepts')
		.select('id, name, color, created_at')
		.order('name', { ascending: true });
	if (error) throw new Error(error.message);
	return (data ?? []) as SaleConcept[];
};

export const createSaleConcept = async (
	name: string,
	color?: string | null
): Promise<SaleConcept> => {
	const { data, error } = await (supabase as any)
		.from('sale_concepts')
		.insert({ name: name.trim(), color: color ?? null })
		.select('id, name, color, created_at')
		.single();
	if (error) throw new Error(error.message);
	return data as SaleConcept;
};

export const deleteSaleConcept = async (id: string): Promise<void> => {
	const { error } = await (supabase as any)
		.from('sale_concepts')
		.delete()
		.eq('id', id);
	if (error) throw new Error(error.message);
};

/* ---------------------------- Ventas manuales ---------------------------- */
export const getManualSales = async (
	conceptId?: string | null
): Promise<ManualSale[]> => {
	let query = (supabase as any)
		.from('orders')
		.select(
			`id, created_at, status, concept_id, manual_description,
			 total_amount, total_original, ml_currency, fx_rate,
			 payment_method, payment_status, payment_split,
			 manual_cost_usd, ml_commission_usd, ml_shipping_cost_usd, ml_other_costs_usd,
			 invoice_requested, invoice_rut, invoice_business_name, invoice_trade_name,
			 invoice_address, invoice_city, invoice_state, invoice_email,
			 sale_concepts:concept_id(name, color),
			 customers:customer_id(id, full_name, email, phone),
			 addresses:address_id(address_line1, address_line2, city, state, postal_code, country),
			 order_items:order_items(variant_id, quantity, variants(color_name, storage, products(name)))`
		)
		.eq('channel', 'manual')
		.order('created_at', { ascending: false });
	if (conceptId) query = query.eq('concept_id', conceptId);

	const { data, error } = await query;
	if (error) throw new Error(error.message);

	return ((data ?? []) as any[]).map(o => {
		const currency: 'USD' | 'UYU' = o.ml_currency === 'UYU' ? 'UYU' : 'USD';
		const fx = Number(o.fx_rate ?? 1) || 1;
		// Reconstruimos los montos en la moneda real de la venta.
		const saleAmount =
			currency === 'UYU' && o.total_original != null
				? Number(o.total_original)
				: Number(o.total_amount ?? 0);
		// Costos guardados en USD; los mostramos en la moneda real de la venta.
		const toCur = (usd: number) => Number(usd ?? 0) * (currency === 'UYU' ? fx : 1);
		const cost = toCur(o.manual_cost_usd);
		const commission = toCur(o.ml_commission_usd);
		const shipping = toCur(o.ml_shipping_cost_usd);
		const other = toCur(o.ml_other_costs_usd);
		return {
			id: o.id,
			created_at: o.created_at,
			status: o.status,
			conceptId: o.concept_id ?? null,
			conceptName: o.sale_concepts?.name ?? null,
			conceptColor: o.sale_concepts?.color ?? null,
			description: o.manual_description ?? null,
			currency,
			fxRate: fx,
			saleAmount,
			cost,
			commission,
			shipping,
			other,
			grossProfit: saleAmount - cost,
			profit: saleAmount - cost - commission - shipping - other,
			paymentMethod: (o.payment_method ?? null) as ManualPaymentMethod | null,
			paid: o.payment_status === 'paid',
			// El reparto se guarda en USD; acá se muestra en la moneda de la venta.
			paymentSplit: o.payment_split
				? {
						mercadopago: Number(o.payment_split.mercadopago ?? 0) * (currency === 'UYU' ? fx : 1),
						transfer: Number(o.payment_split.transfer ?? 0) * (currency === 'UYU' ? fx : 1),
				  }
				: null,
			customer: o.customers
				? {
						id: o.customers.id as string,
						fullName: (o.customers.full_name as string) ?? '',
						email: (o.customers.email as string) ?? '',
						phone: (o.customers.phone as string | null) ?? null,
				  }
				: null,
			address: o.addresses
				? {
						line1: (o.addresses.address_line1 as string) ?? '',
						line2: (o.addresses.address_line2 as string | null) ?? null,
						city: (o.addresses.city as string) ?? '',
						state: (o.addresses.state as string) ?? '',
						postalCode: (o.addresses.postal_code as string | null) ?? null,
						country: (o.addresses.country as string | null) ?? null,
				  }
				: null,
			invoice: o.invoice_requested
				? {
						rut: (o.invoice_rut as string) ?? '',
						businessName: (o.invoice_business_name as string) ?? '',
						tradeName: (o.invoice_trade_name as string | null) ?? null,
						address: (o.invoice_address as string) ?? '',
						city: (o.invoice_city as string | null) ?? null,
						state: (o.invoice_state as string | null) ?? null,
						email: (o.invoice_email as string | null) ?? null,
				  }
				: null,
			items: ((o.order_items ?? []) as any[]).map(it => ({
				variantId: it.variant_id as string,
				label:
					[
						it.variants?.products?.name,
						[it.variants?.color_name, it.variants?.storage]
							.filter(Boolean)
							.join(' / '),
					]
						.filter(Boolean)
						.join(' · ') || 'Producto',
				quantity: Number(it.quantity ?? 0),
			})),
		} as ManualSale;
	});
};

export const createManualSale = async (
	input: ManualSaleInput
): Promise<{ id: number }> => {
	const isUyu = input.currency === 'UYU';
	const fx = isUyu ? Number(input.fxRate) || 1 : 1;
	const toUsd = (n: number) => (isUyu ? n / fx : n);
	const round2 = (n: number) => Math.round(n * 100) / 100;

	// El RPC inserta la orden y, si hay items, descuenta el stock de cada variante
	// de forma atómica (lo que dispara el sync a ML).
	const { data, error } = await (supabase as any).rpc('create_manual_sale', {
		p_concept_id: input.conceptId,
		p_description: input.description?.trim() || null,
		p_currency: input.currency,
		p_sale_amount: input.saleAmount, // moneda real de la venta
		p_total_usd: round2(toUsd(input.saleAmount)), // métrica interna en USD
		p_fx_rate: fx,
		p_cost_usd: round2(toUsd(input.cost)),
		p_commission_usd: round2(toUsd(input.commission)),
		p_shipping_usd: round2(toUsd(input.shipping)),
		p_other_usd: round2(toUsd(input.other)),
		p_sale_date: input.saleDate || new Date().toISOString(),
		p_items: input.items.map(i => ({
			variant_id: i.variantId,
			quantity: i.quantity,
		})),
		p_customer: customerPayload(input),
		p_address: addressPayload(input),
		p_invoice: invoicePayload(input),
		p_payment_method: input.paymentMethod,
		// Sin método no se toca el estado del cobro: el RPC conserva el que tenía.
		p_payment_status: input.paymentMethod ? (input.paid ? 'paid' : 'pending') : null,
		p_payment_split: splitPayload(input, toUsd),
	});
	if (error) throw new Error(error.message);
	return { id: data as number };
};

export const updateManualSale = async (
	id: number,
	input: ManualSaleInput
): Promise<void> => {
	const isUyu = input.currency === 'UYU';
	const fx = isUyu ? Number(input.fxRate) || 1 : 1;
	const toUsd = (n: number) => (isUyu ? n / fx : n);
	const round2 = (n: number) => Math.round(n * 100) / 100;

	// El RPC reconcilia el stock: devuelve el de los items viejos y descuenta el
	// de los nuevos (lo que dispara el sync a ML), todo de forma atómica.
	const { error } = await (supabase as any).rpc('update_manual_sale', {
		p_order_id: id,
		p_concept_id: input.conceptId,
		p_description: input.description?.trim() || null,
		p_currency: input.currency,
		p_sale_amount: input.saleAmount,
		p_total_usd: round2(toUsd(input.saleAmount)),
		p_fx_rate: fx,
		p_cost_usd: round2(toUsd(input.cost)),
		p_commission_usd: round2(toUsd(input.commission)),
		p_shipping_usd: round2(toUsd(input.shipping)),
		p_other_usd: round2(toUsd(input.other)),
		p_sale_date: input.saleDate || null,
		p_items: input.items.map(i => ({
			variant_id: i.variantId,
			quantity: i.quantity,
		})),
		p_customer: customerPayload(input),
		p_address: addressPayload(input),
		p_invoice: invoicePayload(input),
		p_payment_method: input.paymentMethod,
		p_payment_status: input.paid ? 'paid' : 'pending',
		p_payment_split: splitPayload(input, toUsd),
	});
	if (error) throw new Error(error.message);
};

/**
 * Le manda al comprador el mismo mail de confirmación que recibe cualquiera que
 * compra por la web. Requiere que la venta tenga un cliente con mail cargado.
 */
export const sendManualSaleConfirmation = async (orderId: number): Promise<void> => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { data, error } = await (supabase.functions as any).invoke(
		'manual-payment-confirm',
		{ body: { order_id: orderId, action: 'send_confirmation' } }
	);
	if (error) {
		// La edge devuelve el motivo en el body; el error de invoke sólo trae el status.
		const detalle = (data as { error?: string } | null)?.error;
		throw new Error(detalle || error.message);
	}
	if ((data as { error?: string } | null)?.error) {
		throw new Error((data as { error: string }).error);
	}
};

/**
 * Le manda al comprador cómo pagar una venta manual que quedó pendiente:
 * el link de MercadoPago, los datos de Abitab/Redpagos, o las dos cosas si es
 * combinado.
 *
 * En TRANSFERENCIA sola no manda nada — la cuenta se la pasa el admin en
 * persona. La edge devuelve 400 en ese caso y el panel no ofrece el botón.
 */
export const sendManualSalePaymentLink = async (
	orderId: number
): Promise<{ initPoint: string | null; sentTo: string }> => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { data, error } = await (supabase.functions as any).invoke(
		'manual-sale-payment-link',
		{ body: { order_id: orderId } }
	);
	// La edge manda el motivo en el body; el error de invoke sólo trae el status.
	const detalle = (data as { error?: string } | null)?.error;
	if (error) throw new Error(detalle || error.message);
	if (detalle) throw new Error(detalle);
	return {
		initPoint: (data as { init_point?: string | null }).init_point ?? null,
		sentTo: (data as { sent_to: string }).sent_to,
	};
};

export const deleteManualSale = async (id: number): Promise<void> => {
	// El RPC devuelve el stock descontado antes de borrar la venta.
	const { error } = await (supabase as any).rpc('delete_manual_sale', {
		p_order_id: id,
	});
	if (error) throw new Error(error.message);
};
