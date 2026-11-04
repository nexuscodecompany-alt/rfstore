// deno-lint-ignore-file no-explicit-any
// Fixed — facturación electrónica (CFE ante DGI). Guía: docs/fixed-integracion.md
//
// Todo lo que sabe de Fixed vive acá: el cliente HTTP, cómo se arma la venta a
// partir de una orden de RF Store, el cálculo del total (idéntico al de Fixed,
// si no rechaza con E15) y las validaciones previas. Las edge functions
// fixed-invoice y fixed-invoice-sync sólo orquestan.
//
// Secrets: FIXED_BASE_URL, FIXED_API_KEY, FIXED_API_SECRET.

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { getValidAccessToken } from './ml-helpers.ts';

// ============================================================================
// Cliente HTTP
// ============================================================================

const BASE_URL = (Deno.env.get('FIXED_BASE_URL') ?? '').replace(/\/+$/, '');
const API_KEY = Deno.env.get('FIXED_API_KEY') ?? '';
const API_SECRET = Deno.env.get('FIXED_API_SECRET') ?? '';
const TIMEOUT_MS = 45_000;

export const fixedConfigured = () => !!(BASE_URL && API_KEY && API_SECRET);
export const fixedEnvironment = (): 'testing' | 'produccion' =>
	BASE_URL.includes('fixedtesting') ? 'testing' : 'produccion';

// En estos endpoints el éxito es codigoError "0"; en el resto, vacío.
const SUCCESS_IS_ZERO = new Set([
	'/localesListado',
	'/serviciosRubrosListado',
	'/serviciosRubrosAgregarEditar',
	'/consultaFacturacionDia',
	'/clienteMostrar',
]);

export interface FixedResult {
	/** Fixed respondió y la operación salió bien. */
	ok: boolean;
	/** Cuerpo de la respuesta (null si no hubo respuesta legible). */
	data: any | null;
	httpStatus: number;
	/** Sin respuesta (corte, timeout, respuesta no JSON): NO sabemos qué pasó. */
	noResponse: boolean;
	code: string;
	description: string;
}

/**
 * Llama a Fixed. Los errores de negocio vuelven con HTTP 500 y el código en
 * `codigoError`; por eso no se mira sólo el status. Los POST sin cuerpo igual
 * mandan `{}`: sin Content-Length, Google responde 411.
 */
export async function fixedCall(path: string, body: unknown = {}): Promise<FixedResult> {
	if (!fixedConfigured()) {
		return { ok: false, data: null, httpStatus: 0, noResponse: false, code: 'CONFIG', description: 'Faltan los secrets de Fixed (FIXED_BASE_URL / FIXED_API_KEY / FIXED_API_SECRET)' };
	}
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
	try {
		const r = await fetch(`${BASE_URL}${path}`, {
			method: 'POST',
			headers: { 'x-api-key': API_KEY, 'x-api-secret': API_SECRET, 'Content-Type': 'application/json' },
			body: JSON.stringify(body ?? {}),
			signal: ctrl.signal,
		});
		const text = await r.text();
		let data: any = null;
		try {
			data = JSON.parse(text);
		} catch {
			return { ok: false, data: null, httpStatus: r.status, noResponse: true, code: `HTTP${r.status}`, description: text.slice(0, 200) };
		}
		const code = String(data?.codigoError ?? '');
		const ok = SUCCESS_IS_ZERO.has(path) ? code === '0' || code === '' : code === '';
		return { ok: ok && r.status < 400, data, httpStatus: r.status, noResponse: false, code, description: String(data?.descripcion ?? '') };
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return { ok: false, data: null, httpStatus: 0, noResponse: true, code: 'NETWORK', description: msg };
	} finally {
		clearTimeout(timer);
	}
}

/** Explicación en castellano de cada código, para el panel. */
export const FIXED_ERRORS: Record<string, string> = {
	A01: 'Faltan las credenciales de Fixed',
	A02: 'La api-key de Fixed es inválida o está inactiva',
	A03: 'El api-secret de Fixed es inválido',
	A04: 'Fixed tuvo un error interno validando las credenciales',
	A05: 'La API de Fixed está desactivada temporalmente',
	A06: 'El plan de Fixed no incluye acceso a la API',
	V01: 'El formato de la venta no es el que espera Fixed',
	V02: 'Error inesperado en Fixed',
	E02: 'Moneda incorrecta',
	E03: 'Fixed no encuentra la empresa',
	E04: 'La empresa no tiene firma electrónica vigente en Fixed',
	E05: 'No hay numeración (CAE) disponible para este comprobante',
	E08: 'Fecha con formato inválido',
	E10: 'No se encontró la factura original',
	E11: 'La factura original fue rechazada por DGI: no se puede anular',
	E15: 'El total no coincide con el que calcula Fixed',
	E17: 'El total a devolver no coincide con el de la factura',
	E18: 'Datos del cliente inválidos para el tipo de documento',
	E19: 'Venta de más de 5000 UI: DGI exige documento, domicilio, localidad y departamento del cliente',
	E20: 'Forma de pago inválida',
	E21: 'Cotización inválida',
	E22: 'Ya hay una emisión en curso para este intento',
	E23: 'La clave de este intento ya se usó con otros datos',
	E24: 'La descripción de un producto es demasiado larga',
	E25: 'Las observaciones son demasiado largas',
	E26: 'Cantidad, precio o descuento inválido en una línea',
	X01: 'Local de Fixed inválido',
	X02: 'Tasa de IVA no habilitada o descuento mayor al importe de una línea',
	X03: 'Error inesperado de Fixed generando el comprobante',
	X04: 'Error inesperado de Fixed',
	X05: 'Error inesperado de Fixed generando la venta',
	X06: 'Error inesperado de Fixed obteniendo la venta original',
	C08: 'El comprobante no existe en Fixed',
	NETWORK: 'No hubo respuesta de Fixed (corte o demora)',
	CONFIG: 'Fixed no está configurado',
};
export const explainFixed = (code: string, description: string) =>
	[FIXED_ERRORS[code], description].filter(Boolean).join(' — ') || `Error ${code}`;

