// deno-lint-ignore-file no-explicit-any
// Edge Function: cdr-sync-products
// - Llama productos_con_galeria del WS de CDR usando fecha = último sync.
// - Hace upsert en products por external_code.
// - Descarga imágenes nuevas (compara md5) a bucket cdr-images.
// - Marca productos como source='cdr'.
// - Actualiza app_settings.cdr_last_full_sync.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';
import { fetchProductosConGaleria, type CdrProduct } from '../_shared/cdr-soap.ts';
import { slugify } from '../_shared/slugify.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CDR_EMAIL = Deno.env.get('CDR_EMAIL')!;
const CDR_TOKEN = Deno.env.get('CDR_TOKEN')!;
const IMAGE_BUCKET = 'cdr-images';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
	auth: { persistSession: false, autoRefreshToken: false },
});

interface SyncReport {
	ok: boolean;
	fetched: number;
	inserted: number;
	updated: number;
	images_downloaded: number;
	images_skipped: number;
	errors: string[];
	since: string;
	finished_at: string;
}

async function getSetting<T>(key: string, fallback: T): Promise<T> {
	const { data } = await supabase.from('app_settings').select('value').eq('key', key).single();
	return (data?.value as T) ?? fallback;
}

async function setSetting(key: string, value: any): Promise<void> {
	await supabase.from('app_settings').upsert({ key, value, updated_at: new Date().toISOString() });
}

async function downloadImageIfChanged(
	productCode: string,
	idx: number,
	imgUrl: string,
	md5: string,
	storedMd5s: Record<string, string>
): Promise<{ publicUrl: string | null; md5: string; downloaded: boolean }> {
	const key = String(idx);
	const storedPath = `${productCode}/${idx}.bin`;

	if (storedMd5s[key] === md5) {
		// imagen no cambió: devuelvo la URL pública existente
		const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(storedPath);
		return { publicUrl: data.publicUrl, md5, downloaded: false };
	}

	const resp = await fetch(imgUrl);
	if (!resp.ok) {
		throw new Error(`No se pudo bajar imagen ${imgUrl}: HTTP ${resp.status}`);
	}
	const contentType = resp.headers.get('content-type') || 'image/jpeg';
	const bytes = new Uint8Array(await resp.arrayBuffer());

	const { error: upErr } = await supabase.storage
		.from(IMAGE_BUCKET)
		.upload(storedPath, bytes, { contentType, upsert: true });

	if (upErr) throw new Error(`Upload fallido (${storedPath}): ${upErr.message}`);

	const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(storedPath);
	return { publicUrl: data.publicUrl, md5, downloaded: true };
}

