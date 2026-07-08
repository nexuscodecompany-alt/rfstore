// deno-lint-ignore-file no-explicit-any
// Edge Function: cdr-sync-products (v25)
// Sincroniza catalogo y precios desde CDR. El update de precios/stock se hace
// en LOTE via RPC cdr_bulk_update_stock_price (una sola operacion).
// v25 (2026-07-08): los digests por corrida (nuevos / cambios de contenido) quedan APAGADOS
//  por defecto (app_settings.cdr_digest_daily=true). Ahora hay UN mail consolidado diario a
//  las 6 AM Montevideo (edge fn cdr-daily-digest via cron). Reactivar por corrida: cdr_digest_daily=false.
// v24 (2026-07-08): body.force_content -> resync FORZADO de contenido (one-shot manual):
//  compara el CONTENIDO real de CDR vs lo guardado (RPC cdr_force_content_resync), para
//  arreglar el drift previo que el baseline congelo. body.force_dry_run cuenta sin aplicar.
//  NO manda el digest en modo force (el operador ve el conteo en la respuesta).
// v23 (2026-07-08): tambien SINCRONIZA CONTENIDO (nombre/descripcion/features) de los
//  productos que YA existen. Antes solo precio/stock, asi que si CDR cambiaba el titulo
//  o la descripcion no nos enterabamos. Ahora:
//   - cdr_bulk_update_content detecta cambios por hash y los aplica (respetando el candado
//     products.content_locked del admin). Baseline: la 1er vez solo registra la huella
//     (hash null -> no pisa, no avisa), para no disparar un mail gigante ni pisar ediciones.
//   - si el producto esta publicado en ML, marca products.ml_content_dirty = true (boton
//     manual "Actualizar en ML" en el panel; NO se empuja solo por la suspension de ML).
//   - mail-resumen al admin (cliente) con los productos cuyo contenido cambio.
// v21 (2026-06-26): SEPARA destinatarios:
//  - Avisos de ERROR/FALLO del sync -> resolveErrorEmail() (app_settings.admin_error_email
//    > nexuscode.company@gmail.com). NO van al cliente (son ruido tecnico).
//  - Digest de productos NUEVOS -> resolveAdminEmail() (cliente, lo necesita p/ activar).
// v20 (2026-06-24): los productos NUEVOS entran SIN categoria ni marca (null) y
// como active=false; el cliente les asigna categoria/marca a mano y los activa.
//  - INSERTA el producto primero y baja las imagenes despues (no mas imagenes huerfanas)
//  - slug siempre incluye el external_code (sin colisiones por truncado)
//  - timeout por descarga de imagen
//  - mail de alerta al admin si la corrida termina con errores; reporte separado por modo
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from './cors.ts';
import { fetchProductosConGaleria, type CdrProduct } from './cdr-soap.ts';
import { slugify } from './slugify.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CDR_EMAIL = Deno.env.get('CDR_EMAIL')!;
const CDR_TOKEN = Deno.env.get('CDR_TOKEN')!;
// Mail (Resend) para avisar al admin de productos nuevos. Mismas env vars que send-transfer-email.
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'pedidos@rfstore.uy';
const ADMIN_EMAIL_ENV = Deno.env.get('ADMIN_EMAIL') ?? '';
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://rfstore.uy';
// Destinatario fijo de avisos tecnicos de error (dev). Configurable via app_settings.admin_error_email.
const ERROR_EMAIL_FALLBACK = 'nexuscode.company@gmail.com';
const IMAGE_BUCKET = 'cdr-images';
const PRODUCT_CONCURRENCY = 8;
const IMAGE_CONCURRENCY = 4;
const IMAGE_TIMEOUT_MS = 20000;
// Tamano de lote para el RPC de contenido (el payload trae nombre+descripcion+features,
// mucho mas pesado que solo precio/stock -> chunk para no mandar varios MB de una).
const CONTENT_CHUNK = 300;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

async function getSetting<T>(key: string, fallback: T): Promise<T> {
	const { data } = await supabase.from('app_settings').select('value').eq('key', key).single();
	return (data?.value as T) ?? fallback;
}
async function setSetting(key: string, value: any): Promise<void> {
	await supabase.from('app_settings').upsert({ key, value, updated_at: new Date().toISOString() });
}