// ============================================================================
// Configuración (app_settings.invoice_config)
// ============================================================================

export interface InvoiceConfig {
	enabled: boolean;
	local_id: string;
	rubro_mode: 'category' | 'fixed';
	default_rubro: string;
	shipping_rubro: string;
	ui_value_uyu: number;
	id_required_above_ui: number;
}

export const DEFAULT_CONFIG: InvoiceConfig = {
	enabled: false,
	local_id: '',
	rubro_mode: 'category',
	default_rubro: 'Varios',
	shipping_rubro: 'Envíos',
	ui_value_uyu: 6.3,
	id_required_above_ui: 5000,
};

export async function loadInvoiceConfig(supabase: SupabaseClient): Promise<InvoiceConfig> {
	const { data } = await supabase.from('app_settings').select('value').eq('key', 'invoice_config').maybeSingle();
	return { ...DEFAULT_CONFIG, ...((data?.value as Partial<InvoiceConfig>) ?? {}) };
}

// ============================================================================
// Reglas de negocio (lo que más probablemente cambie: está todo junto)
// ============================================================================

/** Estados de orden que no se facturan. */
const CANCEL_STATES = ['cancelado', 'rechazado', 'expirado', 'cancelled'];

/**
 * Moneda del comprobante = la moneda en que se cobró la orden.
 * - Mercado Libre y ventas manuales: la moneda de la venta (ml_currency).
 * - Web con MercadoPago o tarjeta (Getnet): se cobró en pesos (total_original).
 * - Web con transferencia, depósito o pago combinado: en dólares.
 */
export function invoiceCurrency(o: any): 'UYU' | 'USD' {
	const channel = String(o.channel ?? 'web');
	if (channel === 'ml' || channel === 'manual') return o.ml_currency === 'UYU' ? 'UYU' : 'USD';
	const method = String(o.payment_method ?? '');
	if ((method === 'mercadopago' || method === 'placetopay') && Number(o.total_original) > 0) return 'UYU';
	return 'USD';
}

/** Lo que efectivamente se cobró, en la moneda del comprobante. */
function chargedTotal(o: any, currency: 'UYU' | 'USD'): number {
	if (currency === 'UYU') return Number(o.total_original) || round2(Number(o.total_amount) * Number(o.fx_rate || 0));
	const channel = String(o.channel ?? 'web');
	if (channel === 'manual') return Number(o.total_original) || Number(o.total_amount);
	return Number(o.total_amount);
}

// ============================================================================
// Documento del cliente
// ============================================================================

export const onlyDigits = (s: unknown) => String(s ?? '').replace(/\D/g, '');

/** Cédula uruguaya (con dígito verificador, 7 u 8 dígitos). */
export function isValidCI(raw: string): boolean {
	const d = onlyDigits(raw);
	if (d.length < 7 || d.length > 8) return false;
	const body = d.slice(0, -1).padStart(7, '0');
	const w = [2, 9, 8, 7, 6, 3, 4];
	const sum = body.split('').reduce((acc, c, i) => acc + Number(c) * w[i], 0);
	return (10 - (sum % 10)) % 10 === Number(d.slice(-1));
}

