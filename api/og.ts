// Vercel API route: /api/og
// Devuelve HTML con meta tags Open Graph reales (título, descripción, imagen)
// para que al compartir el link de un producto o artículo por WhatsApp / redes
// se vea la vista previa correcta. Sólo se sirve a los bots de las redes
// (ver rewrites con user-agent en vercel.json); los usuarios normales reciben
// la SPA como siempre.

export const config = { runtime: 'edge' };

const SUPABASE_URL =
	(globalThis as any).process?.env?.VITE_PROJECT_URL_SUPABASE ??
	(globalThis as any).process?.env?.SUPABASE_URL ??
	'https://bwjptocnkqedakdibosu.supabase.co';
const ANON_KEY =
	(globalThis as any).process?.env?.VITE_SUPABASE_API_KEY ??
	(globalThis as any).process?.env?.SUPABASE_ANON_KEY ??
	'';

const SITE_NAME = 'RF Store';

const escapeHtml = (s: string) =>
	String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');

// Extrae texto plano de un documento TipTap (jsonb) para la descripción.
// Los productos de CDR guardan la descripción como nodo {type:'html', html:'...'},
// así que también hay que leer node.html (si no, la descripción salía vacía).
const tiptapText = (node: any): string => {
	if (!node) return '';
	if (typeof node === 'string') return node;
	if (Array.isArray(node)) return node.map(tiptapText).join(' ');
	let out = '';
	if (node.text) out += node.text;
	if (node.html) out += ' ' + stripHtml(String(node.html));
	if (node.content) out += ' ' + tiptapText(node.content);
	return out;
};

const stripHtml = (html: string) =>
	html
		.replace(/<[^>]*>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

const clamp = (s: string, n = 180) =>
	s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;

const fetchOne = async (path: string): Promise<any | null> => {
	if (!ANON_KEY) return null;
	try {
		const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
			headers: {
				apikey: ANON_KEY,
				Authorization: `Bearer ${ANON_KEY}`,
			},
		});
		if (!res.ok) return null;
		const rows = await res.json();
		return Array.isArray(rows) && rows.length ? rows[0] : null;
	} catch {
		return null;
	}
};

const page = ({
	title,
	description,
	image,
	url,
	type,
}: {
	title: string;
	description: string;
	image: string;
	url: string;
	type: string;
}) => `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}" />
<link rel="canonical" href="${escapeHtml(url)}" />
<meta property="og:site_name" content="${SITE_NAME}" />
<meta property="og:type" content="${type}" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:url" content="${escapeHtml(url)}" />
${image ? `<meta property="og:image" content="${escapeHtml(image)}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />` : ''}
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeHtml(title)}" />
<meta name="twitter:description" content="${escapeHtml(description)}" />
${image ? `<meta name="twitter:image" content="${escapeHtml(image)}" />` : ''}
</head>
<body>
<p><a href="${escapeHtml(url)}">${escapeHtml(title)}</a></p>
<script>window.location.replace(${JSON.stringify(url)});</script>
</body>
</html>`;

export default async function handler(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const type = url.searchParams.get('type'); // 'product' | 'blog'
	const slug = url.searchParams.get('slug') ?? '';
	const origin = url.origin;

	const html = (body: string) =>
		new Response(body, {
			status: 200,
			headers: {
				'content-type': 'text/html; charset=utf-8',
				'cache-control': 'public, s-maxage=600, stale-while-revalidate=86400',
			},
		});

	// Fallback genérico (si algo falla, al menos la marca).
	const fallback = () =>
		html(
			page({
				title: SITE_NAME,
				description:
					'Tecnología con stock real, garantía oficial y envíos a todo Uruguay.',
				image: `${origin}/img/img-docs/logoblancorf.jpg`,
				url: origin,
				type: 'website',
			})
		);

	if (!slug || (type !== 'product' && type !== 'blog')) return fallback();

	if (type === 'product') {
		const p = await fetchOne(
			`products?slug=eq.${encodeURIComponent(slug)}&select=name,images,description&limit=1`
		);
		if (!p) return fallback();
		// trim: si la descripción queda en solo espacios, usar el copy de fallback
		const desc =
			clamp(tiptapText(p.description).replace(/\s+/g, ' ').trim()) ||
			`Comprá ${p.name} en ${SITE_NAME}. Envíos a todo Uruguay.`;
		const image = Array.isArray(p.images) && p.images[0] ? p.images[0] : '';
		return html(
			page({
				title: `${p.name} | ${SITE_NAME}`,
				description: desc,
				image,
				url: `${origin}/producto/${slug}`,
				type: 'product',
			})
		);
	}

	// type === 'blog'
	const post = await fetchOne(
		`posts?slug=eq.${encodeURIComponent(slug)}&select=title,cover_image_url,content&limit=1`
	);
	if (!post) return fallback();
	const desc =
		clamp(stripHtml(post.content ?? '')) ||
		`Leé "${post.title}" en el blog de ${SITE_NAME}.`;
	return html(
		page({
			title: `${post.title} | ${SITE_NAME}`,
			description: desc,
			image: post.cover_image_url || `${origin}/img/img-docs/logoblancorf.jpg`,
			url: `${origin}/blog/${slug}`,
			type: 'article',
		})
	);
}