async function upsertProduct(
	p: CdrProduct,
	defaults: { categoryId: string; brandId: string },
	report: SyncReport
): Promise<void> {
	const externalCode = p.codigo;
	if (!externalCode) {
		report.errors.push('Producto sin código, ignorado');
		return;
	}

	// ¿Existe ya?
	const { data: existing } = await supabase
		.from('products')
		.select('id, image_md5s, slug, brand_id, category_id')
		.eq('external_code', externalCode)
		.maybeSingle();

	const storedMd5s: Record<string, string> =
		(existing?.image_md5s as Record<string, string>) ?? {};

	// Descargar / refrescar imágenes
	const newMd5s: Record<string, string> = {};
	const imageUrls: string[] = [];

	for (let i = 0; i < (p.galeria ?? []).length; i++) {
		const g = p.galeria[i];
		try {
			const res = await downloadImageIfChanged(externalCode, i, g.img, g.md5, storedMd5s);
			if (res.publicUrl) imageUrls.push(res.publicUrl);
			newMd5s[String(i)] = res.md5;
			if (res.downloaded) report.images_downloaded++;
			else report.images_skipped++;
		} catch (e: any) {
			report.errors.push(`img ${externalCode}#${i}: ${e.message}`);
		}
	}

	const stockNum = typeof p.stock === 'number' ? p.stock : Number(p.stock) || 0;
	const priceUsd = Number(p.precio) || 0;

	const baseSlug = slugify(`${p.nombre}-${externalCode}`);

	// Descripción: si viene HTML del WS, lo guardamos como JSONContent básico (string)
	const descriptionJson = p.descripcion
		? { type: 'doc', content: [{ type: 'html', html: p.descripcion }] }
		: { type: 'doc', content: [] };

	const productRow = {
		name: p.nombre || externalCode,
		slug: existing?.slug ?? baseSlug,
		brand_id: existing?.brand_id ?? defaults.brandId,
		category_id: existing?.category_id ?? defaults.categoryId,
		features: [
			p.copete,
			p.modelo ? `Modelo: ${p.modelo}` : null,
			p.nro_parte ? `Nro parte: ${p.nro_parte}` : null,
			p.gtin ? `GTIN: ${p.gtin}` : null,
		].filter(Boolean) as string[],
		description: descriptionJson,
		images: imageUrls,
		source: 'cdr',
		external_code: externalCode,
		price_usd: priceUsd,
		last_synced_at: new Date().toISOString(),
		image_md5s: newMd5s,
	};

	if (existing) {
		const { error } = await supabase
			.from('products')
			.update(productRow)
			.eq('id', existing.id);
		if (error) {
			report.errors.push(`update ${externalCode}: ${error.message}`);
			return;
		}

		// variante única para CDR
		const { data: existingVar } = await supabase
			.from('variants')
			.select('id')
			.eq('product_id', existing.id)
			.maybeSingle();

		if (existingVar) {
			await supabase
				.from('variants')
				.update({ price: priceUsd, stock: stockNum })
				.eq('id', existingVar.id);
		} else {
			await supabase.from('variants').insert({
				product_id: existing.id,
				color: '#000000',
				color_name: 'Único',
				storage: '-',
				price: priceUsd,
				stock: stockNum,
			});
		}
		report.updated++;
	} else {
		const { data: inserted, error } = await supabase
			.from('products')
			.insert(productRow)
			.select('id')
			.single();
		if (error) {
			report.errors.push(`insert ${externalCode}: ${error.message}`);
			return;
		}
		await supabase.from('variants').insert({
			product_id: inserted.id,
			color: '#000000',
			color_name: 'Único',
			storage: '-',
			price: priceUsd,
			stock: stockNum,
		});
		report.inserted++;
	}
}

Deno.serve(async req => {
	if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

	const report: SyncReport = {
		ok: false,
		fetched: 0,
		inserted: 0,
		updated: 0,
		images_downloaded: 0,
		images_skipped: 0,
		errors: [],
		since: '',
		finished_at: '',
	};

	try {
		// Permite forzar sync completo: { full: true } o usar last_sync
		const body: { full?: boolean; since?: string } = req.method === 'POST'
			? await req.json().catch(() => ({}))
			: {};

		const lastSync = await getSetting<string>('cdr_last_full_sync', '2015-01-01 00:00:00');
		const since = body.full ? '2015-01-01 00:00:00' : (body.since ?? lastSync);
		report.since = since;

		const startedAt = new Date();

		const products = await fetchProductosConGaleria(CDR_EMAIL, CDR_TOKEN, since);
		report.fetched = products.length;

		const catId = await getSetting<string>('cdr_default_category_id', '');
		const brandId = await getSetting<string>('cdr_default_brand_id', '');

		if (!catId || !brandId) {
			throw new Error('cdr_default_category_id o cdr_default_brand_id no configurados en app_settings');
		}

		for (const p of products) {
			try {
				await upsertProduct(p, { categoryId: catId, brandId }, report);
			} catch (e: any) {
				report.errors.push(`${p.codigo}: ${e.message}`);
			}
		}

		await setSetting(
			'cdr_last_full_sync',
			startedAt.toISOString().slice(0, 19).replace('T', ' ')
		);

		report.ok = report.errors.length === 0;
		report.finished_at = new Date().toISOString();

		return new Response(JSON.stringify(report), {
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			status: 200,
		});
	} catch (e: any) {
		report.errors.push(`fatal: ${e.message}`);
		report.finished_at = new Date().toISOString();
		return new Response(JSON.stringify(report), {
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			status: 500,
		});
	}
});
