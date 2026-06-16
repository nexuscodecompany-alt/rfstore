// deno-lint-ignore-file no-explicit-any
// Edge Function: cdr-sync-products (v5)
// Espejo del código desplegado en Supabase. Modos:
//  - 'new-only'      (default): solo inserta los códigos que no están en DB
//  - 'update-prices'           : actualiza price/stock de los que ya están
//  - 'full'                    : ambos
// `background: true` por defecto: corre con EdgeRuntime.waitUntil y responde 202.
// Body legacy `{ full: true }` se mapea a mode='full'.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';
import { fetchProductosConGaleria, type CdrProduct } from '../_shared/cdr-soap.ts';
import { slugify } from '../_shared/slugify.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CDR_EMAIL = Deno.env.get('CDR_EMAIL')!;
const CDR_TOKEN = Deno.env.get('CDR_TOKEN')!;
// Mail (Resend) para avisar al admin de productos nuevos. Mismas env vars que send-transfer-email.
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'pedidos@rfstore.uy';
const ADMIN_EMAIL_ENV = Deno.env.get('ADMIN_EMAIL') ?? '';
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://rfstore.uy';
const IMAGE_BUCKET = 'cdr-images';
const PRODUCT_CONCURRENCY = 8;
const IMAGE_CONCURRENCY = 4;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

async function getSetting<T>(key: string, fallback: T): Promise<T> {
	const { data } = await supabase.from('app_settings').select('value').eq('key', key).single();
	return (data?.value as T) ?? fallback;
}
async function setSetting(key: string, value: any): Promise<void> {
	await supabase.from('app_settings').upsert({ key, value, updated_at: new Date().toISOString() });
}

// Destinatario configurable sin redeploy: app_settings.admin_notify_email > ADMIN_EMAIL env > fallback.
async function resolveAdminEmail(): Promise<string> {
	const { data } = await supabase.from('app_settings').select('value').eq('key', 'admin_notify_email').maybeSingle();
	const fromSetting = typeof data?.value === 'string' ? data.value : '';
	return fromSetting || ADMIN_EMAIL_ENV || 'nexuscode.company@gmail.com';
}

