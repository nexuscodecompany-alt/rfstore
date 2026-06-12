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

// Dinero real en su moneda original. UYU -> "$ 21.460,45"; USD -> "USD 188,95".
export const formatMoneyCur = (price: number, currency: 'UYU' | 'USD') => {
	const formatted = new Intl.NumberFormat('es-UY', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(price ?? 0);
	return currency === 'UYU' ? `$ ${formatted}` : `USD ${formatted}`;
};

/* ====================================================================== */
/*  PRECIOS: margen por tramo (sobre el costo) + IVA -> precio de venta   */
/* ====================================================================== */
export interface PricingTier {
	// Tramo aplica cuando el costo es < max. max=null => "en adelante".
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
		if (cost < tier.max) return tier.pct;
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
	const pct = marginForCost(cost, cfg);
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
	if (cost > threshold) return { price: Math.round(withMarkupIva * 100) / 100, currency: 'USD' };
	return { price: Math.round(withMarkupIva * fxRate), currency: 'UYU' };
};

export const formatPriceCurrency = (price: number, currency: 'USD' | 'UYU'): string => {
	if (currency === 'UYU') {
		return `$ ${new Intl.NumberFormat('es-UY', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(price)}`;
	}
	return `USD ${new Intl.NumberFormat('es-UY', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.ceil(price))}`;
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