// Destinatario configurable sin redeploy: app_settings.admin_notify_email > ADMIN_EMAIL env > fallback.
// Se usa para notificaciones de NEGOCIO (digest de productos nuevos / cambios) -> va al cliente.
async function resolveAdminEmail(): Promise<string> {
	const { data } = await supabase.from('app_settings').select('value').eq('key', 'admin_notify_email').maybeSingle();
	const fromSetting = typeof data?.value === 'string' ? data.value : '';
	return fromSetting || ADMIN_EMAIL_ENV || 'nexuscode.company@gmail.com';
}

// Destinatario de avisos TECNICOS de error/fallo del sync -> va al dev (NO al cliente).
// app_settings.admin_error_email > ERROR_EMAIL_FALLBACK (nexuscode).
async function resolveErrorEmail(): Promise<string> {
	const { data } = await supabase.from('app_settings').select('value').eq('key', 'admin_error_email').maybeSingle();
	const fromSetting = typeof data?.value === 'string' ? data.value : '';
	return fromSetting || ERROR_EMAIL_FALLBACK;
}

const escHtml = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Mail de alerta generico al dev (errores / fallos). Best-effort: nunca rompe el sync.
async function sendAdminAlert(subject: string, lines: string[]): Promise<void> {
	if (!RESEND_API_KEY) { console.warn('RESEND_API_KEY no configurado - skip alerta'); return; }
	const to = await resolveErrorEmail();
	if (!to) return;
	const when = new Date().toLocaleString('es-UY', { timeZone: 'America/Montevideo' });
	const items = lines.map(l => `<li style="padding:4px 0;">${escHtml(l)}</li>`).join('');
	const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f4f5;padding:24px;"><table width="600" align="center" style="background:#fff;border-radius:12px;overflow:hidden;"><tr><td style="padding:20px 28px;background:#b91c1c;color:#fff;"><h1 style="margin:0;font-size:18px;">RF Store - Aviso del sync CDR</h1></td></tr><tr><td style="padding:24px 28px;"><p style="margin:0 0 12px;color:#555;">${escHtml(when)}</p><ul style="margin:0;padding-left:18px;color:#222;">${items}</ul></td></tr></table></body></html>`;
	const text = `${subject}\n${when}\n\n` + lines.map(l => `- ${l}`).join('\n');
	try {
		const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: `RF Store <${FROM_EMAIL}>`, to: [to], subject, html, text }) });
		if (!r.ok) console.warn('alerta resend error:', r.status, (await r.text()).slice(0, 300));
	} catch (e) { console.warn('alerta fetch error:', e); }
}

