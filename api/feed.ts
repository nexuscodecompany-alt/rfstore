// Vercel API route: /api/feed  (alias públicos: /feed.csv y /feed.xml)
//
// Feed de catálogo de productos para el Administrador de ventas de Meta
// (anuncios dinámicos / Advantage+ catálogo) y, de paso, compatible con
// Google Merchant Center: mismos nombres de columna.
//
//   /feed.csv                -> CSV  (formato por defecto)
//   /feed.xml                -> XML  (RSS 2.0 con namespace g:)
//   /api/feed?format=tsv     -> TSV
//   /api/feed?in_stock=1     -> sólo productos con stock (por defecto van todos
//                               los visibles en la tienda, marcando availability)
//
// El contenido sale en vivo de la vista `products_feed` de Supabase, así que
// refleja siempre el catálogo actual (altas, bajas, precio y stock). Meta
// reprocesa la URL según la frecuencia que se configure en el catálogo.
//
// IMPORTANTE: la columna `id` es el UUID de `products.id`, el mismo valor que
// el Pixel manda en content_ids (ViewContent / AddToCart / InitiateCheckout /
// Purchase). Si se cambia acá, hay que cambiarlo en src/lib/pixel.ts.

export const config = { runtime: 'edge' };

const SUPABASE_URL =
	(globalThis as any).process?.env?.VITE_PROJECT_URL_SUPABASE ??
	(globalThis as any).process?.env?.SUPABASE_URL ??
	'https://bwjptocnkqedakdibosu.supabase.co';
const ANON_KEY =
	(globalThis as any).process?.env?.VITE_SUPABASE_API_KEY ??
	(globalThis as any).process?.env?.SUPABASE_ANON_KEY ??
	'';

const CURRENCY = 'USD'; // La tienda publica precios en dólares (igual que el Pixel).
const PAGE_SIZE = 1000; // Límite por request de PostgREST.
const MAX_PAGES = 25; // Tope de seguridad (25k productos).

interface FeedRow {
	id: string;
	title: string;
	description: string;
	slug: string;
	price: number | string;
	brand: string;
	product_type: string | null;
	stock: number;
	image_link: string;
	additional_images: string[] | null;
	source: string | null;
}

/** Trae la vista completa paginando (PostgREST corta en 1000 filas). */
const fetchRows = async (): Promise<FeedRow[]> => {
	const rows: FeedRow[] = [];
	for (let page = 0; page < MAX_PAGES; page++) {
		const from = page * PAGE_SIZE;
		const res = await fetch(
			`${SUPABASE_URL}/rest/v1/products_feed?select=*&order=id.asc`,
			{
				headers: {
					apikey: ANON_KEY,
					Authorization: `Bearer ${ANON_KEY}`,
					Range: `${from}-${from + PAGE_SIZE - 1}`,
					'Range-Unit': 'items',
				},
			}
		);
		if (!res.ok) throw new Error(`supabase ${res.status}: ${await res.text()}`);
		const batch = (await res.json()) as FeedRow[];
		rows.push(...batch);
		if (batch.length < PAGE_SIZE) break;
	}
	return rows;
};

/* --------------------------------- helpers -------------------------------- */

const clean = (s: unknown): string =>
	String(s ?? '')
		.replace(/[\r\n\t]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

const clamp = (s: string, n: number) =>
	s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;

const money = (v: number | string) => `${Number(v).toFixed(2)} ${CURRENCY}`;

const escapeXml = (s: string) =>
	s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');

/** Campos del feed, ya normalizados y con los nombres que espera Meta. */
const toItem = (r: FeedRow, origin: string) => {
	const extra = (r.additional_images ?? [])
		.filter(Boolean)
		.slice(0, 10)
		.join(',');
	return {
		id: clean(r.id),
		title: clamp(clean(r.title), 200),
		description: clamp(clean(r.description) || clean(r.title), 5000),
		availability: Number(r.stock) > 0 ? 'in stock' : 'out of stock',
		condition: 'new',
		price: money(r.price),
		link: `${origin}/producto/${encodeURIComponent(r.slug)}`,
		image_link: clean(r.image_link),
		brand: clamp(clean(r.brand) || 'RF Store', 100),
		additional_image_link: extra,
		product_type: clamp(clean(r.product_type ?? ''), 750),
		quantity_to_sell_on_facebook: String(Math.max(0, Number(r.stock) || 0)),
		inventory: String(Math.max(0, Number(r.stock) || 0)),
	};
};

type Item = ReturnType<typeof toItem>;

const COLUMNS: (keyof Item)[] = [
	'id',
	'title',
	'description',
	'availability',
	'condition',
	'price',
	'link',
	'image_link',
	'brand',
	'additional_image_link',
	'product_type',
	'quantity_to_sell_on_facebook',
	'inventory',
];

const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`;

const buildCsv = (items: Item[], sep: string) =>
	[
		COLUMNS.join(sep),
		...items.map(it => COLUMNS.map(c => csvCell(it[c])).join(sep)),
	].join('\n');

const buildXml = (items: Item[], origin: string) => `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
<title>RF Store</title>
<link>${escapeXml(origin)}</link>
<description>Catálogo de productos de RF Store</description>
${items
	.map(
		it => `<item>
${COLUMNS.map(c => `<g:${c}>${escapeXml(it[c])}</g:${c}>`).join('\n')}
</item>`
	)
	.join('\n')}
</channel>
</rss>`;

/* --------------------------------- handler -------------------------------- */

export default async function handler(request: Request): Promise<Response> {
	const url = new URL(request.url);
	// `base` permite forzar el dominio público si el feed se sirve por otro host.
	const origin = (url.searchParams.get('base') || url.origin).replace(/\/$/, '');
	const format = (url.searchParams.get('format') || 'csv').toLowerCase();
	const onlyInStock = ['1', 'true', 'yes'].includes(
		(url.searchParams.get('in_stock') || '').toLowerCase()
	);

	if (!ANON_KEY) {
		return new Response('feed no configurado: falta la key de Supabase', {
			status: 500,
			headers: { 'content-type': 'text/plain; charset=utf-8' },
		});
	}

	let rows: FeedRow[];
	try {
		rows = await fetchRows();
	} catch (e) {
		return new Response(`error generando el feed: ${(e as Error).message}`, {
			status: 502,
			headers: { 'content-type': 'text/plain; charset=utf-8' },
		});
	}

	let items = rows.map(r => toItem(r, origin));
	if (onlyInStock) items = items.filter(it => it.availability === 'in stock');

	const headers: Record<string, string> = {
		// Meta relee el feed según la frecuencia del catálogo; cacheamos 15 min
		// en el CDN para que varios reintentos seguidos no peguen a la base.
		'cache-control': 'public, s-maxage=900, stale-while-revalidate=3600',
		'x-feed-items': String(items.length),
		'access-control-allow-origin': '*',
	};

	if (format === 'xml') {
		return new Response(buildXml(items, origin), {
			status: 200,
			headers: { ...headers, 'content-type': 'application/xml; charset=utf-8' },
		});
	}

	const tsv = format === 'tsv';
	return new Response(buildCsv(items, tsv ? '\t' : ','), {
		status: 200,
		headers: {
			...headers,
			'content-type': tsv
				? 'text/tab-separated-values; charset=utf-8'
				: 'text/csv; charset=utf-8',
			'content-disposition': `inline; filename="rfstore-feed.${tsv ? 'tsv' : 'csv'}"`,
		},
	});
}
