// deno-lint-ignore-file no-explicit-any
// Edge Function: cdr-fill-images (v10)
// Rellena imagenes de productos CDR que quedaron SIN fotos.
//
// Por que existe: cdr-sync-products baja la galeria UNA sola vez, en el alta.
// Si CDR publica el producto en el feed antes de subirle las fotos (paso con
// Redtiger/Hollyland el 27/07 y con Deerma el 30/07: corridas OK, 0 errores y
// 0 imagenes bajadas), el producto queda sin fotos PARA SIEMPRE, porque el
// update diario solo toca precio/stock/contenido. Esta funcion cierra ese
// agujero y corre por cron todos los dias.
//
// v10 (2026-08-11):
//  - FIX del tope de 1000: la consulta de productos no paginaba, asi que solo
//    miraba los primeros 1000 productos CDR (de 4339) y "no encontraba" la
//    mayoria de los que estan sin fotos. Ahora pagina de a 1000.
//  - Reporte con la lista de codigos que siguen sin galeria EN CDR (es la lista
//    para reclamarle al proveedor) y los que ni aparecen en el feed.
//  - Tope de productos por corrida configurable (app_settings.cdr_fill_max_per_run)
//    para no morir por limite de tiempo cuando hay muchos pendientes.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from './_shared/cors.ts';
import { fetchProductosConGaleria, type CdrProduct, type CdrImage } from './_shared/cdr-soap.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CDR_EMAIL = Deno.env.get('CDR_EMAIL')!;
const CDR_TOKEN = Deno.env.get('CDR_TOKEN')!;
const IMAGE_BUCKET = 'cdr-images';
const PRODUCT_CONCURRENCY = 2; // conservador para no saturar CDR
const MAX_PER_RUN_DEFAULT = 150;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

async function getSetting<T>(key: string, fallback: T): Promise<T> {
	const { data } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
	return (data?.value as T) ?? fallback;
}

async function downloadOneImage(productCode: string, idx: number, imgUrl: string, retries = 2): Promise<string | null> {
	const storedPath = `${productCode}/${idx}.bin`;
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			const resp = await fetch(imgUrl, { signal: AbortSignal.timeout(20000) });
			if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
			const contentType = resp.headers.get('content-type') || 'image/jpeg';
			const bytes = new Uint8Array(await resp.arrayBuffer());
			const { error: upErr } = await supabase.storage.from(IMAGE_BUCKET).upload(storedPath, bytes, { contentType, upsert: true });
			if (upErr) throw new Error(upErr.message);
			const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(storedPath);
			return data.publicUrl;
		} catch (e) {
			if (attempt === retries) {
				console.error(`img fail ${productCode}#${idx}: ${(e as Error).message}`);
				return null;
			}
			await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
		}
	}
	return null;
}

async function fillImagesForOneProduct(p: CdrProduct, productId: string, counters: any): Promise<void> {
	const gallery = p.galeria ?? [];
	if (gallery.length === 0) {
		// CDR todavia no le subio fotos al producto. No es un error nuestro:
		// queda listado para reclamarselo (y la proxima corrida lo reintenta).
		counters.products_skipped_no_gallery++;
		(counters.still_without_gallery ??= []).push(p.codigo);
		return;
	}
	const imageUrls: string[] = [];
	const newMd5s: Record<string, string> = {};
	// SECUENCIAL: una imagen a la vez por producto para no saturar CDR
	for (let i = 0; i < gallery.length; i++) {
		const g = gallery[i] as CdrImage;
		const url = await downloadOneImage(p.codigo, i, g.img);
		if (url) {
			imageUrls.push(url);
			newMd5s[String(i)] = g.md5;
			counters.images_downloaded++;
		} else {
			counters.images_failed++;
		}
	}
	if (imageUrls.length === 0) {
		counters.products_no_images++;
		return;
	}
	const { error } = await supabase.from('products').update({ images: imageUrls, image_md5s: newMd5s, last_synced_at: new Date().toISOString() }).eq('id', productId);
	if (error) {
		counters.errors.push(`update ${p.codigo}: ${error.message}`);
		return;
	}
	counters.products_filled++;
	(counters.filled_list ??= []).push({ code: p.codigo, images: imageUrls.length });
}