// Mail-resumen al admin con TODOS los productos nuevos que entraron en esta corrida.
// Un solo mail por corrida (evita spam). Best-effort: nunca rompe el sync.
async function sendNewProductsDigest(items: { code: string; name: string }[]): Promise<void> {
	if (items.length === 0) return;
	if (!RESEND_API_KEY) { console.warn('RESEND_API_KEY no configurado - skip digest nuevos'); return; }
	const to = await resolveAdminEmail();
	if (!to) return;
	const when = new Date().toLocaleString('es-UY', { timeZone: 'America/Montevideo' });
	const n = items.length;
	const subject = `RF Store - ${n} producto${n === 1 ? '' : 's'} nuevo${n === 1 ? '' : 's'} de CDR`;
	const rows = items
		.map(it => `<tr><td style="padding:6px 12px;font-family:monospace;color:#555;border-bottom:1px solid #eee;">${escHtml(it.code)}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;">${escHtml(it.name)}</td></tr>`)
		.join('');
	const listUrl = `${SITE_URL}/dashboard/productos?nuevos=1`;
	const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:600px;"><tr><td style="padding:24px 32px;background:#111;color:#fff;"><h1 style="margin:0;font-size:20px;">RF Store</h1></td></tr><tr><td style="padding:32px;"><p style="margin:0 0 8px;font-size:16px;">Entraron <b>${n}</b> producto${n === 1 ? '' : 's'} nuevo${n === 1 ? '' : 's'} desde CDR</p><p style="margin:0 0 20px;color:#555;">Corrida del sync: ${escHtml(when)}. Entran <b>inactivos y sin categoria/marca</b>: asignales categoria, marca y revisalos para activarlos o publicarlos en Mercado Libre.</p><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:24px;"><tr><th style="text-align:left;padding:8px 12px;background:#f9fafb;border-bottom:1px solid #e5e7eb;font-size:12px;text-transform:uppercase;color:#666;">Codigo</th><th style="text-align:left;padding:8px 12px;background:#f9fafb;border-bottom:1px solid #e5e7eb;font-size:12px;text-transform:uppercase;color:#666;">Nombre</th></tr>${rows}</table><a href="${listUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;">Ver nuevos en el panel</a></td></tr><tr><td style="padding:20px 32px;background:#f4f4f5;color:#666;font-size:12px;text-align:center;">RF Store - aviso automatico de catalogo CDR</td></tr></table></td></tr></table></body></html>`;
	const text = `Entraron ${n} productos nuevos de CDR (${when}). Entran inactivos y sin categoria/marca:\n` + items.map(it => `- [${it.code}] ${it.name}`).join('\n') + `\n\nVer nuevos en el panel: ${listUrl}`;
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

// Mail-resumen al admin (cliente) con los productos cuyo CONTENIDO cambio en CDR
// (nombre/descripcion). Marca cuales quedaron bloqueados por candado y cuales estan
// publicados en ML (para que aprete "Actualizar en ML"). Best-effort: nunca rompe el sync.
async function sendContentChangesDigest(items: { code: string; name: string; locked: boolean; in_ml: boolean }[]): Promise<void> {
	if (!items || items.length === 0) return;
	if (!RESEND_API_KEY) { console.warn('RESEND_API_KEY no configurado - skip digest contenido'); return; }
	const to = await resolveAdminEmail();
	if (!to) return;
	const when = new Date().toLocaleString('es-UY', { timeZone: 'America/Montevideo' });
	const n = items.length;
	const nMl = items.filter(i => i.in_ml).length;
	const nLocked = items.filter(i => i.locked).length;
	const subject = `RF Store - CDR cambio el contenido de ${n} producto${n === 1 ? '' : 's'}`;
	const badge = (i: { locked: boolean; in_ml: boolean }) => {
		const parts: string[] = [];
		if (i.locked) parts.push('<span style="display:inline-block;background:#fef3c7;color:#92400e;border-radius:6px;padding:1px 8px;font-size:11px;">candado (no se piso)</span>');
		if (i.in_ml) parts.push('<span style="display:inline-block;background:#dbeafe;color:#1e40af;border-radius:6px;padding:1px 8px;font-size:11px;">en ML - actualizar</span>');
		return parts.join(' ') || '<span style="color:#16a34a;font-size:11px;">aplicado</span>';
	};
	const rows = items
		.map(it => `<tr><td style="padding:6px 12px;font-family:monospace;color:#555;border-bottom:1px solid #eee;">${escHtml(it.code)}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;">${escHtml(it.name)}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;">${badge(it)}</td></tr>`)
		.join('');
	const listUrl = `${SITE_URL}/dashboard/productos`;
	const mlNote = nMl > 0 ? `<p style="margin:0 0 20px;color:#555;">${nMl} de estos estan publicados en Mercado Libre: entra al panel y aprieta <b>"Actualizar en ML"</b> en cada uno para reflejar el cambio.</p>` : '';
	const lockedNote = nLocked > 0 ? `<p style="margin:0 0 8px;color:#92400e;">${nLocked} tienen el candado de contenido: NO se pisaron (los editaste a mano).</p>` : '';
	const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;"><tr><td align="center"><table width="640" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:640px;"><tr><td style="padding:24px 32px;background:#111;color:#fff;"><h1 style="margin:0;font-size:20px;">RF Store</h1></td></tr><tr><td style="padding:32px;"><p style="margin:0 0 8px;font-size:16px;">CDR cambio el contenido (nombre/descripcion) de <b>${n}</b> producto${n === 1 ? '' : 's'}</p><p style="margin:0 0 12px;color:#555;">Corrida del sync: ${escHtml(when)}. En RF Store ya quedaron actualizados (salvo los que tengan candado).</p>${lockedNote}${mlNote}<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:24px;"><tr><th style="text-align:left;padding:8px 12px;background:#f9fafb;border-bottom:1px solid #e5e7eb;font-size:12px;text-transform:uppercase;color:#666;">Codigo</th><th style="text-align:left;padding:8px 12px;background:#f9fafb;border-bottom:1px solid #e5e7eb;font-size:12px;text-transform:uppercase;color:#666;">Nombre (nuevo)</th><th style="text-align:left;padding:8px 12px;background:#f9fafb;border-bottom:1px solid #e5e7eb;font-size:12px;text-transform:uppercase;color:#666;">Estado</th></tr>${rows}</table><a href="${listUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;">Ver en el panel</a></td></tr><tr><td style="padding:20px 32px;background:#f4f4f5;color:#666;font-size:12px;text-align:center;">RF Store - aviso automatico de catalogo CDR</td></tr></table></td></tr></table></body></html>`;
	const text = `CDR cambio el contenido de ${n} productos (${when}). En RF Store ya quedaron actualizados (salvo candados):\n` +
		items.map(it => `- [${it.code}] ${it.name}${it.locked ? ' (candado, no se piso)' : ''}${it.in_ml ? ' (en ML: actualizar)' : ''}`).join('\n') +
		(nMl > 0 ? `\n\n${nMl} estan en Mercado Libre: apreta "Actualizar en ML" en el panel.` : '') +
		`\n\nVer en el panel: ${listUrl}`;
	try {
		const r = await fetch('https://api.resend.com/emails', {
			method: 'POST',
			headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ from: `RF Store <${FROM_EMAIL}>`, to: [to], subject, html, text }),
		});
		if (!r.ok) console.warn('digest contenido resend error:', r.status, (await r.text()).slice(0, 300));
	} catch (e) {
		console.warn('digest contenido fetch error:', e);
	}
}

