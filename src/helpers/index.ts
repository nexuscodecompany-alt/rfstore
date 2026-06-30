import { Color, Product, VariantProduct } from '../interfaces';
import { supabase } from '../supabase/client';

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

// Costo (sin IVA) -> precio final de venta (margen por tramo + IVA).
// Redondeado SIEMPRE hacia arriba al entero (sin decimales). Ej: 12.22 -> 13.
export const salePrice = (
	cost: number | null | undefined,
	cfg: PricingConfig = DEFAULT_PRICING
): number => {
	if (cost === null || cost === undefined || isNaN(cost)) return 0;
	// El tramo del margen se decide por el costo CON IVA (no el costo base), igual que ML.
	// Solo elige el tramo; el precio final se calcula con el costo real. Debe coincidir
	// con la función SQL public.rf_sale_price.
	const ivaCost = cost * (1 + cfg.iva_percent / 100);
	const pct = marginForCost(ivaCost, cfg);
	const final = cost * (1 + pct / 100) * (1 + cfg.iva_percent / 100);
	return Math.ceil(final);
};

// Precio ML: 30% margen + IVA. Si costo > umbral USD => USD; sino UYU al BCU.
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
	usd_threshold: number; // si el costo USD supera esto, el precio ML va en USD; sino UYU al BCU
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

// Margen ML (%) para un producto. Precedencia: subcategoría > categoría > tramo por costo.
export const mlMarginFor = (
	cost: number,
	categoryId: string | null | undefined,
	subcategoryId: string | null | undefined,
	cfg: MlPricingConfig
): number => {
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
	cfg: MlPricingConfig
): MlPriceResult => {
	const cost = Number(costUsd ?? 0);
	if (!cost || cost <= 0 || !fxRate || fxRate <= 0) return { price: 0, currency: 'UYU' };
	const markup = mlMarginFor(cost, categoryId, subcategoryId, cfg);
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

// Estilos de badge según el estado de la orden (panel admin)
export const orderStatusBadge = (status: string): string => {
	switch (status) {
		case 'Concretado':
			return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200';
		case 'Cancelado':
			return 'bg-rose-50 text-rose-700 ring-1 ring-rose-200';
		case 'Modificado':
			return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200';
		case 'Cotización':
			return 'bg-brand-50 text-brand-700 ring-1 ring-brand-200';
		default:
			return 'bg-ink-100 text-ink-700 ring-1 ring-ink-200';
	}
};

export const orderStatusOptions = [
	'Cotización',
	'Concretado',
	'Modificado',
	'Cancelado',
];

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
