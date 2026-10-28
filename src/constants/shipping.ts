// Envíos por departamento (desde 27/10/2026, reemplaza las zonas de PQuick).
//
//   Montevideo  tarifa fija (USD 6) · comprando antes de las 15 h llega en el día
//   Canelones   tarifa fija (USD 8) · ídem
//   resto       DAC: lo abona el cliente al retirar, nunca entra en el total
//   gratis desde USD 150 en Montevideo y Canelones
//
// Los valores viven en app_settings.shipping_rates y se editan en el panel
// (/dashboard/envios). El costo que se COBRA lo calcula el servidor
// (rf_shipping_quote); acá sólo se muestra.

export const URUGUAY_DEPARTMENTS: string[] = [
	'Montevideo', 'Canelones', 'Artigas', 'Cerro Largo', 'Colonia', 'Durazno',
	'Flores', 'Florida', 'Lavalleja', 'Maldonado', 'Paysandú', 'Río Negro',
	'Rivera', 'Rocha', 'Salto', 'San José', 'Soriano', 'Tacuarembó',
	'Treinta y Tres',
];

// 'metropolitana' ya no se genera: queda sólo en órdenes viejas (PQuick).
export type ShippingZoneName = 'montevideo' | 'canelones' | 'metropolitana' | 'interior';

export interface ShippingRates {
	montevideo_usd: number;
	canelones_usd: number;
	/** Envío gratis a partir de este subtotal. 0 = sin envío gratis. */
	free_min_usd: number;
	/** El envío gratis también vale en Canelones. */
	free_includes_canelones: boolean;
	/** Hora (Uruguay) hasta la que una compra en día hábil llega en el día. */
	same_day_cutoff_hour: number;
}

export const DEFAULT_SHIPPING_RATES: ShippingRates = {
	montevideo_usd: 6,
	canelones_usd: 8,
	free_min_usd: 150,
	free_includes_canelones: false,
	same_day_cutoff_hour: 15,
};

// Sin mayúsculas, tildes ni espacios de más: igual que rf_shipping_quote.
const normalizeDept = (s: string) =>
	s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** El departamento con su nombre canónico ("paysandu" → "Paysandú"), o null. */
export const canonicalDepartment = (department: string | null | undefined): string | null => {
	if (!department) return null;
	const key = normalizeDept(department);
	return URUGUAY_DEPARTMENTS.find(d => normalizeDept(d) === key) ?? null;
};

export const zoneForDepartment = (department: string | null | undefined): ShippingZoneName | null => {
	const dept = canonicalDepartment(department);
	if (!dept) return null;
	if (dept === 'Montevideo') return 'montevideo';
	if (dept === 'Canelones') return 'canelones';
	return 'interior';
};

/** Montevideo y Canelones: llega a domicilio, se cobra en el checkout y lleva barrio. */
export const isLocalDelivery = (zone: ShippingZoneName | null): boolean =>
	zone === 'montevideo' || zone === 'canelones';

export interface ShippingQuote {
	zone: ShippingZoneName | null;
	/** Tarifa de la zona, antes del envío gratis. */
	baseUsd: number;
	/** Lo que se cobra (0 si es gratis o interior). */
	shippingUsd: number;
	freeByThreshold: boolean;
}

// Misma regla que rf_shipping_quote en la base.
export const quoteShipping = (
	department: string | null | undefined,
	subtotalUsd: number,
	rates: ShippingRates
): ShippingQuote => {
	const zone = zoneForDepartment(department);
	if (!isLocalDelivery(zone)) {
		return { zone, baseUsd: 0, shippingUsd: 0, freeByThreshold: false };
	}
	const baseUsd = zone === 'montevideo' ? rates.montevideo_usd : rates.canelones_usd;
	const freeApplies = zone === 'montevideo' || rates.free_includes_canelones;
	const freeByThreshold =
		freeApplies && rates.free_min_usd > 0 && subtotalUsd >= rates.free_min_usd;
	return { zone, baseUsd, shippingUsd: freeByThreshold ? 0 : baseUsd, freeByThreshold };
};

/** ¿El envío gratis por monto aplica en esta zona? */
export const freeShippingAppliesTo = (zone: ShippingZoneName | null, rates: ShippingRates): boolean =>
	rates.free_min_usd > 0 &&
	(zone === 'montevideo' || (zone === 'canelones' && rates.free_includes_canelones));

// Hora y día de la semana en Uruguay, sin depender del huso del navegador.
const uruguayNow = (now: Date) => {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: 'America/Montevideo',
		weekday: 'short',
		hour: 'numeric',
		hourCycle: 'h23',
	}).formatToParts(now);
	const weekday = parts.find(p => p.type === 'weekday')?.value ?? '';
	const hour = Number(parts.find(p => p.type === 'hour')?.value ?? 0);
	return { weekday, hour };
};

/**
 * Aviso de entrega para Montevideo y Canelones. Sólo días hábiles: de lunes a
 * viernes antes de la hora de corte llega hoy; después, el siguiente día hábil.
 * Los feriados no se detectan solos.
 */
export const deliveryEtaText = (cutoffHour: number, now: Date = new Date()): string => {
	const { weekday, hour } = uruguayNow(now);
	const businessDay = !['Sat', 'Sun'].includes(weekday);
	if (businessDay && hour < cutoffHour) {
		return `Comprando antes de las ${cutoffHour} h, tu pedido llega hoy.`;
	}
	const next = weekday === 'Fri' || weekday === 'Sat' || weekday === 'Sun' ? 'el lunes' : 'mañana';
	return `Tu pedido llega ${next} (las compras antes de las ${cutoffHour} h de días hábiles llegan en el día).`;
};