async function downloadImage(productCode: string, idx: number, imgUrl: string): Promise<{ publicUrl: string; }> {
	const storedPath = `${productCode}/${idx}.bin`;
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), IMAGE_TIMEOUT_MS);
	let resp: Response;
	try { resp = await fetch(imgUrl, { signal: ctrl.signal }); } finally { clearTimeout(timer); }
	if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
	const contentType = resp.headers.get('content-type') || 'image/jpeg';
	const bytes = new Uint8Array(await resp.arrayBuffer());
	const { error: upErr } = await supabase.storage.from(IMAGE_BUCKET).upload(storedPath, bytes, { contentType, upsert: true });
	if (upErr) throw new Error(upErr.message);
	const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(storedPath);
	return { publicUrl: data.publicUrl };
}

// Inserta un producto nuevo SIN categoria ni marca (null) y como active=false.
// El cliente le asigna categoria/marca a mano y lo activa.
async function insertNewProduct(p: CdrProduct, counters: any): Promise<void> {
	const externalCode = p.codigo;
	if (!externalCode) return;

	const stockNum = typeof p.stock === 'number' ? p.stock : Number(p.stock) || 0;
	const priceUsd = Number(p.precio) || 0;
	// slug siempre incluye el codigo => unico aunque el nombre sea largo/duplicado.
	const baseSlug = `${slugify(p.nombre || externalCode).slice(0, 60)}-${slugify(externalCode)}`.replace(/^-+|-+$/g, '');
	const descriptionJson = p.descripcion ? { type: 'doc', content: [{ type: 'html', html: p.descripcion }] } : { type: 'doc', content: [] };
	const productRow = { name: p.nombre || externalCode, slug: baseSlug, brand_id: null, category_id: null, features: [p.copete, p.modelo ? `Modelo: ${p.modelo}` : null, p.nro_parte ? `Nro parte: ${p.nro_parte}` : null, p.gtin ? `GTIN: ${p.gtin}` : null].filter(Boolean), description: descriptionJson, images: [] as string[], image_md5s: {} as Record<string, string>, source: 'cdr', external_code: externalCode, price_usd: priceUsd, active: false, last_synced_at: new Date().toISOString() };

	// 1) Insertar el producto PRIMERO (sin imagenes). Si falla, no se bajo ninguna imagen => sin huerfanas.
	const { data: inserted, error } = await supabase.from('products').insert(productRow).select('id').single();
	if (error) { counters.errors.push(`insert ${externalCode}: ${error.message}`); return; }
	await supabase.from('variants').insert({ product_id: inserted.id, color: '#000000', color_name: 'Unico', storage: '-', price: priceUsd, stock: stockNum });
	counters.inserted++;
	(counters.inserted_list ??= []).push({ code: externalCode, name: p.nombre || externalCode });

	// 2) Imagenes best-effort: bajar y actualizar el row. Si falla, el producto queda creado (inactivo) para revisar.
	const gallery = p.galeria ?? [];
	const newMd5s: Record<string, string> = {};
	const imageUrls: string[] = [];
	for (let i = 0; i < gallery.length; i += IMAGE_CONCURRENCY) {
		const chunk = gallery.slice(i, i + IMAGE_CONCURRENCY);
		const res = await Promise.allSettled(chunk.map((g, j) => downloadImage(externalCode, i + j, g.img).then(r => ({ ...r, idx: i + j, md5: g.md5 }))));
		for (const r of res) {
			if (r.status === 'fulfilled') { imageUrls.push(r.value.publicUrl); newMd5s[String(r.value.idx)] = r.value.md5; counters.images_downloaded++; }
			else { counters.errors.push(`img ${externalCode}: ${r.reason?.message ?? r.reason}`); }
		}
	}
	if (imageUrls.length > 0) {
		const { error: upErr } = await supabase.from('products').update({ images: imageUrls, image_md5s: newMd5s }).eq('id', inserted.id);
		if (upErr) counters.errors.push(`img_update ${externalCode}: ${upErr.message}`);
	}
}

