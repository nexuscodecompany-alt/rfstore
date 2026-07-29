import { supabase } from '../supabase/client';

/* ------------------------------------------------------------------ */
/*  Configuración de la HOME editable desde el panel de admin.        */
/*  Todo vive en app_settings.key = 'home_config' (un único JSON).    */
/*  Las imágenes se suben al bucket 'product-images' bajo 'home/'.    */
/* ------------------------------------------------------------------ */

export interface HomeSlide {
	id: string;
	image: string; // versión desktop (1920×700)
	/** Versión mobile (800×400). Si falta, se usa `image` también en mobile. */
	image_mobile?: string;
	link: string; // a dónde lleva el slide (ej. /tienda?category=<id>)
	alt: string;
}

export interface HomeCategoryTile {
	category_id: string;
	image: string;
	label?: string; // opcional: sobreescribe el nombre de la categoría
	link?: string; // opcional: link custom (ej. WhatsApp). Si vacío, va a la categoría.
}

export interface HomeBanner3D {
	enabled: boolean;
	image: string;
	link: string; // por defecto la categoría Impresión 3D
	title: string;
	subtitle: string;
}

/* --------------------------- LAYOUT --------------------------- */
// La home es una lista ORDENADA de bloques. El admin los reordena,
// activa/desactiva, renombra y puede agregar secciones de productos.

export type HomeBlockType =
	| 'hero' // carrusel principal
	| 'features' // 4 cards de confianza
	| 'categories' // "Explorá nuestras categorías"
	| 'banner3d' // banner Impresión 3D
	| 'brands' // logos de marcas
	| 'business' // banner de empresas
	| 'products'; // sección de productos (con nombre + selección)

// Fuente de productos de un bloque 'products':
//  - 'recent'   → productos más nuevos (automático)
//  - 'featured' → selección "destacados" (automático con fallback)
//  - 'manual'   → productos elegidos a mano (product_ids)
export type ProductSource = 'recent' | 'featured' | 'manual';

export interface HomeBlock {
	id: string;
	type: HomeBlockType;
	enabled: boolean;
	// Sólo para type 'products':
	title?: string;
	subtitle?: string;
	source?: ProductSource;
	product_ids?: string[];
}

/* ------------------------- BARRA DE NAVEGACIÓN ------------------------ */
// `nav_featured` mezcla dos cosas en una sola lista ordenada:
//   - id de categoría real  → "5f3c…"
//   - categoría especial    → "special:5f3c…" (campañas: Día del Niño, etc.)
// Se guarda con prefijo en vez de en un array aparte para que el admin pueda
// intercalar campañas entre las categorías en el orden que quiera, y para que
// las configuraciones ya guardadas (sólo ids de categoría) sigan funcionando.

export const SPECIAL_NAV_PREFIX = 'special:';

/** Entrada de nav_featured para una categoría especial. */
export const specialNavEntry = (specialCategoryId: string) =>
	`${SPECIAL_NAV_PREFIX}${specialCategoryId}`;

/** Devuelve el id de la especial si la entrada es una campaña; si no, null. */
export const parseSpecialNavEntry = (entry: string): string | null =>
	entry.startsWith(SPECIAL_NAV_PREFIX)
		? entry.slice(SPECIAL_NAV_PREFIX.length)
		: null;

export interface HomeConfig {
	/** Orden y contenido de las secciones de la home. */
	layout: HomeBlock[];
	/**
	 * Ítems destacados de la barra de navegación, en orden. Cada entrada es un id
	 * de categoría o `special:<id>` de una categoría especial (ver arriba).
	 */
	nav_featured: string[];
	/** Slides del carrusel del hero, en orden. */
	hero_slides: HomeSlide[];
	/** Tiles de la sección "Explorá nuestras categorías", en orden. */
	category_tiles: HomeCategoryTile[];
	/** Banner de Impresión 3D (Bambu Labs). */
	banner_3d: HomeBanner3D;
}

