import { Color, OrderWithCustomer, Product, VariantProduct } from '../interfaces';
import { supabase } from '../supabase/client';

/* ====================================================================== */
/*  CLASIFICACIÓN DE ÓRDENES (panel admin)                                 */
/* ====================================================================== */

// Un "checkout sin pagar": orden de Mercado Pago que nunca se pagó. El cliente
// llegó al pago y no lo completó. NO es una venta.
export const isUnpaidMpCheckout = (o: OrderWithCustomer): boolean =>
	o.payment_method === 'mercadopago' && o.payment_status !== 'paid';

// Ventana para considerar que un checkout sin pagar fue en realidad un REINTENTO
// de una compra que el mismo cliente sí completó después (típicamente minutos).
const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

// ¿Este checkout sin pagar es un intento previo de una compra que el MISMO
// cliente sí pagó poco después? Esos NO son abandonos reales (son reintentos):
// la venta real ya aparece como orden pagada, así que este duplicado se oculta.
export const isRetryOfPaidOrder = (
	o: OrderWithCustomer,
	all: OrderWithCustomer[]
): boolean => {
	if (!isUnpaidMpCheckout(o)) return false;
	if (!o.customer_id) return false;
	const t = new Date(o.created_at).getTime();
	return all.some(x => {
		if (x.id === o.id) return false;
		if (x.customer_id !== o.customer_id) return false;
		if (x.payment_status !== 'paid') return false;
		const tx = new Date(x.created_at).getTime();
		return tx >= t && tx - t <= RETRY_WINDOW_MS;
	});
};

// Abandono REAL: checkout sin pagar y sin una compra pagada posterior del mismo
// cliente. Es lo que tiene sentido mostrar como "carrito abandonado".
export const isTrulyAbandoned = (
	o: OrderWithCustomer,
	all: OrderWithCustomer[]
): boolean => isUnpaidMpCheckout(o) && !isRetryOfPaidOrder(o, all);

// Función para formatear el precio a dólares.
// Sin decimales y redondeado hacia arriba; punto como separador de miles.
// Ej: 1121 -> "USD 1.121", 12.22 -> "USD 13".
export const formatPrice = (price: number) => {
	const formatted = new Intl.NumberFormat('es-UY', {
		minimumFractionDigits: 0,
		maximumFractionDigits: 0,
	}).format(Math.ceil(price ?? 0));
	return `USD ${formatted}`;
};