async function runFill(counters: any) {
	try {
		const products = await fetchProductosConGaleria(CDR_EMAIL, CDR_TOKEN, '2015-01-01 00:00:00');
		counters.fetched = products.length;
		const byCode = new Map<string, CdrProduct>();
		for (const p of products) if (p.codigo && !byCode.has(p.codigo)) byCode.set(p.codigo, p);

		// Productos CDR sin imagenes. PAGINADO: PostgREST corta en 1000 filas y
		// hay >4300 productos CDR; sin esto solo se miraba el primer lote.
		const needFill = new Map<string, string>(); // external_code -> product id
		for (let from = 0; ; from += 1000) {
			const { data: rows, error } = await supabase
				.from('products')
				.select('id, external_code, images')
				.eq('source', 'cdr')
				.range(from, from + 999);
			if (error) throw new Error(`listar productos: ${error.message}`);
			if (!rows || rows.length === 0) break;
			for (const r of rows as any[]) {
				if (!r.external_code) continue;
				const imgs = r.images;
				if (!Array.isArray(imgs) || imgs.length === 0) needFill.set(r.external_code, r.id);
			}
			if (rows.length < 1000) break;
		}
		counters.products_needing_images = needFill.size;

		// Los que ni siquiera vienen en el feed de hoy (CDR devuelve conteos
		// inconsistentes entre corridas): no se pueden rellenar ahora.
		const notInFeed: string[] = [];
		const toProcessAll: { p: CdrProduct; id: string }[] = [];
		for (const [code, id] of needFill) {
			const p = byCode.get(code);
			if (p) toProcessAll.push({ p, id });
			else notInFeed.push(code);
		}
		counters.not_in_feed = notInFeed.length;
		counters.not_in_feed_codes = notInFeed.slice(0, 100);

		const maxPerRun = Number(await getSetting<number | string>('cdr_fill_max_per_run', MAX_PER_RUN_DEFAULT)) || MAX_PER_RUN_DEFAULT;
		const toProcess = toProcessAll.slice(0, maxPerRun);
		counters.to_process = toProcess.length;
		counters.backlog = toProcessAll.length - toProcess.length;

		for (let i = 0; i < toProcess.length; i += PRODUCT_CONCURRENCY) {
			const chunk = toProcess.slice(i, i + PRODUCT_CONCURRENCY);
			await Promise.allSettled(chunk.map(x => fillImagesForOneProduct(x.p, x.id, counters)));
		}

		counters.ok = counters.errors.length === 0;
		counters.finished_at = new Date().toISOString();
		await supabase.from('app_settings').upsert({ key: 'cdr_last_fill_report', value: counters, updated_at: new Date().toISOString() });
	} catch (e: any) {
		counters.errors.push(`fatal: ${e.message}`);
		counters.ok = false;
		counters.finished_at = new Date().toISOString();
		await supabase.from('app_settings').upsert({ key: 'cdr_last_fill_report', value: counters, updated_at: new Date().toISOString() });
	}
}

Deno.serve(async req => {
	if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
	const body: { background?: boolean } = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
	const bg = body.background !== false;
	const counters: any = {
		fetched: 0, products_needing_images: 0, not_in_feed: 0, to_process: 0, backlog: 0,
		products_filled: 0, products_no_images: 0, products_skipped_no_gallery: 0,
		images_downloaded: 0, images_failed: 0, errors: [], filled_list: [], still_without_gallery: [],
	};
	if (bg) {
		// @ts-ignore EdgeRuntime
		EdgeRuntime.waitUntil(runFill(counters));
		return new Response(JSON.stringify({ ok: true, started: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 202 });
	}
	await runFill(counters);
	return new Response(JSON.stringify(counters), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
});