// Layout por defecto: reproduce la home actual.
export const DEFAULT_LAYOUT: HomeBlock[] = [
	{ id: 'hero', type: 'hero', enabled: true },
	{ id: 'features', type: 'features', enabled: true },
	{
		id: 'recent',
		type: 'products',
		enabled: true,
		title: 'Recién Llegados',
		source: 'recent',
		product_ids: [],
	},
	{ id: 'categories', type: 'categories', enabled: true },
	{
		id: 'featured',
		type: 'products',
		enabled: true,
		title: 'Productos Destacados',
		source: 'featured',
		product_ids: [],
	},
	{ id: 'banner3d', type: 'banner3d', enabled: true },
	{ id: 'brands', type: 'brands', enabled: true },
	{ id: 'business', type: 'business', enabled: true },
];

const HOME_CONFIG_KEY = 'home_config';

export const DEFAULT_HOME_CONFIG: HomeConfig = {
	layout: DEFAULT_LAYOUT,
	nav_featured: [],
	hero_slides: [],
	category_tiles: [],
	banner_3d: {
		enabled: false,
		image: '',
		link: '/tienda',
		title: 'Impresión 3D',
		subtitle: 'Impresoras Bambu Lab y todo para 3D',
	},
};

export const getHomeConfig = async (): Promise<HomeConfig> => {
	const { data, error } = await supabase
		.from('app_settings')
		.select('value')
		.eq('key', HOME_CONFIG_KEY)
		.maybeSingle();

	if (error) {
		console.warn('getHomeConfig:', error.message);
		return DEFAULT_HOME_CONFIG;
	}

	const v = (data?.value ?? {}) as Partial<HomeConfig>;
	return {
		...DEFAULT_HOME_CONFIG,
		...v,
		banner_3d: { ...DEFAULT_HOME_CONFIG.banner_3d, ...(v.banner_3d ?? {}) },
		layout:
			Array.isArray(v.layout) && v.layout.length > 0 ? v.layout : DEFAULT_LAYOUT,
		nav_featured: Array.isArray(v.nav_featured) ? v.nav_featured : [],
		hero_slides: Array.isArray(v.hero_slides) ? v.hero_slides : [],
		category_tiles: Array.isArray(v.category_tiles) ? v.category_tiles : [],
	};
};

export const updateHomeConfig = async (
	patch: Partial<HomeConfig>
): Promise<HomeConfig> => {
	const current = await getHomeConfig();
	const next: HomeConfig = {
		...current,
		...patch,
		banner_3d: { ...current.banner_3d, ...(patch.banner_3d ?? {}) },
	};
	const { error } = await supabase.from('app_settings').upsert({
		key: HOME_CONFIG_KEY,
		value: next as never,
		updated_at: new Date().toISOString(),
	});
	if (error) throw new Error(error.message);
	return next;
};

/**
 * Devuelve una imagen representativa (de un producto real) por cada categoría.
 * Se usa para las tarjetas de "Explorá nuestras categorías" cuando el admin no
 * cargó una imagen propia. Toma el producto activo más reciente con imagen.
 */
export const getCategoryThumbnails = async (
	categoryIds: string[]
): Promise<Record<string, string>> => {
	if (!categoryIds.length) return {};
	const { data, error } = await supabase
		.from('products')
		.select('category_id, images, created_at')
		.in('category_id', categoryIds)
		.eq('active', true)
		.not('images', 'is', null)
		.order('created_at', { ascending: false })
		.limit(800);
	if (error) {
		console.warn('getCategoryThumbnails:', error.message);
		return {};
	}
	const map: Record<string, string> = {};
	for (const row of data ?? []) {
		const cid = (row as any).category_id as string | null;
		if (!cid || map[cid]) continue;
		const imgs = (row as any).images as string[] | null;
		const first = Array.isArray(imgs) ? imgs.find(Boolean) : null;
		if (first) map[cid] = first;
	}
	return map;
};

/** Sube una imagen de la home y devuelve su URL pública. */
export const uploadHomeImage = async (
	file: File,
	folder = 'home'
): Promise<string> => {
	const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
	const path = `${folder}/${crypto.randomUUID()}.${ext}`;
	const { data, error } = await supabase.storage
		.from('product-images')
		.upload(path, file, { upsert: true, cacheControl: '3600' });
	if (error) throw new Error(error.message);
	return supabase.storage.from('product-images').getPublicUrl(data.path).data
		.publicUrl;
};