// Dinero REAL con 2 decimales, para vistas financieras (ingresos, órdenes,
// ganancia/margen). A diferencia de formatPrice, NO redondea hacia arriba:
// refleja exactamente la plata vendida/cobrada. Ej: 514.35 -> "USD 514,35".
export const formatMoney = (price: number) => {
	const formatted = new Intl.NumberFormat('es-UY', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(price ?? 0);
	return `USD ${formatted}`;
};

// Dinero real en su moneda original. UYU -> "$U 21.460,45"; USD -> "USD 188,95".
// Usamos "$U" para pesos (no "$") para que no se confunda con dólares.
export const formatMoneyCur = (price: number, currency: 'UYU' | 'USD') => {
	const formatted = new Intl.NumberFormat('es-UY', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(price ?? 0);
	return currency === 'UYU' ? `$U ${formatted}` : `USD ${formatted}`;
};

/* ====================================================================== */
/*  PRECIO "ANTES / AHORA" (sólo vidriera de RF Store)                    */
/* ====================================================================== */
// Precio tachado de referencia para la tarjeta y la ficha del producto. NO
// cambia lo que se cobra: el precio real sigue saliendo de salePrice() (costo →
// margen por tramo → IVA). Esto es un agregado de vidriera.
//
// El porcentaje se sortea entre los configurados (por defecto 5% y 10%) pero de
// forma ESTABLE por producto: sale de un hash de su id, así el mismo producto
// muestra siempre el mismo "antes" (si fuera al azar en cada render, el precio
// tachado bailaría en cada recarga y quedaría poco creíble).
//
// No aplica a Mercado Libre: allá el precio lo manejan las reglas de margen de
// ML (ml_pricing_config).
export interface CompareAtConfig {
	enabled: boolean;
	/** Porcentajes posibles; se elige uno por producto. */
	percents: number[];
}

export const DEFAULT_COMPARE_AT: CompareAtConfig = {
	enabled: false,
	percents: [5, 10],
};

// Hash estable (FNV-1a) del id del producto.
const hashId = (s: string): number => {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h >>> 0;
};

export interface CompareAtResult {
	/** Precio "antes" (tachado). */
	before: number;
	/** Descuento a mostrar, calculado sobre los dos números reales. */
	percent: number;
}

export const compareAtFor = (
	productId: string,
	price: number,
	cfg: CompareAtConfig = DEFAULT_COMPARE_AT
): CompareAtResult | null => {
	if (!cfg?.enabled) return null;
	const percents = (cfg.percents ?? []).filter(p => p > 0 && p < 90);
	if (!percents.length) return null;
	if (!price || price <= 0 || !isFinite(price)) return null;

	const pct = percents[hashId(productId || String(price)) % percents.length];
	const before = Math.round(price / (1 - pct / 100));
	if (before <= price) return null;
	// El % que se muestra sale de los números finales, no del configurado: así
	// el cartelito nunca miente por el redondeo.
	const percent = Math.round((1 - price / before) * 100);
	if (percent <= 0) return null;
	return { before, percent };
};

/* ====================================================================== */
/*  ENVÍO: una sola forma de describirlo en TODA la web                   */
/* ====================================================================== */
// Antes cada pantalla decidía por su cuenta si decía "Gratis", "A coordinar" o
// "Pago en agencia", y los mails directamente no mencionaban el envío: una
// compra al interior (orden #210, Artigas) recibía un mail con un total igual
// al subtotal, que se lee como "envío incluido". Todo pasa por acá.
//
// REGLA DEL NEGOCIO:
//  - Montevideo: se cobra por zona; GRATIS a partir de USD 150.
//  - Zona metropolitana (Canelones, llega agencia): se cobra siempre.
//  - Interior: va por DAC y lo paga el cliente al retirar. NUNCA es gratis y
//    NUNCA está incluido en el total.
export const FREE_SHIPPING_MIN_USD = 150;

export type ShippingZoneName = 'montevideo' | 'metropolitana' | 'interior';

// Sólo Montevideo tiene envío gratis por monto.
export const qualifiesForFreeShipping = (
	zone: ShippingZoneName | null,
	subtotalUsd: number,
	minUsd: number = FREE_SHIPPING_MIN_USD
): boolean => zone === 'montevideo' && subtotalUsd >= minUsd;

// ¿Este envío se le cobra al cliente en el checkout? El interior no: lo abona
// en la agencia DAC al retirar.
export const shippingIsChargedOnline = (zone: ShippingZoneName | null): boolean =>
	zone === 'montevideo' || zone === 'metropolitana';

export interface ShippingSummary {
	/** Renglón corto del resumen: "Gratis", "USD 4", "Lo abona en DAC"… */
	label: string;
	/** Zona en texto, para mails y panel: "Interior — Artigas". */
	zoneLabel: string;
	/** Aclaración de una línea. Vacía cuando no hace falta. */
	note: string;
	/** ¿El costo está sumado al total que se cobra ahora? */
	includedInTotal: boolean;
}

export const shippingZoneLabel = (
	zone: ShippingZoneName | null,
	barrio?: string | null,
	department?: string | null
): string => {
	if (zone === 'montevideo') return `Montevideo${barrio ? ` — ${barrio}` : ''}`;
	if (zone === 'metropolitana')
		return `Zona metropolitana (agencia)${barrio ? ` — ${barrio}` : ''}`;
	if (zone === 'interior') return `Interior${department ? ` — ${department}` : ''}`;
	return 'A coordinar';
};

export const shippingSummary = (opts: {
	zone: ShippingZoneName | null;
	barrio?: string | null;
	department?: string | null;
	/** Costo que efectivamente se cobra (ya con gratis/cupón aplicados). */
	costUsd: number;
	/** El envío quedó en 0 por el mínimo de compra. */
	freeByThreshold?: boolean;
	/** El envío quedó en 0 por un cupón. */
	freeByCoupon?: boolean;
}): ShippingSummary => {
	const { zone, barrio, department, costUsd, freeByThreshold, freeByCoupon } = opts;
	const zoneLabel = shippingZoneLabel(zone ?? null, barrio, department);

	if (zone === 'interior') {
		return {
			label: 'Lo abona en la agencia',
			zoneLabel,
			note: 'Envío al interior por DAC: el costo lo abona el cliente al retirar en la agencia. No está incluido en este total.',
			includedInTotal: false,
		};
	}

	if (freeByCoupon) {
		return { label: 'Gratis (cupón)', zoneLabel, note: '', includedInTotal: true };
	}

	if (zone === 'montevideo' && freeByThreshold) {
		return {
			label: 'Gratis',
			zoneLabel,
			note: `Envío gratis en Montevideo por superar los USD ${FREE_SHIPPING_MIN_USD}.`,
			includedInTotal: true,
		};
	}

	if (zone === 'metropolitana') {
		return {
			label: costUsd > 0 ? formatPrice(costUsd) : 'A coordinar',
			zoneLabel,
			note: 'Llega por agencia a domicilio, misma tarifa que Montevideo.',
			includedInTotal: costUsd > 0,
		};
	}

	if (zone === 'montevideo') {
		return {
			label: costUsd > 0 ? formatPrice(costUsd) : 'Elegí tu barrio',
			zoneLabel,
			note: '',
			includedInTotal: costUsd > 0,
		};
	}

	return { label: 'A coordinar', zoneLabel, note: '', includedInTotal: false };
};

/* ====================================================================== */
/*  BÚSQUEDA: normalización única para TODOS los buscadores               */
/* ====================================================================== */
// Minúsculas y sin acentos: tiene que coincidir con lo que guarda Postgres en
// products.search_text y en products_with_price.search_blob (immutable_unaccent
// + lower). Si esto y la base se desincronizan, buscar "microfono" deja de
// encontrar "Micrófono".
export const normalizeSearch = (s: string) =>
	s
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.trim();

// Escapa los comodines de LIKE para que un término con % o _ no traiga medio
// catálogo (ej: alguien busca "50%").
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, m => `\\${m}`);

// Término del usuario -> palabras normalizadas y escapadas. La regla es la
// misma en toda la web: TODAS las palabras tienen que aparecer, en cualquier
// orden. Ej: "asus vivobook" encuentra "Notebook Asus 15,6 Vivobook Go".
export const searchWords = (term: string): string[] =>
	normalizeSearch(term)
		.split(/\s+/)
		.filter(Boolean)
		.map(escapeLike);

/* ====================================================================== */
/*  ¿SE COMPRA ONLINE O ES POR CONSULTA?                                  */
/* ====================================================================== */
// Regla única de toda la tienda (tarjeta, ficha, carrito y checkout):
//   - CDR (source='cdr'): pago online siempre.
//   - Manual (source='local'): pago online SÓLO si el admin prendió
//     `online_payment` en el producto; si no, WhatsApp.
//   - `paymentsEnabled` es el interruptor global del panel: apagado, todo
//     vuelve a ser consulta.
// El servidor repite esta misma validación (place_cdr_order y
// mp-create-preference), así que tocar sólo el front no habilita nada.
export const canBuyOnline = (
	product: { source?: string | null; online_payment?: boolean | null },
	paymentsEnabled: boolean
): boolean =>
	paymentsEnabled &&
	(product.source === 'cdr' || product.online_payment === true);

/* ====================================================================== */
/*  PRECIOS: margen por tramo (sobre el costo) + IVA -> precio de venta   */
/* ====================================================================== */
export interface PricingTier {
	// Tramo aplica cuando el costo es <= max (tope INCLUSIVO). max=null => "en adelante".
	// Ej.: max=18 incluye el 18 en este tramo; el siguiente arranca en 19.
	max: number | null;
	pct: number;
}

export interface PricingConfig {
	iva_percent: number;
	tiers: PricingTier[];
}

// Debe coincidir con la función SQL public.rf_sale_price y el default en app_settings.
export const DEFAULT_PRICING: PricingConfig = {
	iva_percent: 22,
	tiers: [
		{ max: 10, pct: 50 },
		{ max: 50, pct: 30 },
		{ max: 100, pct: 20 },
		{ max: null, pct: 15 },
	],
};

// Devuelve el margen (%) que corresponde a un costo dado.
export const marginForCost = (cost: number, cfg: PricingConfig): number => {
	for (const tier of cfg.tiers) {
		if (tier.max === null) return tier.pct;
		if (cost <= tier.max) return tier.pct;
	}
	return 0;
};

// Margen (%) efectivo de un producto en la WEB: el manual del producto si tiene,
// si no el tramo que le toca por costo. Un margen manual de 0 es válido (vender
// al costo + IVA), así que sólo null/undefined/NaN significan "automático".
export const hasMarginOverride = (
	override: number | null | undefined
): override is number =>
	override !== null && override !== undefined && !isNaN(Number(override));

export const webMarginFor = (
	cost: number,
	cfg: PricingConfig,
	override?: number | null
): number => {
	if (hasMarginOverride(override)) return Number(override);
	const ivaCost = cost * (1 + cfg.iva_percent / 100);
	return marginForCost(ivaCost, cfg);
};

// Costo (sin IVA) -> precio final de venta (margen por tramo + IVA).
// Redondeado SIEMPRE hacia arriba al entero (sin decimales). Ej: 12.22 -> 13.
// `override` = margen manual del producto (products.margin_override_percent):
// si viene, se saltea la tabla de tramos. Debe coincidir con la función SQL
// public.rf_sale_price(cost, override).
export const salePrice = (
	cost: number | null | undefined,
	cfg: PricingConfig = DEFAULT_PRICING,
	override?: number | null
): number => {
	if (cost === null || cost === undefined || isNaN(cost)) return 0;
	// El tramo del margen se decide por el costo CON IVA (no el costo base), igual que ML.
	// Solo elige el tramo; el precio final se calcula con el costo real.
	const pct = webMarginFor(cost, cfg, override);
	const final = cost * (1 + pct / 100) * (1 + cfg.iva_percent / 100);
	return Math.ceil(final);
};

// Inversa de salePrice: dado el precio final que quiere el admin, qué margen (%)
// hay que guardar. Se usa en el form del producto para que pueda tipear el TOTAL
// y ver el margen, o al revés. Devuelve null si el costo no sirve como base.
// Sólo necesita el IVA: el margen es justamente lo que se despeja. Por eso acepta
// tanto la PricingConfig de la web como la de ML (las dos tienen iva_percent).
export const marginForSalePrice = (
	cost: number | null | undefined,
	target: number | null | undefined,
	cfg: { iva_percent: number } = DEFAULT_PRICING
): number | null => {
	const c = Number(cost ?? 0);
	const t = Number(target ?? 0);
	if (!c || c <= 0 || !t || t <= 0 || isNaN(c) || isNaN(t)) return null;
	const withIva = c * (1 + cfg.iva_percent / 100);
	const pct = (t / withIva - 1) * 100;
	// Dos decimales: el redondeo hacia arriba de salePrice hace que varios
	// márgenes den el mismo total, así que no hace falta más precisión.
	return Math.max(0, Math.round(pct * 100) / 100);
};

// Precio ML: 30% margen + IVA. Si costo > umbral USD => USD; sino UYU al BROU.
export interface MlPriceResult {
	price: number;
	currency: 'USD' | 'UYU';
}
export const mlPrice = (
	costUsd: number | null | undefined,
	fxRate: number,
	opts: { markupPercent?: number; ivaPercent?: number; usdThreshold?: number } = {}
): MlPriceResult => {
	const cost = Number(costUsd ?? 0);
	if (!cost || cost <= 0 || !fxRate || fxRate <= 0) return { price: 0, currency: 'UYU' };
	const markup = opts.markupPercent ?? 30;
	const iva = opts.ivaPercent ?? 22;
	const threshold = opts.usdThreshold ?? 100;
	const withMarkupIva = cost * (1 + markup / 100) * (1 + iva / 100);
	// Precio redondo: siempre entero hacia arriba, sin decimales/milesimas.
	if (cost > threshold) return { price: Math.ceil(withMarkupIva), currency: 'USD' };
	return { price: Math.ceil(withMarkupIva * fxRate), currency: 'UYU' };
};

/* ====================================================================== */
/*  PRECIOS ML: reglas configurables (tramos por costo + override por      */
/*  categoría/subcategoría). El IVA y la regla USD/UYU se mantienen.        */
/*  Debe coincidir con la resolución de margen en la edge ml-publish-item. */
/* ====================================================================== */
export interface MlPricingConfig {
	iva_percent: number;
	usd_threshold: number; // si el costo USD supera esto, el precio ML va en USD; sino UYU al BROU
	tiers: PricingTier[]; // margen por tramo de costo (fallback)
	category_overrides: Record<string, number>; // category_id -> margen %
	subcategory_overrides: Record<string, number>; // subcategory_id -> margen %
}

// Default = comportamiento histórico (margen plano 30% + IVA 22% + umbral USD 100).
export const DEFAULT_ML_PRICING: MlPricingConfig = {
	iva_percent: 22,
	usd_threshold: 100,
	tiers: [{ max: null, pct: 30 }],
	category_overrides: {},
	subcategory_overrides: {},
};

// Margen ML (%) para un producto.
// Precedencia: margen manual del producto > subcategoría > categoría > tramo por costo.
// El margen manual es el mismo valor que usa la web (products.margin_override_percent):
// cuando el admin fija un precio a mano, rige en los dos canales.
export const mlMarginFor = (
	cost: number,
	categoryId: string | null | undefined,
	subcategoryId: string | null | undefined,
	cfg: MlPricingConfig,
	override?: number | null
): number => {
	if (hasMarginOverride(override)) return Number(override);
	if (subcategoryId && cfg.subcategory_overrides && cfg.subcategory_overrides[subcategoryId] != null) {
		return Number(cfg.subcategory_overrides[subcategoryId]);
	}
	if (categoryId && cfg.category_overrides && cfg.category_overrides[categoryId] != null) {
		return Number(cfg.category_overrides[categoryId]);
	}
	// El tramo del margen ML se decide por el costo CON IVA (no el costo base), igual que
	// las edge functions ml-reprice-active / ml-publish-item. Los tramos se piensan en
	// precio con IVA: ej. costo 15.8 → 15.8×1.22=19.27 → entra al tramo 19–25.
	const ivaCost = cost * (1 + cfg.iva_percent / 100);
	return marginForCost(ivaCost, { iva_percent: cfg.iva_percent, tiers: cfg.tiers });
};

// Precio ML usando las reglas configurables. Misma regla USD/UYU por umbral que mlPrice.
export const mlPriceFromConfig = (
	costUsd: number | null | undefined,
	fxRate: number,
	categoryId: string | null | undefined,
	subcategoryId: string | null | undefined,
	cfg: MlPricingConfig,
	override?: number | null
): MlPriceResult => {
	const cost = Number(costUsd ?? 0);
	if (!cost || cost <= 0 || !fxRate || fxRate <= 0) return { price: 0, currency: 'UYU' };
	const markup = mlMarginFor(cost, categoryId, subcategoryId, cfg, override);
	const withMarkupIva = cost * (1 + markup / 100) * (1 + cfg.iva_percent / 100);
	// Precio redondo: siempre entero hacia arriba, sin decimales/milesimas.
	if (cost > cfg.usd_threshold) return { price: Math.ceil(withMarkupIva), currency: 'USD' };
	return { price: Math.ceil(withMarkupIva * fxRate), currency: 'UYU' };
};

export const formatPriceCurrency = (price: number, currency: 'USD' | 'UYU'): string => {
	if (currency === 'UYU') {
		return `$U ${new Intl.NumberFormat('es-UY', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(price)}`;
	}
	return `USD ${new Intl.NumberFormat('es-UY', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.ceil(price))}`;
};

/* ====================================================================== */
/*  PUBLICABILIDAD EN ML: checklist por producto. Dice si está 100% listo  */
/*  para publicar y, si no, qué le falta (para que el cliente lo complete). */
/*  Los "hard" son los que la edge ml-publish-item / ML rechazan si faltan; */
/*  los "recomendados" mejoran la publicación pero no la bloquean.          */
/* ====================================================================== */
export interface MlReadinessCheck {
	key: string;
	label: string;
	ok: boolean;
	hard: boolean; // true => si falta, NO se puede publicar
}

export interface MlReadiness {
	canPublish: boolean; // todos los "hard" cumplidos
	percent: number; // % del checklist completo cumplido
	checks: MlReadinessCheck[];
	missing: MlReadinessCheck[];
	missingHard: MlReadinessCheck[];
}

interface ReadinessProductInput {
	active?: boolean | null;
	price_usd?: number | null;
	images?: unknown[] | null;
	brand_id?: string | null;
	category_id?: string | null;
	variants?: ({ stock?: number | null } | null)[] | null;
}

// stockThreshold = ml_stock_threshold (la edge function exige stock > umbral; default 3).
export const getMlReadiness = (
	product: ReadinessProductInput,
	stockThreshold = 3
): MlReadiness => {
	const stock = Number(product.variants?.[0]?.stock ?? 0);
	const cost = Number(product.price_usd ?? 0);
	const checks: MlReadinessCheck[] = [
		{ key: 'active', label: 'Activo', ok: !!product.active, hard: true },
		{ key: 'cost', label: 'Costo', ok: cost > 0, hard: true },
		{ key: 'stock', label: 'Stock', ok: stock > stockThreshold, hard: true },
		{ key: 'images', label: 'Imágenes', ok: (product.images?.length ?? 0) >= 1, hard: true },
		{ key: 'brand', label: 'Marca', ok: !!product.brand_id, hard: false },
		{ key: 'category', label: 'Categoría', ok: !!product.category_id, hard: false },
	];
	const done = checks.filter(c => c.ok).length;
	const percent = Math.round((done / checks.length) * 100);
	const missing = checks.filter(c => !c.ok);
	const missingHard = missing.filter(c => c.hard);
	return { canPublish: missingHard.length === 0, percent, checks, missing, missingHard };
};

// Función para preparar los productos - (CELULARES)
export const prepareProducts = (products: Product[]) => {
	return products.map(product => {
		// Agrupar las variantes por color
		const colors = product.variants.reduce(
			(acc: Color[], variant: VariantProduct) => {
				const existingColor = acc.find(
					item => item.color === variant.color
				);

				if (existingColor) {
					// Si ya existe el color, comparamos los precios
					existingColor.price = Math.min(
						existingColor.price,
						variant.price
					);
				} // Mantenemos el precio mínimo
				else {
					acc.push({
						color: variant.color,
						price: variant.price,
						name: variant.color_name,
					});
				}

				return acc;
			},
			[]
		);

		// Obtener el precio más bajo de las variantes agrupadas
		const price = Math.min(...colors.map(item => item.price));

		// Devolver el producto formateado
		return {
			...product,
			price,
			colors: colors.map(({ name, color }) => ({ name, color })),
			variants: product.variants,
			brandName: (product as any).brand?.name,
			categoryName: (product as any).category?.name,
			source: (product as any).source ?? 'local',
			external_code: (product as any).external_code ?? null,
			online_payment: (product as any).online_payment === true,
		};
	});
};

// Función para formatear la fecha a formato 3 de enero de 2022
export const formatDateLong = (date: string): string => {
	const dateObject = new Date(date);

	return dateObject.toLocaleDateString('es-ES', {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	});
};

// Sólo la hora, para acompañar a la fecha en los listados: "13:49".
// Se muestra en la hora local del navegador (en Uruguay, UTC-3): en la base los
// timestamps van en UTC, así que la orden de las 10:49 figuraba como 13:49.
export const formatTimeShort = (date: string): string =>
	new Date(date).toLocaleTimeString('es-UY', {
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	});

// Función para formatear la fecha a formato dd/mm/yyyy
export const formatDate = (date: string): string => {
	const dateObject = new Date(date);
	return dateObject.toLocaleDateString('es-ES', {
		year: 'numeric',
		month: '2-digit',
		day: 'numeric',
	});
};

// Función para obtener el estado del pedido en español
export const getStatus = (status: string): string => {
	switch (status) {
		case 'Pending':
			return 'Pendiente';
		case 'Paid':
			return 'Pagado';
		case 'Shipped':
			return 'Enviado';
		case 'Delivered':
			return 'Entregado';
		default:
			return status;
	}
};

// Estilos de badge según el estado de la orden (panel admin). Contempla los dos
// juegos de estados que conviven: los que pone el ADMIN a mano (Cotización,
// Concretado, Modificado, Cancelado) y los que pone el SISTEMA al cobrar o
// vencer un pedido (pagado, pago_pendiente, expirado, rechazado).
export const orderStatusBadge = (status: string): string => {
	switch (status) {
		case 'Concretado':
		case 'pagado':
			return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200';
		case 'Cancelado':
		case 'rechazado':
			return 'bg-rose-50 text-rose-700 ring-1 ring-rose-200';
		case 'Modificado':
		case 'pago_pendiente':
			return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200';
		case 'Cotización':
			return 'bg-brand-50 text-brand-700 ring-1 ring-brand-200';
		case 'expirado':
			return 'bg-ink-100 text-ink-600 ring-1 ring-ink-200';
		default:
			return 'bg-ink-100 text-ink-700 ring-1 ring-ink-200';
	}
};

// Estados que el admin puede elegir a mano.
export const orderStatusOptions = [
	'Cotización',
	'Concretado',
	'Modificado',
	'Cancelado',
];

/**
 * Texto legible de un estado. Los que pone el sistema vienen en minúscula y con
 * guión bajo; sin esto, la ficha de la orden mostraba "pago_pendiente" crudo.
 */
export const orderStatusLabel = (status: string): string => {
	switch (status) {
		case 'pagado':
			return 'Pagado';
		case 'pago_pendiente':
			return 'Pago pendiente';
		case 'expirado':
			return 'Expirado';
		case 'rechazado':
			return 'Rechazado';
		default:
			return status;
	}
};

// Función para formatear fecha y hora: 4 may 2026, 17:32
export const formatDateTime = (date: string): string => {
	const d = new Date(date);
	return d.toLocaleString('es-UY', {
		day: '2-digit',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
};

/* Teléfonos uruguayos: el cliente los escribe como se le canta (099 541 776,
   099541776, +598 99 541 776...). Normalizamos a formato internacional sin el +
   para armar el link de WhatsApp / la llamada. Devuelve null si no parece un
   número usable. */
export const normalizePhoneUy = (raw: string | null | undefined): string | null => {
	if (!raw) return null;
	let d = raw.replace(/\D/g, '');
	if (!d) return null;
	// 00598... (prefijo internacional viejo)
	if (d.startsWith('00')) d = d.slice(2);
	// Ya viene con código de país
	if (d.startsWith('598')) d = d.slice(3);
	// Nacional con 0 adelante: 099... / 02...
	if (d.startsWith('0')) d = d.slice(1);
	// Celular (8 dígitos: 9XXXXXXX) o fijo de Montevideo (7 dígitos)
	if (d.length < 7 || d.length > 11) return null;
	return `598${d}`;
};

// Teléfono lindo para mostrar: 099 541 776 / 2 500 12 34
export const formatPhoneUy = (raw: string | null | undefined): string => {
	const n = normalizePhoneUy(raw);
	if (!n) return raw ?? '';
	const local = n.slice(3);
	if (local.length === 8 && local.startsWith('9'))
		return `0${local.slice(0, 2)} ${local.slice(2, 5)} ${local.slice(5)}`;
	return `0${local}`;
};

// Link directo al chat de WhatsApp (con mensaje opcional ya escrito).
export const whatsappLink = (
	raw: string | null | undefined,
	message?: string
): string | null => {
	const n = normalizePhoneUy(raw);
	if (!n) return null;
	return `https://wa.me/${n}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
};

// Función para generar el slug de un producto
export const generateSlug = (name: string): string => {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/(^-|-$)/g, '');
};

// Función para generar un slug único
export const generateUniqueSlug = async (name: string, existingSlug?: string): Promise<string> => {
	let baseSlug = generateSlug(name);
	let uniqueSlug = baseSlug;
	let counter = 1;

	// Si es el mismo slug existente, no necesitamos verificar duplicados
	if (existingSlug === baseSlug) {
		return baseSlug;
	}

	// Verificar si el slug ya existe y generar uno único
	while (counter <= 100) { // Limitar a 100 intentos para evitar loops infinitos
		try {
			const { data, error } = await supabase
				.from('products')
				.select('id')
				.eq('slug', uniqueSlug)
				.single();

			// Si no hay error y hay datos, significa que el slug existe
			if (!error && data) {
				uniqueSlug = `${baseSlug}-${counter}`;
				counter++;
			} else {
				// El slug es único
				break;
			}
		} catch (error) {
			// Si hay error, significa que el slug no existe o hay un problema de conexión
			console.warn('Error checking slug uniqueness:', error);
			break;
		}
	}

	return uniqueSlug;
};

// Función para extraer el path relativo al bucket de una URL
export const extractFilePath = (url: string) => {
	// Si es una URL de placeholder o no es una URL válida de Supabase, retornar null
	if (!url || url.includes('placeholder.svg') || !url.includes('/storage/v1/object/public/product-images/')) {
		return null;
	}

	const parts = url.split(
		'/storage/v1/object/public/product-images/'
	);
	// EJEMPLO PARTS: ['/storage/v1/ object/public/product-images/', '02930920302302030293023-iphone-12-pro-max.jpg']

	if (parts.length !== 2) {
		return null;
	}

	return parts[1];
};
