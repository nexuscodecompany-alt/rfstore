// Zonas de envío en Montevideo (basado en soyunaganga).
// Cada zona pertenece a un "tier" de precio (centro / periferia / costa)
// que se configura en app_settings.shipping_rates.

export type ShippingTier = 'centro' | 'periferia' | 'costa';

export interface MontevideoZone {
	id: string;
	tier: ShippingTier;
	barrios: string[];
}

export const MONTEVIDEO_ZONES: MontevideoZone[] = [
	{
		id: 'zona_5',
		tier: 'centro',
		barrios: [
			'Buceo', 'Carrasco', 'Carrasco Norte', 'Flor de Maroñas',
			'Las Canteras', 'Malvín', 'Malvín Norte', 'Maroñas',
			'Maroñas Curva', 'Playa Verde', 'Pocitos Nuevo', 'Puerto Buceo',
			'Punta Gorda', 'Unión',
		],
	},
	{
		id: 'zona_6',
		tier: 'centro',
		barrios: [
			'Aguada', 'Barrio Sur', 'Centro', 'Ciudad Vieja', 'Cordón',
			'Goes', 'Jacinto Vera', 'La Blanqueada', 'La Comercial',
			'La Figurita', 'Larrañaga', 'Palermo', 'Parque Batlle',
			'Parque Rodó', 'Pocitos', 'Punta Carretas', 'Reducto',
			'Tres Cruces', 'Villa Biarritz', 'Villa Dolores', 'Villa Muñoz',
		],
	},
	{
		id: 'zona_7',
		tier: 'centro',
		barrios: [
			'Aires Puros', 'Arroyo Seco', 'Atahualpa', 'Belvedere',
			'Brazo Oriental', 'Bella Vista', 'Capurro', 'Casavalle',
			'Castro', 'Pérez Castellanos', 'Cerrito', 'Ituzaingó',
			'Jardines Hipódromo', 'La Teja', 'Paso Molino',
			'Cementerio del Norte', 'Las Acacias', 'Marconi', 'Bolívar',
			'Paso de las Duranas', 'Lavalleja', 'Peñarol', 'Piedras Blancas',
			'Prado', 'Sayago', 'Villa Española',
		],
	},
	{
		id: 'zona_1',
		tier: 'periferia',
		barrios: [
			'Casabó', 'Cerro', 'La Paloma', 'Tomkinson', 'Nuevo París',
			'Pajas Blancas', 'Paso de la Arena', 'Punta Espinillo',
			'Santiago Vázquez', 'Tres Ombúes', 'Victoria', 'Villa del Cerro',
		],
	},
	{
		id: 'zona_2',
		tier: 'periferia',
		barrios: [
			'Abayubá', 'Colón', 'Cuchilla Pereira', 'Conciliación',
			'Lezica', 'Melilla',
		],
	},
	{
		id: 'zona_3',
		tier: 'periferia',
		barrios: ['Manga', 'Toledo Chico', 'Villa García'],
	},
	{
		id: 'zona_4',
		tier: 'periferia',
		barrios: [
			'Bañados de Carrasco', 'Bella Italia', 'Chacarita', 'Punta Rieles',
		],
	},
	{
		id: 'zona_8',
		tier: 'costa',
		barrios: ['La Paz', 'Las Piedras', 'Progreso'],
	},
	{
		id: 'zona_9',
		tier: 'costa',
		barrios: [
			'Barros Blancos', 'Casarino', 'Cumbres de Carrasco',
			'Joaquín Suárez', 'Pando', 'Rincón de Carrasco', 'Suárez', 'Toledo',
		],
	},
	{
		id: 'zona_10',
		tier: 'costa',
		barrios: [
			'Aeropuerto de Carrasco', 'Barra de Carrasco', 'Ciudad de la Costa',
			'Colinas de la Costa', 'Colinas de Solymar', 'El Bosque',
			'El Dorado', 'El Pinar', 'Empalme Nicolich', 'La Tahona',
			'Lagomar', 'Lomas de Carrasco', 'Lomas de Solymar',
			'Médanos de Solymar', 'Montes de Solymar', 'Parque Carrasco',
			'Parque de Solymar', 'Parque Miramar', 'Paso de Carrasco',
			'Pinares de Solymar', 'San José de Carrasco', 'Shangrilá',
			'Solymar', 'Villa Aeroparque',
		],
	},
	{
		id: 'zona_11',
		tier: 'costa',
		barrios: ['Ciudad de Canelones'],
	},
];

export const URUGUAY_DEPARTMENTS_INTERIOR: string[] = [
	'Artigas', 'Canelones', 'Cerro Largo', 'Colonia', 'Durazno',
	'Flores', 'Florida', 'Lavalleja', 'Maldonado', 'Paysandú',
	'Río Negro', 'Rivera', 'Rocha', 'Salto', 'San José',
	'Soriano', 'Tacuarembó', 'Treinta y Tres',
];

const normalize = (s: string) =>
	s
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.trim();

// Devuelve la zona (id + tier) según el barrio, o null si no matchea.
export const findZoneByBarrio = (
	barrio: string
): { zoneId: string; tier: ShippingTier; barrio: string } | null => {
	if (!barrio) return null;
	const target = normalize(barrio);

	// Exacto primero
	for (const z of MONTEVIDEO_ZONES) {
		for (const b of z.barrios) {
			if (normalize(b) === target) {
				return { zoneId: z.id, tier: z.tier, barrio: b };
			}
		}
	}
	// Contains (parcial)
	for (const z of MONTEVIDEO_ZONES) {
		for (const b of z.barrios) {
			const nb = normalize(b);
			if (nb.includes(target) || target.includes(nb)) {
				return { zoneId: z.id, tier: z.tier, barrio: b };
			}
		}
	}
	return null;
};

// Lista plana de todos los barrios para el autocomplete.
export const ALL_BARRIOS: { name: string; zoneId: string; tier: ShippingTier }[] =
	MONTEVIDEO_ZONES.flatMap(z =>
		z.barrios.map(b => ({ name: b, zoneId: z.id, tier: z.tier }))
	);

// Busca barrios por substring para autocomplete.
export const searchBarrios = (q: string, limit = 8) => {
	const target = normalize(q);
	if (target.length < 1) return [];
	return ALL_BARRIOS.filter(b => normalize(b.name).includes(target)).slice(0, limit);
};

export interface ShippingRates {
	montevideo: {
		centro: number; // UYU
		periferia: number;
		costa: number;
	};
	interior_uyu: number; // 0 = se cobra en DAC al retirar
}

export const DEFAULT_SHIPPING_RATES: ShippingRates = {
	montevideo: { centro: 167, periferia: 200, costa: 290 },
	interior_uyu: 0,
};