async function runSync(mode: 'new-only' | 'update-prices' | 'full', counters: any, force?: { enabled: boolean; dryRun: boolean }) {
	try {
		const products = await fetchProductosConGaleria(CDR_EMAIL, CDR_TOKEN, '2015-01-01 00:00:00');
		counters.fetched = products.length;

		// Traer TODOS los codigos existentes (PostgREST corta en 1000: paginar).
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

		const toInsert = products.filter(p => p.codigo && !existingCodes.has(p.codigo));
		const toUpdate = products.filter(p => p.codigo && existingCodes.has(p.codigo));
		counters.to_insert = toInsert.length;
		counters.to_update = toUpdate.length;

		if (mode === 'new-only' || mode === 'full') {
			for (let i = 0; i < toInsert.length; i += PRODUCT_CONCURRENCY) {
				const chunk = toInsert.slice(i, i + PRODUCT_CONCURRENCY);
				await Promise.allSettled(chunk.map(p => insertNewProduct(p, counters)));
			}
		}
		if (mode === 'update-prices' || mode === 'full') {
			// Update en LOTE (una sola operacion SQL): la corrida siempre termina y
			// reconcilia TODOS los productos (stock = CDR - reservado).
			const rows = toUpdate.map(p => ({
				code: p.codigo,
				precio: Number(p.precio) || 0,
				stock: typeof p.stock === 'number' ? p.stock : Number(p.stock) || 0,
			}));
			const { data: res, error: bulkErr } = await supabase.rpc('cdr_bulk_update_stock_price', { p_rows: rows });
			if (bulkErr) counters.errors.push(`bulk_update: ${bulkErr.message}`);
			else counters.updated = (res as { variants?: number } | null)?.variants ?? 0;

			// Contenido (nombre/descripcion/features): detecta cambios de CDR por hash y los
			// aplica (respetando content_locked). La 1er corrida solo registra la huella
			// (baseline): no pisa ni avisa. Marca ml_content_dirty si esta publicado en ML.
			const contentRows = toUpdate.map(p => ({
				code: p.codigo,
				name: p.nombre || p.codigo,
				copete: p.copete ?? '',
				modelo: p.modelo ?? '',
				description_html: p.descripcion ?? '',
				features: [p.copete, p.modelo ? `Modelo: ${p.modelo}` : null, p.nro_parte ? `Nro parte: ${p.nro_parte}` : null, p.gtin ? `GTIN: ${p.gtin}` : null].filter(Boolean),
			}));
			counters.content_applied = 0;
			counters.content_baseline = 0;
			counters.content_ml_flagged = 0;
			counters.content_would_change = 0;
			counters.content_changed_list = [] as any[];
			for (let i = 0; i < contentRows.length; i += CONTENT_CHUNK) {
				const chunk = contentRows.slice(i, i + CONTENT_CHUNK);
				if (force?.enabled) {
					// Resync FORZADO (one-shot manual): compara el CONTENIDO real de CDR vs lo
					// guardado (no por hash) para arreglar el drift previo. p_apply=false => dry-run.
					const { data: fres, error: fErr } = await supabase.rpc('cdr_force_content_resync', { p_rows: chunk, p_apply: !force.dryRun });
					if (fErr) { counters.errors.push(`force_content: ${fErr.message}`); continue; }
					const rf = fres as any;
					counters.content_would_change += Number(rf?.would_change ?? 0);
					counters.content_applied += Number(rf?.applied ?? 0);
					counters.content_ml_flagged += Number(rf?.ml_flagged ?? 0);
					if (Array.isArray(rf?.changed)) for (const c of rf.changed) counters.content_changed_list.push(c);
				} else {
					const { data: cres, error: cErr } = await supabase.rpc('cdr_bulk_update_content', { p_rows: chunk });
					if (cErr) { counters.errors.push(`content_update: ${cErr.message}`); continue; }
					const rc = cres as any;
					counters.content_applied += Number(rc?.applied ?? 0);
					counters.content_baseline += Number(rc?.baseline ?? 0);
					counters.content_ml_flagged += Number(rc?.ml_flagged ?? 0);
					if (Array.isArray(rc?.changed)) for (const c of rc.changed) counters.content_changed_list.push(c);
				}
			}
		}
		counters.ok = counters.errors.length === 0;
		counters.finished_at = new Date().toISOString();
		await setSetting(`cdr_last_sync_report_${mode}`, counters);
		await setSetting('cdr_last_sync_report', counters);
		await setSetting('cdr_last_full_sync', new Date().toISOString().slice(0, 19).replace('T', ' '));
		// Digests POR CORRIDA: apagados por defecto (cdr_digest_daily=true). Ahora hay UN mail
		// consolidado diario a las 6 AM Montevideo (edge fn cdr-daily-digest via cron
		// cdr_daily_digest_tick). Se pueden reactivar por corrida con cdr_digest_daily=false.
		const perRunDigests = (await getSetting<boolean>('cdr_digest_daily', true)) === false;
		if (perRunDigests && !force?.enabled) {
			await sendNewProductsDigest(counters.inserted_list ?? []);
			await sendContentChangesDigest(counters.content_changed_list ?? []);
		}
		// Aviso al DEV si la corrida termino con errores (visibilidad, no mas fallas mudas).
		if ((counters.errors?.length ?? 0) > 0) {
			await sendAdminAlert(`RF Store - Sync CDR (${mode}) termino con ${counters.errors.length} error(es)`, [`Insertados: ${counters.inserted}, Actualizados: ${counters.updated}, Imagenes: ${counters.images_downloaded}`, ...((counters.errors as string[]).slice(0, 30))]);
		}
	} catch (e: any) {
		counters.errors.push(`fatal: ${e.message}`);
		counters.ok = false;
		counters.finished_at = new Date().toISOString();
		await setSetting(`cdr_last_sync_report_${mode}`, counters);
		await setSetting('cdr_last_sync_report', counters);
		await sendAdminAlert(`RF Store - Sync CDR (${mode}) FALLO`, [`Error fatal: ${e.message}`]);
	}
}

Deno.serve(async req => {
	if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
	const body: { mode?: 'new-only' | 'update-prices' | 'full'; background?: boolean; full?: boolean; force_content?: boolean; force_dry_run?: boolean } = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
	const mode = body.mode ?? (body.full ? 'full' : 'new-only');
	const bg = body.background !== false;
	// Resync FORZADO de contenido (one-shot manual): solo tiene sentido en modos que corren
	// el update (update-prices/full). force_dry_run cuenta sin aplicar.
	const force = body.force_content ? { enabled: true, dryRun: body.force_dry_run === true } : undefined;
	const counters: any = { inserted: 0, updated: 0, images_downloaded: 0, fetched: 0, already_in_db: 0, to_insert: 0, to_update: 0, errors: [], inserted_list: [], mode };

	if (bg) {
		// @ts-ignore EdgeRuntime global
		EdgeRuntime.waitUntil(runSync(mode, counters, force));
		return new Response(JSON.stringify({ ok: true, started: true, mode_dispatched: mode }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 202 });
	}
	await runSync(mode, counters, force);
	return new Response(JSON.stringify(counters), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
});