/** RUT uruguayo (12 dígitos, dígito verificador módulo 11). */
export function isValidRUT(raw: string): boolean {
	const d = onlyDigits(raw);
	if (d.length !== 12) return false;
	const w = [4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
	const sum = d.slice(0, 11).split('').reduce((acc, c, i) => acc + Number(c) * w[i], 0);
	let dv = 11 - (sum % 11);
	if (dv === 11) dv = 0;
	if (dv === 10) return false;
	return dv === Number(d[11]);
}

// ============================================================================
// Borrador de factura (lo que ve el admin antes de confirmar)
// ============================================================================

export type ReceptorTipo = 'final' | 'ci' | 'rut';

export interface Receptor {
	tipo: ReceptorTipo;
	documento: string;
	razonSocial: string;
	nombreComercial: string;
	domicilio: string;
	localidad: string;
	departamento: string;
	domicilioEntrega: string;
	email: string;
	telefono: string;
}

export interface DraftLine {
	cantidad: number;
	descripcion: string;
	descripcionLarga: string;
	rubro: string;
	codigo: string;
	precioUnitario: number;
	descuentoMonto: number;
}

export interface InvoiceDraft {
	order_id: number;
	order_ids: number[];
	channel: string;
	moneda: 'UYU' | 'USD';
	cotizacion: number | null;
	total: number;
	total_uyu: number;
	lines: DraftLine[];
	receptor: Receptor;
	/** Lo que encontró el sistema para el receptor (para el panel). */
	receptor_source: string;
	observaciones: string;
	id_required: boolean;
	id_threshold_uyu: number;
	warnings: string[];
}

// Largos máximos de Fixed: si se pasan, rechaza (no recorta). Recortamos antes.
const LIMITS = { nombre: 150, domicilio: 70, localidad: 30, descripcion: 80, descripcionLarga: 500, observaciones: 500 };

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const cut = (s: unknown, max: number) => {
	const t = String(s ?? '').replace(/\s+/g, ' ').trim();
	if (t.length <= max) return t;
	const sliced = t.slice(0, max);
	const sp = sliced.lastIndexOf(' ');
	return (sp > max * 0.6 ? sliced.slice(0, sp) : sliced).trim();
};

/** Importe de una línea tal como lo calcula Fixed (montoBruto 1 = IVA incluido). */
export const lineTotal = (l: Pick<DraftLine, 'cantidad' | 'precioUnitario' | 'descuentoMonto'>) =>
	round2(l.precioUnitario * l.cantidad - l.descuentoMonto);
export const linesTotal = (lines: DraftLine[]) => round2(lines.reduce((a, l) => a + lineTotal(l), 0));

/**
 * Hace que la suma de las líneas dé EXACTAMENTE lo cobrado. La conversión a
 * pesos y los redondeos dejan centésimos (a veces un peso) de diferencia, y el
 * cupón no tiene línea propia (Fixed no admite precios negativos): todo eso se
 * absorbe con descuentos repartidos o subiendo el precio de una línea.
 */
export function fitLinesToTotal(lines: DraftLine[], target: number): DraftLine[] {
	// Fixed admite 2 decimales en precio y descuento (E26): se normaliza antes de cuadrar.
	const out = lines.map(l => ({ ...l, precioUnitario: round2(l.precioUnitario), descuentoMonto: round2(l.descuentoMonto) }));
	let diff = round2(target - linesTotal(out));
	if (Math.abs(diff) < 0.005 || out.length === 0) return out;

	if (diff < 0) {
		// Bajar: descuento repartido según el peso de cada línea, en centésimos.
		let cents = Math.round(-diff * 100);
		const base = out.map(l => Math.max(0, Math.round(lineTotal(l) * 100) - 1));
		const totalBase = base.reduce((a, b) => a + b, 0);
		if (totalBase < cents) throw new Error('El descuento es mayor que el importe de los productos');
		const share = base.map(b => Math.floor((b * cents) / totalBase));
		let rest = cents - share.reduce((a, b) => a + b, 0);
		const order = base.map((b, i) => i).sort((a, b) => base[b] - base[a]);
		for (const i of order) {
			if (rest <= 0) break;
			if (share[i] < base[i]) { share[i]++; rest--; }
		}
		out.forEach((l, i) => (l.descuentoMonto = round2(l.descuentoMonto + share[i] / 100)));
		cents = 0;
	} else {
		// Subir: en una línea de cantidad 1 (el envío, o la de mayor importe) se
		// suma la diferencia al precio; si todas tienen cantidad > 1, se sube el
		// unitario lo justo y el sobrante va como descuento.
		const ones = out.map((l, i) => i).filter(i => out[i].cantidad === 1);
		const pick = (ids: number[]) => ids.sort((a, b) => lineTotal(out[b]) - lineTotal(out[a]))[0];
		if (ones.length > 0) {
			const i = pick(ones);
			out[i].precioUnitario = round2(out[i].precioUnitario + diff);
		} else {
			const i = pick(out.map((_, k) => k));
			const inc = Math.ceil((diff / out[i].cantidad) * 100) / 100;
			out[i].precioUnitario = round2(out[i].precioUnitario + inc);
			out[i].descuentoMonto = round2(out[i].descuentoMonto + round2(inc * out[i].cantidad - diff));
		}
	}
	diff = round2(target - linesTotal(out));
	if (Math.abs(diff) >= 0.005) throw new Error(`No se pudo cuadrar el total (diferencia ${diff})`);
	return out;
}

/** Fecha de hoy en Uruguay, dd/mm/aaaa. */
export function todayUY(): string {
	const p = new Intl.DateTimeFormat('es-UY', { timeZone: 'America/Montevideo', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(new Date());
	const g = (t: string) => p.find(x => x.type === t)?.value ?? '';
	return `${g('day')}/${g('month')}/${g('year')}`;
}

const EMPTY_RECEPTOR: Receptor = {
	tipo: 'final', documento: '', razonSocial: '', nombreComercial: '', domicilio: '',
	localidad: '', departamento: '', domicilioEntrega: '', email: '', telefono: '',
};

// Valores de relleno de las variantes (CDR manda "Unico" y "-"): no van a la factura.
const VARIANT_PLACEHOLDERS = new Set(['', '-', '—', 'unico', 'único', 'n/a', 'na', 'default', 'estandar', 'estándar']);
const isRealVariant = (v: unknown) => !VARIANT_PLACEHOLDERS.has(String(v ?? '').trim().toLowerCase());

/** Arma el borrador de factura de una orden, con todo lo que se puede deducir. */
export async function buildDraft(supabase: SupabaseClient, orderId: number, cfg: InvoiceConfig): Promise<InvoiceDraft> {
	const { data: base, error } = await supabase
		.from('orders')
		.select('id, channel, ml_pack_id, ml_order_id')
		.eq('id', orderId)
		.maybeSingle();
	if (error) throw new Error(error.message);
	if (!base) throw new Error('Orden no encontrada');

	// Un carrito de Mercado Libre (pack) son varias órdenes: se facturan juntas.
	let ids = [orderId];
	if (base.channel === 'ml' && base.ml_pack_id) {
		const { data: pack } = await supabase.from('orders').select('id, status').eq('channel', 'ml').eq('ml_pack_id', base.ml_pack_id);
		ids = (pack ?? []).filter(p => !CANCEL_STATES.includes(String(p.status ?? '').toLowerCase())).map(p => Number(p.id)).sort((a, b) => a - b);
		if (!ids.includes(orderId)) ids = [orderId];
	}

	const { data: orders, error: oErr } = await supabase
		.from('orders')
		.select(`id, channel, status, payment_method, payment_status, total_amount, total_original, fx_rate, ml_currency,
			shipping_cost_usd, shipping_department, discount_usd, coupon_code, manual_description, ml_order_id,
			invoice_requested, invoice_rut, invoice_business_name, invoice_trade_name, invoice_address,
			invoice_city, invoice_state, invoice_email,
			customers(full_name, email, phone, document_ci),
			addresses(address_line1, address_line2, city, state),
			sale_concepts:concept_id(name),
			order_items(quantity, price, variants(color_name, storage, products(name, external_code, categories(name))))`)
		.in('id', ids);
	if (oErr) throw new Error(oErr.message);
	const list = (orders ?? []).sort((a: any, b: any) => a.id - b.id);
	const o: any = list.find((x: any) => x.id === orderId) ?? list[0];
	if (!o) throw new Error('Orden no encontrada');

	const warnings: string[] = [];
	const moneda = invoiceCurrency(o);

	// Cotización: la congelada en la orden (dólar BROU del momento); si no la
	// tiene (ventas manuales guardan 1), la del día de la tienda.
	let fx = Number(o.fx_rate) > 1.5 ? Number(o.fx_rate) : 0;
	if (!fx) {
		const { data: cache } = await supabase.from('app_settings').select('value').eq('key', 'usd_uyu_rate_cache').maybeSingle();
		fx = Number((cache?.value as any)?.rate) || 0;
		if (moneda === 'USD') warnings.push('La orden no tiene cotización guardada: se usa el dólar BROU de hoy.');
	}
	if (!fx) throw new Error('No hay cotización del dólar para convertir');
	const rate = moneda === 'UYU' ? fx : 1;

	// --- Líneas ---
	let lines: DraftLine[] = [];
	let mlShipping = 0;
	// Total a facturar: lo cobrado; en ML, lo que da la pantalla de facturación de ML.
	let target = 0;
	for (const ord of list) {
		const first = lines.length;
		for (const it of (ord.order_items ?? []) as any[]) {
			const p = it.variants?.products ?? {};
			const variant = [it.variants?.color_name, it.variants?.storage].filter(isRealVariant).join(' ');
			const full = [p.name ?? 'Producto', variant].filter(Boolean).join(' — ');
			const category = p.categories?.name ?? '';
			lines.push({
				cantidad: Number(it.quantity) || 1,
				descripcion: cut(full, LIMITS.descripcion),
				// Fixed imprime las dos: sólo va si agrega algo a la corta.
				descripcionLarga: full.length > LIMITS.descripcion ? cut(full, LIMITS.descripcionLarga) : '',
				rubro: cut(cfg.rubro_mode === 'category' && category ? category : cfg.default_rubro, 60) || 'Varios',
				codigo: cut(p.external_code ?? '', 40),
				precioUnitario: round2(Number(it.price) * rate),
				descuentoMonto: 0,
			});
		}
		// ML: precios, descuento y envío tal cual la pantalla "Datos para emitir la
		// factura" de ML, en la moneda de la venta y sin cotización nuestra.
		if (ord.channel === 'ml' && ord.ml_order_id && lines.length > first) {
			const ml = await mlChargeDetail(supabase, String(ord.ml_order_id));
			if (ml && ml.items.length > 0) {
				mlShipping += ml.shipping;
				target += round2(ml.items.reduce((acc, x) => acc + x.listUnit * x.qty - x.discount, 0));
				const own = lines.splice(first);
				const used = new Set<number>();
				for (const x of ml.items) {
					// Nuestra línea (nombre, rubro, código) de la misma cantidad; si no hay, el título de ML.
					let k = own.findIndex((l, i) => !used.has(i) && l.cantidad === x.qty);
					if (k < 0) k = own.findIndex((_, i) => !used.has(i));
					if (k >= 0) used.add(k);
					const ref = k >= 0 ? own[k] : null;
					lines.push({
						cantidad: x.qty,
						descripcion: ref?.descripcion ?? cut(x.title, LIMITS.descripcion),
						descripcionLarga: ref?.descripcionLarga ?? (x.title.length > LIMITS.descripcion ? cut(x.title, LIMITS.descripcionLarga) : ''),
						rubro: ref?.rubro ?? (cfg.default_rubro || 'Varios'),
						codigo: ref?.codigo ?? '',
						precioUnitario: x.listUnit,
						descuentoMonto: x.discount,
					});
				}
			} else {
				target += chargedTotal(ord, moneda);
				warnings.push('No se pudo leer de Mercado Libre el detalle de la venta: va por el total, sin desglose.');
			}
		} else {
			target += chargedTotal(ord, moneda);
		}
	}
	if (mlShipping > 0) {
		lines.push({
			cantidad: 1,
			descripcion: 'Envío',
			descripcionLarga: '',
			rubro: cfg.shipping_rubro || 'Envíos',
			codigo: '',
			precioUnitario: mlShipping,
			descuentoMonto: 0,
		});
	}
	const shippingUsd = list.reduce((a: number, x: any) => a + (Number(x.shipping_cost_usd) || 0), 0);
	if (shippingUsd > 0) {
		const dept = o.shipping_department ? ` a ${o.shipping_department}` : '';
		lines.push({
			cantidad: 1,
			descripcion: cut(`Envío${dept}`, LIMITS.descripcion),
			descripcionLarga: '',
			rubro: cfg.shipping_rubro || 'Envíos',
			codigo: '',
			precioUnitario: round2(shippingUsd * rate),
			descuentoMonto: 0,
		});
	}

	const total = round2(target + mlShipping);
	if (lines.length === 0) {
		// Venta manual sin productos cargados: una línea por el total.
		const desc = o.manual_description || o.sale_concepts?.name || `Venta #${o.id}`;
		lines.push({
			cantidad: 1,
			descripcion: cut(desc, LIMITS.descripcion),
			descripcionLarga: desc.length > LIMITS.descripcion ? cut(desc, LIMITS.descripcionLarga) : '',
			rubro: cfg.default_rubro || 'Varios',
			codigo: '',
			precioUnitario: total,
			descuentoMonto: 0,
		});
	}
	lines = lines.filter(l => l.precioUnitario > 0);
	lines = fitLinesToTotal(lines, total);
	if (Number(o.discount_usd) > 0) warnings.push(`El cupón ${o.coupon_code ?? ''} va como descuento en las líneas.`.replace('  ', ' '));

	// --- Receptor ---
	const c: any = Array.isArray(o.customers) ? o.customers[0] : o.customers;
	const a: any = Array.isArray(o.addresses) ? o.addresses[0] : o.addresses;
	const street = [a?.address_line1, a?.address_line2].filter(Boolean).join(' ');
	let receptor: Receptor = { ...EMPTY_RECEPTOR };
	let source = 'Consumidor final (la orden no tiene datos del comprador)';
	if (o.invoice_requested && o.invoice_rut) {
		receptor = {
			tipo: 'rut',
			documento: onlyDigits(o.invoice_rut),
			razonSocial: o.invoice_business_name ?? '',
			nombreComercial: o.invoice_trade_name || o.invoice_business_name || '',
			domicilio: o.invoice_address ?? '',
			localidad: o.invoice_city || a?.city || '',
			departamento: o.invoice_state || a?.state || '',
			domicilioEntrega: street,
			email: o.invoice_email || c?.email || '',
			telefono: c?.phone ?? '',
		};
		source = 'Pidió factura con RUT en el checkout';
	} else if (c) {
		receptor = {
			tipo: 'ci',
			documento: onlyDigits(c.document_ci ?? ''),
			razonSocial: c.full_name ?? '',
			nombreComercial: c.full_name ?? '',
			domicilio: street,
			localidad: a?.city ?? '',
			departamento: a?.state ?? '',
			domicilioEntrega: street,
			email: c.email ?? '',
			telefono: c.phone ?? '',
		};
		source = c.document_ci ? 'Datos del cliente (con cédula)' : 'Datos del cliente (sin cédula)';
	} else if (o.channel === 'ml') {
		// Datos de facturación que el comprador cargó en ML (cédula o RUT + domicilio).
		const ml = o.ml_order_id ? await mlBillingReceptor(supabase, String(o.ml_order_id)) : null;
		if (ml) {
			receptor = ml.receptor;
			source = ml.source;
		} else {
			source = 'Mercado Libre no devolvió datos de facturación de esta venta: sale a consumidor final. Si supera 5000 UI, pedile cédula y domicilio por la mensajería de la venta y cargalos acá.';
		}
	}

	const totalUyu = moneda === 'UYU' ? total : round2(total * fx);
	const threshold = round2(cfg.id_required_above_ui * cfg.ui_value_uyu);
	const channelLabel = o.channel === 'ml' ? `Venta Mercado Libre ${list.map((x: any) => x.ml_order_id).filter(Boolean).join(', ')}` : o.channel === 'manual' ? `Venta manual #${o.id}` : `Pedido web #${o.id}`;

	return {
		order_id: orderId,
		order_ids: list.map((x: any) => Number(x.id)),
		channel: String(o.channel ?? 'web'),
		moneda,
		cotizacion: moneda === 'USD' ? fx : null,
		total,
		total_uyu: totalUyu,
		lines,
		receptor,
		receptor_source: source,
		observaciones: cut(channelLabel, LIMITS.observaciones),
		id_required: totalUyu > threshold,
		id_threshold_uyu: threshold,
		warnings,
	};
}

// ============================================================================
// Validación y JSON final
// ============================================================================

/** Problemas que impiden emitir (en castellano, para mostrarlos al admin). */
export function validateDraft(d: InvoiceDraft): string[] {
	const errs: string[] = [];
	const r = d.receptor;
	if (d.total <= 0) errs.push('El total de la factura es 0.');
	if (d.lines.length === 0) errs.push('La factura no tiene líneas.');
	if (r.tipo === 'rut') {
		if (!isValidRUT(r.documento)) errs.push('El RUT no es válido (12 dígitos con dígito verificador).');
		if (!r.razonSocial.trim()) errs.push('Falta la razón social.');
		if (!r.domicilio.trim() || !r.localidad.trim() || !r.departamento.trim())
			errs.push('Con RUT, DGI exige domicilio, localidad y departamento.');
	}
	if (r.tipo === 'ci' && r.documento && !isValidCI(r.documento)) errs.push('La cédula no es válida (revisá el dígito verificador).');
	if (r.tipo !== 'final' && !r.nombreComercial.trim()) errs.push('Falta el nombre del cliente.');
	if (d.id_required) {
		const faltan = r.tipo === 'final' || !r.documento || !r.domicilio.trim() || !r.localidad.trim() || !r.departamento.trim();
		if (faltan)
			errs.push(`La venta supera 5000 UI (≈ $ ${Math.round(d.id_threshold_uyu).toLocaleString('es-UY')}): DGI exige documento, domicilio, localidad y departamento del cliente.`);
	}
	return errs;
}

/** Cuerpo de POST /ventaCrear. Sólo campos del contrato (uno de más = V01). */
export function buildVentaJson(d: InvoiceDraft, cfg: InvoiceConfig, idempotencyKey: string): Record<string, unknown> {
	const r = d.receptor;
	const cliente = r.tipo === 'final'
		? null
		: {
			tipoDocumento: r.tipo === 'rut' ? 2 : 3,
			documento: onlyDigits(r.documento),
			razonSocial: cut(r.razonSocial || r.nombreComercial, LIMITS.nombre),
			nombreComercial: cut(r.nombreComercial || r.razonSocial, LIMITS.nombre),
			domicilio: cut(r.domicilio, LIMITS.domicilio),
			localidad: cut(r.localidad, LIMITS.localidad),
			departamento: cut(r.departamento, LIMITS.localidad),
			domicilioEntrega: cut(r.domicilioEntrega, LIMITS.domicilio),
			mailEnvioFactura: r.email.trim(),
			telefono: r.telefono.trim(),
			observaciones: '',
		};
	const body: Record<string, unknown> = {
		cliente,
		fecha: todayUY(),
		moneda: d.moneda,
		montoBruto: 1, // nuestros precios incluyen IVA
		lineasVenta: d.lines.map(l => {
			const line: Record<string, unknown> = {
				cantidad: l.cantidad,
				descripcion: l.descripcion,
				descripcionLarga: l.descripcionLarga,
				rubro: l.rubro,
				tasaIva: 'Basic', // IVA básico 22 % en todo (decisión del cliente)
				descuentoMonto: l.descuentoMonto,
				precioUnitario: l.precioUnitario,
			};
			if (l.codigo) line.codigo = l.codigo;
			return line;
		}),
		observaciones: d.observaciones,
		totalAPagar: linesTotal(d.lines),
		redondear: false,
		formaDePago: 'contado',
		ordenCompra: String(d.order_id),
		idempotencyKey,
	};
	if (d.moneda !== 'UYU' && d.cotizacion) body.cotizacion = d.cotizacion;
	if (cfg.local_id) body.local = cfg.local_id;
	return body;
}

// ============================================================================
// Aplicar respuestas a la fila de invoices
// ============================================================================

/** Campos a guardar de una emisión exitosa (venta o nota de crédito). */
export function fieldsFromEmission(data: any) {
	const tipo = Number(data?.tipoCFE);
	return {
		id_cfe: String(data?.idCFE ?? '') || null,
		id_venta: String(data?.idVenta ?? '') || null,
		tipo_cfe: Number.isFinite(tipo) && tipo > 0 ? tipo : null,
		serie: String(data?.serie ?? '') || null,
		numero: Number(data?.numero) || null,
		comprobante: String(data?.comprobante ?? '') || null,
		url_a4: String(data?.urlA4 ?? '') || null,
		url_ticket: String(data?.urlTicket ?? '') || null,
		url_verificar: String(data?.urlVerificarCFE ?? '') || null,
	};
}

/** estadoDGI de Fixed → status nuestro. */
export const statusFromDgi = (estado: string): 'aceptada' | 'rechazada' | 'emitida' =>
	estado === 'aceptado' ? 'aceptada' : estado === 'rechazado' ? 'rechazada' : 'emitida';

/**
 * Manda (o reenvía) el JSON guardado de un intento y actualiza la fila.
 * Reenviar es seguro: mismo JSON + misma idempotencyKey = Fixed devuelve el
 * resultado original en vez de emitir otro comprobante.
 */
export async function sendAttempt(supabase: SupabaseClient, invoiceId: number): Promise<any> {
	const { data: inv } = await supabase.from('invoices').select('*').eq('id', invoiceId).single();
	if (!inv) throw new Error('Factura no encontrada');
	const path = inv.kind === 'nota_credito' ? '/ventaDevolucionTotalCrear' : '/ventaCrear';
	const res = await fixedCall(path, inv.request_json);
	const now = new Date().toISOString();
	const attempts = (inv.attempts ?? 0) + 1;

	// Sin respuesta, o "emisión en curso": no sabemos si se emitió. Queda
	// "enviando" y el cron reintenta con la misma clave.
	if (res.noResponse || res.code === 'E22') {
		await supabase.from('invoices').update({ attempts, last_error_code: res.code, last_error_desc: res.description, updated_at: now }).eq('id', invoiceId);
		return { ...inv, attempts, status: 'enviando', last_error_code: res.code, last_error_desc: res.description };
	}
	if (!res.ok) {
		// Fixed contestó con un error: el comprobante NO se emitió. Reintentar con
		// la misma clave devolvería el mismo error; corregir = intento nuevo.
		const patch = { status: 'error', attempts, last_error_code: res.code || `HTTP${res.httpStatus}`, last_error_desc: explainFixed(res.code, res.description), updated_at: now };
		await supabase.from('invoices').update(patch).eq('id', invoiceId);
		return { ...inv, ...patch };
	}
	const patch: Record<string, unknown> = {
		...fieldsFromEmission(res.data),
		status: 'emitida',
		attempts,
		last_error_code: null,
		// Emitido pero sin PDF: lo avisa la descripción; el cron lo pide con /imprimirCFE.
		last_error_desc: res.data?.urlA4 ? null : res.description || null,
		updated_at: now,
	};
	await supabase.from('invoices').update(patch).eq('id', invoiceId);
	return { ...inv, ...patch };
}

/** Consulta el estado en DGI (y pide las URLs si faltan). */
export async function refreshInvoice(supabase: SupabaseClient, invoiceId: number): Promise<any> {
	const { data: inv } = await supabase.from('invoices').select('*').eq('id', invoiceId).single();
	if (!inv) throw new Error('Factura no encontrada');
	if (!inv.id_cfe) return inv;
	const now = new Date().toISOString();
	const path = inv.url_a4 ? '/ventaConsulta' : '/imprimirCFE';
	const res = await fixedCall(path, { idCFE: inv.id_cfe });
	if (!res.ok) {
		await supabase.from('invoices').update({ dgi_checked_at: now, last_error_code: res.code, last_error_desc: explainFixed(res.code, res.description), updated_at: now }).eq('id', invoiceId);
		return inv;
	}
	const estado = String(res.data?.estadoDGI ?? '');
	const patch: Record<string, unknown> = { dgi_checked_at: now, updated_at: now, last_error_code: null, last_error_desc: null };
	if (estado) {
		patch.estado_dgi = estado;
		patch.motivo_rechazo_dgi = String(res.data?.motivoRechazoDGI ?? '') || null;
		// Una venta ya anulada sigue anulada aunque DGI responda después.
		if (inv.status !== 'anulada') patch.status = statusFromDgi(estado);
	}
	if (!inv.url_a4) {
		const f = fieldsFromEmission(res.data);
		if (f.url_a4) Object.assign(patch, { url_a4: f.url_a4, url_ticket: f.url_ticket, url_verificar: f.url_verificar });
	}
	await supabase.from('invoices').update(patch).eq('id', invoiceId);

	// Nota de crédito aceptada → la venta queda anulada. Rechazada → la venta NO
	// se anuló ante DGI: vuelve a su estado (se había marcado anulada al emitirla).
	if (inv.kind === 'nota_credito' && inv.parent_invoice_id) {
		if (patch.status === 'aceptada') {
			await supabase.from('invoices').update({ status: 'anulada', updated_at: now }).eq('id', inv.parent_invoice_id);
		} else if (patch.status === 'rechazada') {
			const { data: parent } = await supabase.from('invoices').select('estado_dgi').eq('id', inv.parent_invoice_id).single();
			await supabase.from('invoices').update({ status: statusFromDgi(String(parent?.estado_dgi ?? 'aceptado')), updated_at: now }).eq('id', inv.parent_invoice_id);
		}
	}
	return { ...inv, ...patch };
}

/** Aviso por mail al admin (mismo remitente que el resto de las alertas). */
export async function alertAdmin(subject: string, text: string): Promise<void> {
	console.error(`[fixed] ${subject} — ${text}`);
	const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
	const ADMIN_EMAIL = Deno.env.get('ADMIN_EMAIL') ?? 'ventas@rfstore.uy';
	const FROM = Deno.env.get('RESEND_FROM') ?? 'RF Store <ventas@send.rfstore.uy>';
	if (!RESEND_API_KEY) return;
	const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
	try {
		await fetch('https://api.resend.com/emails', {
			method: 'POST',
			headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				from: FROM,
				to: [ADMIN_EMAIL],
				subject,
				html: `<div style="font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;max-width:560px">
					<img src="https://www.rfstore.uy/img/img-docs/logoblancorf.jpg" width="46" height="46" alt="RF Store" style="display:block;border:0;margin:0 0 18px">
					<p style="background:#fef2f2;border-left:4px solid #dc2626;padding:12px 14px;margin:0">${esc(text)}</p>
				</div>`,
			}),
		});
	} catch (e) {
		console.warn('[fixed] alertAdmin:', e);
	}
}

// ============================================================================
// Mercado Libre: la factura se sube a la venta (POST /packs/{pack}/fiscal_documents)
// Doc: developers.mercadolibre.com.ar/es_ar/sobre-nuestra-api/cargar-factura
// PDF de hasta 1 MB, uno por pack (sin pack, el id de la orden). ML le avisa al
// comprador por notificación y mail. NUNCA en testing: un comprobante de prueba
// no puede aparecer en una venta real.
// ============================================================================

const ML_API = 'https://api.mercadolibre.com';

async function mlPackFor(supabase: SupabaseClient, orderId: number): Promise<string | null> {
	const { data } = await supabase.from('orders').select('channel, ml_pack_id, ml_order_id').eq('id', orderId).maybeSingle();
	if (!data || data.channel !== 'ml') return null;
	return String(data.ml_pack_id || data.ml_order_id || '') || null;
}

/**
 * Receptor a partir de GET /orders/{id}/billing_info (requiere el permiso de
 * facturación de la app). Trae doc_type CI o RUT y, en additional_info, nombre
 * (o razón social) y domicilio. Si falla o no hay datos → null (consumidor final).
 */
/**
 * Lo que ML muestra en "Datos para emitir la factura", en la moneda de la venta
 * (decisión del cliente 04/11: la factura de ML es igual a esa pantalla, sin
 * cotización nuestra):
 * - precio de lista: el de la publicación pasado a la moneda de la venta con
 *   la misma conversión que usó ML (unit_price × lista / precio con promo). Si
 *   la promoción ya no es la de la venta, unit_price + descuento (gross_price).
 * - descuento: /orders/{id}/discounts, tal cual.
 * - envío: el que pagó el comprador (no está en total_amount de la orden).
 * Ojo: ML pasa el descuento a pesos con otra cotización, así que lista −
 * descuento puede dar unos pesos más que lo cobrado (04/11: 3.867,88 vs 3.864,48).
 * Si falla → null y se factura por el total, sin desglose.
 */
type MlChargeItem = { title: string; qty: number; listUnit: number; discount: number };
async function mlChargeDetail(supabase: SupabaseClient, mlOrderId: string): Promise<{ items: MlChargeItem[]; shipping: number } | null> {
	try {
		const { token } = await getValidAccessToken(supabase);
		const h = { headers: { Authorization: `Bearer ${token}` } };
		const [rd, ro] = await Promise.all([fetch(`${ML_API}/orders/${mlOrderId}/discounts`, h), fetch(`${ML_API}/orders/${mlOrderId}`, h)]);
		if (!ro.ok) return null;
		const ord: any = await ro.json().catch(() => ({}));

		const disc = new Map<string, { total: number; offers: Set<string> }>();
		if (rd.ok) {
			const d: any = await rd.json().catch(() => ({}));
			for (const det of d?.details ?? []) {
				for (const it of det?.items ?? []) {
					const id = String(it?.id ?? '');
					const cur = disc.get(id) ?? { total: 0, offers: new Set<string>() };
					cur.total += Number(it?.amounts?.total) || 0;
					if (det?.supplier?.offer_id) cur.offers.add(String(det.supplier.offer_id));
					disc.set(id, cur);
				}
			}
		}

		const items: MlChargeItem[] = [];
		for (const oi of ord?.order_items ?? []) {
			const id = String(oi?.item?.id ?? '');
			const qty = Number(oi?.quantity) || 1;
			const unit = Number(oi?.unit_price) || 0;
			const dsc = disc.get(id);
			const discount = round2(dsc?.total ?? 0);
			let listUnit = discount > 0 ? Number(oi?.gross_price) || round2(unit + discount / qty) : unit;
			if (discount > 0 && id) {
				const rs = await fetch(`${ML_API}/items/${id}/sale_price?context=channel_marketplace`, h);
				const sp: any = rs.ok ? await rs.json().catch(() => ({})) : {};
				const promo = String(sp?.metadata?.promotion_id ?? '');
				const amount = Number(sp?.amount) || 0;
				const regular = Number(sp?.regular_amount) || 0;
				if (promo && dsc?.offers.has(promo) && amount > 0 && regular > amount) listUnit = round2((unit * regular) / amount);
			}
			items.push({ title: String(oi?.item?.title ?? 'Producto'), qty, listUnit: round2(listUnit), discount });
		}

		let shipping = 0;
		for (const p of ord?.payments ?? []) if (p?.status === 'approved') shipping += Number(p?.shipping_cost) || 0;
		return { items, shipping: round2(shipping) };
	} catch {
		return null;
	}
}

async function mlBillingReceptor(supabase: SupabaseClient, mlOrderId: string): Promise<{ receptor: Receptor; source: string } | null> {
	try {
		const { token } = await getValidAccessToken(supabase);
		const r = await fetch(`${ML_API}/orders/${mlOrderId}/billing_info`, { headers: { Authorization: `Bearer ${token}` } });
		if (!r.ok) return null;
		const bi: any = (await r.json().catch(() => ({})))?.billing_info;
		if (!bi?.doc_number) return null;
		const info: Record<string, string> = {};
		for (const x of bi.additional_info ?? []) if (x?.type) info[x.type] = String(x.value ?? '').trim();
		const docType = String(bi.doc_type ?? info.DOC_TYPE ?? '').toUpperCase();
		const documento = onlyDigits(bi.doc_number);
		const nombre = info.BUSINESS_NAME || [info.FIRST_NAME, info.LAST_NAME].filter(Boolean).join(' ');
		const domicilio = [info.STREET_NAME, info.STREET_NUMBER].filter(Boolean).join(' ');
		const base = {
			documento,
			razonSocial: nombre,
			nombreComercial: nombre,
			domicilio,
			localidad: info.CITY_NAME ?? '',
			departamento: info.STATE_NAME ?? '',
			domicilioEntrega: domicilio,
			email: '',
			telefono: '',
		};
		if (docType === 'RUT' && isValidRUT(documento))
			return { receptor: { tipo: 'rut', ...base }, source: 'Datos de facturación de Mercado Libre (RUT)' };
		if (docType === 'CI' && isValidCI(documento))
			return { receptor: { tipo: 'ci', ...base }, source: 'Datos de facturación de Mercado Libre (cédula)' };
		return {
			receptor: { ...EMPTY_RECEPTOR },
			source: `Mercado Libre trajo un documento ${docType || ''} que no valida (${documento}): sale a consumidor final. Corregilo acá si hace falta.`.replace('  ', ' '),
		};
	} catch {
		return null;
	}
}

/** Sube el PDF de una venta de ML. Devuelve la fila actualizada (o la misma si no aplica). */
export async function uploadInvoiceToMl(supabase: SupabaseClient, invoiceId: number): Promise<any> {
	const { data: inv } = await supabase.from('invoices').select('*').eq('id', invoiceId).single();
	if (!inv || inv.kind !== 'venta' || !['emitida', 'aceptada'].includes(inv.status)) return inv;
	if (inv.environment !== 'produccion' || inv.ml_fiscal_document_id || !inv.url_a4) return inv;
	const pack = await mlPackFor(supabase, inv.order_id);
	if (!pack) return inv;
	const now = new Date().toISOString();
	const fail = async (msg: string) => {
		await supabase.from('invoices').update({ ml_upload_error: msg, updated_at: now }).eq('id', invoiceId);
		return { ...inv, ml_upload_error: msg };
	};
	try {
		// url_a4 es una página de Fixed que muestra el PDF (HTML, ML la rechaza):
		// el archivo en sí viene en pdfBase64 de /imprimirCFE.
		if (!inv.id_cfe) return fail('La factura no tiene idCFE para pedirle el PDF a Fixed');
		const res = await fixedCall('/imprimirCFE', { idCFE: inv.id_cfe });
		const b64 = String(res.data?.pdfBase64 ?? '').replace(/^data:[^,]*,/, '').replace(/\s/g, '');
		if (!res.ok || !b64) return fail(`Fixed no devolvió el PDF: ${explainFixed(res.code, res.description) || 'vino vacío'}`);
		const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
		if (String.fromCharCode(...bytes.slice(0, 4)) !== '%PDF') return fail('Lo que devolvió Fixed no es un PDF');
		if (bytes.byteLength > 1_000_000) return fail('El PDF pesa más de 1 MB (límite de Mercado Libre)');
		const { token } = await getValidAccessToken(supabase);
		const form = new FormData();
		const name = `${String(inv.comprobante ?? 'factura').replace(/[^\w\- ]+/g, '').trim() || 'factura'}.pdf`;
		form.append('fiscal_document', new Blob([bytes], { type: 'application/pdf' }), name);
		const r = await fetch(`${ML_API}/packs/${pack}/fiscal_documents`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}` },
			body: form,
		});
		const body: any = await r.json().catch(() => ({}));
		if (!r.ok) return fail(`Mercado Libre respondió ${r.status}: ${body?.message ?? 'sin detalle'}`);
		const docId = String(body?.ids?.[0] ?? '');
		const patch = { ml_fiscal_document_id: docId || 'subida', ml_uploaded_at: now, ml_upload_error: null, updated_at: now };
		await supabase.from('invoices').update(patch).eq('id', invoiceId);
		return { ...inv, ...patch };
	} catch (e) {
		return fail(e instanceof Error ? e.message : String(e));
	}
}

/** Al anular: saca la factura de la venta de ML (borra los archivos del pack). */
export async function removeInvoiceFromMl(supabase: SupabaseClient, invoiceId: number): Promise<void> {
	const { data: inv } = await supabase.from('invoices').select('id, order_id, ml_fiscal_document_id, environment').eq('id', invoiceId).single();
	if (!inv?.ml_fiscal_document_id || inv.environment !== 'produccion') return;
	const pack = await mlPackFor(supabase, inv.order_id);
	if (!pack) return;
	const now = new Date().toISOString();
	try {
		const { token } = await getValidAccessToken(supabase);
		const r = await fetch(`${ML_API}/packs/${pack}/fiscal_documents`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
		if (r.ok || r.status === 404) {
			await supabase.from('invoices').update({ ml_fiscal_document_id: null, ml_upload_error: null, updated_at: now }).eq('id', invoiceId);
		} else {
			const body: any = await r.json().catch(() => ({}));
			await supabase.from('invoices').update({ ml_upload_error: `No se pudo sacar de Mercado Libre (${r.status}: ${body?.message ?? ''})`, updated_at: now }).eq('id', invoiceId);
		}
	} catch (e) {
		await supabase.from('invoices').update({ ml_upload_error: `No se pudo sacar de Mercado Libre: ${e instanceof Error ? e.message : e}`, updated_at: now }).eq('id', invoiceId);
	}
}