// Mail-resumen al admin con TODOS los productos nuevos que entraron en esta corrida.
// Un solo mail por corrida (evita spam). Best-effort: nunca rompe el sync.
async function sendNewProductsDigest(items: { code: string; name: string }[]): Promise<void> {
	if (items.length === 0) return;
	if (!RESEND_API_KEY) { console.warn('RESEND_API_KEY no configurado — skip digest nuevos'); return; }
	const to = await resolveAdminEmail();
	if (!to) return;
	const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	const when = new Date().toLocaleString('es-UY', { timeZone: 'America/Montevideo' });
	const n = items.length;
	const subject = `RF Store — ${n} producto${n === 1 ? '' : 's'} nuevo${n === 1 ? '' : 's'} de CDR`;
	const rows = items
		.map(it => `<tr><td style="padding:6px 12px;font-family:monospace;color:#555;border-bottom:1px solid #eee;">${esc(it.code)}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;">${esc(it.name)}</td></tr>`)
		.join('');
	const listUrl = `${SITE_URL}/dashboard/productos?nuevos=1`;
	const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
		<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;"><tr><td align="center">
			<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:600px;">
				<tr><td style="padding:24px 32px;background:#111;color:#fff;"><h1 style="margin:0;font-size:20px;">RF Store</h1></td></tr>
				<tr><td style="padding:32px;">
					<p style="margin:0 0 8px;font-size:16px;">Entraron <b>${n}</b> producto${n === 1 ? '' : 's'} nuevo${n === 1 ? '' : 's'} desde CDR</p>
					<p style="margin:0 0 20px;color:#555;">Corrida del sync: ${esc(when)}. Revisalos para activarlos o publicarlos en Mercado Libre.</p>
					<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:24px;">
						<tr><th style="text-align:left;padding:8px 12px;background:#f9fafb;border-bottom:1px solid #e5e7eb;font-size:12px;text-transform:uppercase;color:#666;">Código</th><th style="text-align:left;padding:8px 12px;background:#f9fafb;border-bottom:1px solid #e5e7eb;font-size:12px;text-transform:uppercase;color:#666;">Nombre</th></tr>
						${rows}
					</table>
					<a href="${listUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;">Ver nuevos en el panel</a>
				</td></tr>
				<tr><td style="padding:20px 32px;background:#f4f4f5;color:#666;font-size:12px;text-align:center;">RF Store — aviso automático de catálogo CDR</td></tr>
			</table>
		</td></tr></table></body></html>`;
	const text = `Entraron ${n} productos nuevos de CDR (${when}):\n` +
		items.map(it => `- [${it.code}] ${it.name}`).join('\n') +
		`\n\nVer nuevos en el panel: ${listUrl}`;
	try {
		const r = await fetch('https://api.resend.com/emails', {
			method: 'POST',
			headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ from: `RF Store <${FROM_EMAIL}>`, to: [to], subject, html, text }),
		});
		if (!r.ok) console.warn('digest nuevos resend error:', r.status, (await r.text()).slice(0, 300));
	} catch (e) {
		console.warn('digest nuevos fetch error:', e);
	}
}

async function downloadImage(productCode: string, idx: number, imgUrl: string): Promise<{ publicUrl: string; }> {
	// .jpg con content-type image/jpeg: ML rechaza descargas con extension .bin y/o content-type no estandar
	const storedPath = `${productCode}/${idx}.jpg`;
	const resp = await fetch(imgUrl);
	if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
	const bytes = new Uint8Array(await resp.arrayBuffer());
	const { error: upErr } = await supabase.storage.from(IMAGE_BUCKET).upload(storedPath, bytes, { contentType: 'image/jpeg', upsert: true });
	if (upErr) throw new Error(upErr.message);
	const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(storedPath);
	return { publicUrl: data.publicUrl };
}

async function insertNewProduct(p: CdrProduct, defaults: { categoryId: string; brandId: string }, counters: any): Promise<void> {
	const externalCode = p.codigo;
	if (!externalCode) return;

	const gallery = p.galeria ?? [];
	const newMd5s: Record<string, string> = {};
	const imageUrls: string[] = [];

	for (let i = 0; i < gallery.length; i += IMAGE_CONCURRENCY) {
		const chunk = gallery.slice(i, i + IMAGE_CONCURRENCY);
		const res = await Promise.allSettled(chunk.map((g, j) => downloadImage(externalCode, i + j, g.img).then(r => ({ ...r, idx: i + j, md5: g.md5 }))));
		for (const r of res) {
			if (r.status === 'fulfilled') {
				imageUrls.push(r.value.publicUrl);
				newMd5s[String(r.value.idx)] = r.value.md5;
				counters.images_downloaded++;
			} else {
				counters.errors.push(`img ${externalCode}: ${r.reason?.message ?? r.reason}`);
			}
		}
	}

	const stockNum = typeof p.stock === 'number' ? p.stock : Number(p.stock) || 0;
	const priceUsd = Number(p.precio) || 0;
	const baseSlug = slugify(`${p.nombre}-${externalCode}`);
	const descriptionJson = p.descripcion ? { type: 'doc', content: [{ type: 'html', html: p.descripcion }] } : { type: 'doc', content: [] };
	const productRow = { name: p.nombre || externalCode, slug: baseSlug, brand_id: defaults.brandId, category_id: defaults.categoryId, features: [p.copete, p.modelo ? `Modelo: ${p.modelo}` : null, p.nro_parte ? `Nro parte: ${p.nro_parte}` : null, p.gtin ? `GTIN: ${p.gtin}` : null].filter(Boolean), description: descriptionJson, images: imageUrls, source: 'cdr', external_code: externalCode, price_usd: priceUsd, last_synced_at: new Date().toISOString(), image_md5s: newMd5s };
	const { data: inserted, error } = await supabase.from('products').insert(productRow).select('id').single();
	if (error) { counters.errors.push(`insert ${externalCode}: ${error.message}`); return; }
	await supabase.from('variants').insert({ product_id: inserted.id, color: '#000000', color_name: 'Unico', storage: '-', price: priceUsd, stock: stockNum });
	counters.inserted++;
	// Guardamos código+nombre para el mail-resumen de nuevos al admin.
	(counters.inserted_list ??= []).push({ code: externalCode, name: p.nombre || externalCode });
}

async function updateExistingProductStock(externalCode: string, p: CdrProduct, counters: any): Promise<void> {
	const { data: existing } = await supabase.from('products').select('id').eq('external_code', externalCode).maybeSingle();
	if (!existing) return;
	const stockNum = typeof p.stock === 'number' ? p.stock : Number(p.stock) || 0;
	const priceUsd = Number(p.precio) || 0;
	await supabase.from('products').update({ price_usd: priceUsd, last_synced_at: new Date().toISOString() }).eq('id', existing.id);

	// Stock efectivo = stock de CDR - cantidades ya reservadas por órdenes
	// activas (pago_pendiente, pagado, Cotización). Sin esto, el sync pisaría
	// nuestras reservas y permitiría oversell.
	const { data: reservedData } = await supabase.rpc('reserved_quantity_for_product', { p_external_code: externalCode });
	const reserved = Number(reservedData) || 0;
	const effectiveStock = Math.max(0, stockNum - reserved);

	const { data: existingVar } = await supabase.from('variants').select('id').eq('product_id', existing.id).maybeSingle();
	if (existingVar) await supabase.from('variants').update({ price: priceUsd, stock: effectiveStock }).eq('id', existingVar.id);
	counters.updated++;
}

async function runSync(mode: 'new-only' | 'update-prices' | 'full', counters: any) {
	try {
		const products = await fetchProductosConGaleria(CDR_EMAIL, CDR_TOKEN, '2015-01-01 00:00:00');
		counters.fetched = products.length;

		// Traer TODOS los códigos existentes. PostgREST limita a 1000 filas por request,
		// así que paginamos: sin esto, con >1000 productos el sync cree que los que ya
		// tenemos son "nuevos" e infla to_insert (y podría duplicar en modo new-only/full).
		const existingCodes = new Set<string>();
		for (let from = 0; ; from += 1000) {
			const { data: rows, error: exErr } = await supabase
				.from('products')
				.select('external_code')
				.eq('source', 'cdr')
				.range(from, from + 999);
			if (exErr) throw new Error(`existing_codes: ${exErr.message}`);
			if (!rows || rows.length === 0) break;
			for (const r of rows as any[]) if (r.external_code) existingCodes.add(r.external_code);
			if (rows.length < 1000) break;
		}
		counters.already_in_db = existingCodes.size;

		const catId = await getSetting<string>('cdr_default_category_id', '');
		const brandId = await getSetting<string>('cdr_default_brand_id', '');
		if (!catId || !brandId) throw new Error('defaults no configurados');

		const toInsert = products.filter(p => p.codigo && !existingCodes.has(p.codigo));
		const toUpdate = products.filter(p => p.codigo && existingCodes.has(p.codigo));
		counters.to_insert = toInsert.length;
		counters.to_update = toUpdate.length;

		if (mode === 'new-only' || mode === 'full') {
			for (let i = 0; i < toInsert.length; i += PRODUCT_CONCURRENCY) {
				const chunk = toInsert.slice(i, i + PRODUCT_CONCURRENCY);
				await Promise.allSettled(chunk.map(p => insertNewProduct(p, { categoryId: catId, brandId }, counters)));
			}
		}
		if (mode === 'update-prices' || mode === 'full') {
			// Update en LOTE (una sola operación SQL) en vez de uno por uno: así la corrida
			// siempre termina y reconcilia TODOS los productos (stock = CDR - reservado).
			const rows = toUpdate.map(p => ({
				code: p.codigo,
				precio: Number(p.precio) || 0,
				stock: typeof p.stock === 'number' ? p.stock : Number(p.stock) || 0,
			}));
			const { data: res, error: bulkErr } = await supabase.rpc('cdr_bulk_update_stock_price', { p_rows: rows });
			if (bulkErr) counters.errors.push(`bulk_update: ${bulkErr.message}`);
			else counters.updated = (res as { variants?: number } | null)?.variants ?? 0;
		}
		counters.ok = counters.errors.length === 0;
		counters.finished_at = new Date().toISOString();
		await setSetting('cdr_last_sync_report', counters);
		await setSetting('cdr_last_full_sync', new Date().toISOString().slice(0, 19).replace('T', ' '));
		// Aviso al admin de los productos nuevos que entraron en esta corrida.
		await sendNewProductsDigest(counters.inserted_list ?? []);
	} catch (e: any) {
		counters.errors.push(`fatal: ${e.message}`);
		counters.ok = false;
		counters.finished_at = new Date().toISOString();
		await setSetting('cdr_last_sync_report', counters);
	}
}

Deno.serve(async req => {
	if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
	const body: { mode?: 'new-only' | 'update-prices' | 'full'; background?: boolean; full?: boolean } = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
	const mode = body.mode ?? (body.full ? 'full' : 'new-only');
	const bg = body.background !== false;
	const counters: any = { inserted: 0, updated: 0, images_downloaded: 0, fetched: 0, already_in_db: 0, to_insert: 0, to_update: 0, errors: [], inserted_list: [], mode };

	if (bg) {
		// @ts-ignore EdgeRuntime global
		EdgeRuntime.waitUntil(runSync(mode, counters));
		return new Response(JSON.stringify({ ok: true, started: true, mode_dispatched: mode }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 202 });
	}
	await runSync(mode, counters);
	return new Response(JSON.stringify(counters), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
});
