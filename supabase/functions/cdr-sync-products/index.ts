// deno-lint-ignore-file no-explicit-any
// Edge Function: cdr-sync-products (v32)
// Sincroniza catalogo y precios desde CDR. El update de precios/stock se hace
// en LOTE via RPC cdr_bulk_update_stock_price (una sola operacion).
// v32 (2026-09-03): guarda los 13 CAMPOS NUEVOS de la doc v2.0 en columnas cdr_*
//  (marca, categoria, garantia, peso, medidas, pvp/pvpml, gtin, modelo, nro_parte...).
//  Antes solo se guardaban nombre/copete/descripcion/precio/stock, y modelo, nro_parte
//  y gtin iban DENTRO del array `features` como texto suelto ("GTIN: 69235..."), que
//  ml-publish-item volvia a parsear con regex.
//  Van a columnas SEPARADAS y NO entran en el hash de contenido, a proposito: sumar
//  campos al hash cambia su formula y marca de golpe los 1857 productos como
//  'cambiados' -> pisaria nombre y descripcion de todo lo no bloqueado, prenderia
//  ml_content_dirty en todo lo publicado en ML y dispararia un mail gigante. Como dato
//  crudo del proveedor en columnas propias, se refrescan siempre sin tocar nada editable.
// v31 (2026-09-03): separa la marca de "ultimo sync" (cdr_last_full_sync, la que muestra
//  el panel, en toda corrida) de la de "ultimo feed COMPLETO" (cdr_last_full_feed_at, la
//  que reconcilia y vigila health-alerts). Con una sola, o el panel mentia 12 h o la
//  alerta no podia distinguir un incremental de una reconciliacion.
// v30 (2026-09-03): separa MODO de FEED y unifica el tick. `mode: full` significa
//  'alta Y update', NO 'traeme el catalogo entero': estaban mezclados y por eso el
//  tick unificado habria pedido el catalogo completo cada 5 min. Ahora el catalogo
//  completo se pide SOLO con full_feed=true (o si no hay cursor).
//  Con eso alcanza UNA sola llamada cada 5 min que hace todo (altas + precio + stock
//  + contenido), que es el ritmo que la propia doc de CDR usa de ejemplo en 4.2, y
//  el stock que trae es el disponible AL MOMENTO DE LA CONSULTA (campo `stock`).
// v29 (2026-09-03): FECHA INCREMENTAL + filtro de `habilitado`. Ver docs/cdr/README.md.
//  La doc v2.0 de CDR (01/09/2026) dice que repetir el full sync TRANCA EL USUARIO:
//  no es eficiencia, es condicion de uso. Haciamos 168 catalogos completos por dia
//  (4 MB cada uno, ~672 MB/dia) porque la fecha estaba hardcodeada en 2015-01-01.
//  Ahora:
//   - cada modo lleva su propio cursor (app_settings.cdr_ws_cursor_<modo>) y pide
//     solo lo modificado desde su ultima corrida OK. Cursores SEPARADOS por modo:
//     con uno compartido, update-prices se comeria los productos nuevos antes de
//     que new-only llegue a insertarlos.
//   - el cursor se calcula ANTES de llamar (si se tomara despues se perderian los
//     cambios ocurridos durante la corrida) y se guarda SOLO si la corrida sirvio.
//     Con full sync una corrida fallida se recuperaba sola; con incremental no.
//   - solapamiento de CURSOR_OVERLAP_MIN para cubrir desfasaje de reloj con CDR:
//     repetir unos productos es gratis, perderlos es invisible y permanente.
//   - la reconciliacion por ausencia (apagar lo que ya no viene) ahora se pide
//     EXPLICITAMENTE con p_reconcile, y solo en full feed. En un incremental
//     'no vino' significa 'no cambio', no 'lo dieron de baja'.
//   - filtro de `habilitado` (doc 7.1): se castea a numero, comparar contra 1 o
//     "1" falla segun el cliente SOAP. CDR devuelve SIEMPRE los deshabilitados
//     ignorando el filtro de fecha (hallazgo nuestro, ver README): son la mayoria
//     del payload de un incremental. No se dan de alta y se les fuerza stock 0.
// v28 (2026-07-22): SUPRESION de mail por fallo transitorio. El WS de CDR se cae
//  ~1 vez al dia (mantenimiento de medianoche) y mandaba un mail de FALLO diario a
//  las 00:03. Ahora: si la corrida anterior del mismo modo fue OK hace <2 h, el
//  fallo se registra en cdr_sync_run_history pero NO manda mail (el proximo tick lo
//  confirma). DOS fallos seguidos => mail (problema real).
// v27 (2026-07-22): REINTENTO de slug ante colision. CDR usa codigos casi identicos
//  para publicaciones distintas ("CEL1315" vs "CEL1315." vs "CEL1315O") y el slugify
//  descarta los simbolos => mismo slug => el insert chocaba con products_slug_key en
//  CADA corrida (mail de error por hora). Ahora reintenta con sufijo -2/-3.
// v26 (2026-07-22): TOPE de inserciones por corrida. El feed de CDR salto de ~1900
//  a ~4200 productos y quedaron ~1600 altas pendientes: una corrida new-only que
//  intenta insertarlos TODOS (con descarga de imagenes) muere por limite de tiempo
//  SIN escribir reporte ni mandar alerta (falla muda). Ahora:
//   - se insertan de a tandas (app_settings.cdr_max_inserts_per_run, default 100)
//     y el resto queda como backlog para la proxima corrida (counters.insert_backlog).
//   - dedupe del feed por codigo (el WS de CDR devuelve conteos inconsistentes
//     entre corridas: 1879 vs 4251 el mismo dia).
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
// Tope default de inserciones por corrida (configurable: app_settings.cdr_max_inserts_per_run).
const MAX_INSERTS_PER_RUN_DEFAULT = 100;
// Ventana para considerar "transitorio" un fallo fatal: si la corrida anterior del mismo
// modo fue OK dentro de esta ventana, no se manda mail (cubre cadencia horaria del new-only).
const TRANSIENT_WINDOW_MS = 2 * 60 * 60 * 1000;
// Tamano de lote para el RPC de contenido (el payload trae nombre+descripcion+features,
// mucho mas pesado que solo precio/stock -> chunk para no mandar varios MB de una).
const CONTENT_CHUNK = 300;
// Los campos cdr_* son livianos (no llevan la descripcion HTML), asi que van en
// tandas mas grandes que el contenido.
const FIELDS_CHUNK = 500;
// Fecha para pedir el catalogo COMPLETO. Solo en las corridas de reconciliacion:
// repetirla en cada tick es lo que hace que CDR tranque el usuario.
const FULL_FEED_DATE = '2015-01-01 00:00:00';
// Solapamiento del cursor: al guardar la marca de tiempo se le restan estos minutos.
// Cubre el desfasaje de reloj entre este runtime y el de CDR. Traer unos productos
// repetidos no cuesta nada; perder un cambio no da error y queda congelado para siempre.
const CURSOR_OVERLAP_MIN = 15;

// Formato que pide CDR: YYYY-MM-DD HH:MM:SS
const fmtCdr = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

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

// Fila de campos crudos de CDR para el RPC cdr_bulk_update_fields.
// Se accede a TODO con `?? ''` porque el WS omite la clave entera cuando el dato no
// esta cargado, en vez de mandarla vacia (doc 7.2): los combos (codigo con "+") llegan
// sin `marca`, sin `webmarca` y sin `garantia`. En JS eso es undefined, no ''.
function cdrFieldsRow(p: CdrProduct) {
	return {
		code: p.codigo,
		gtin: p.gtin ?? '',
		modelo: p.modelo ?? '',
		nro_parte: p.nro_parte ?? '',
		marca: p.marca ?? '',
		webmarca: p.webmarca ?? '',
		fabricante: p.fabricante ?? '',
		categoria: p.categoria ?? '',
		garantia: p.garantia ?? '',
		vinculogarantia: p.vinculogarantia ?? '',
		descripcion_comercial: p.descripcion_comercial ?? '',
		// Numeros: el WS mezcla tipos (doc 7.6). `precio` y `peso` llegan como string
		// ("92.00", "700") y `pvp` como number, asi que se convierte siempre explicito.
		pvp: Number(p.pvp ?? 0) || 0,
		pvpml: Number(p.pvpml ?? 0) || 0,
		peso: Number(p.peso ?? 0) || 0,
		ancho: Number(p.ancho ?? 0) || 0,
		alto: Number(p.alto ?? 0) || 0,
		profundidad: Number(p.profundidad ?? 0) || 0,
		// El cast numerico es la UNICA prueba que funciona siempre (doc 7.1).
		habilitado: Number(p.habilitado ?? 0) > 0 ? 1 : 0,
	};
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
	// v32: el alta ya nace con los campos de CDR cargados (antes se llenaban recien en
	// la siguiente corrida). `?? null` en todo: el WS omite claves enteras (doc 7.2).
	const f = cdrFieldsRow(p);
	const productRow = { name: p.nombre || externalCode, slug: baseSlug, brand_id: null, category_id: null, features: [p.copete, p.modelo ? `Modelo: ${p.modelo}` : null, p.nro_parte ? `Nro parte: ${p.nro_parte}` : null, p.gtin ? `GTIN: ${p.gtin}` : null].filter(Boolean), description: descriptionJson, images: [] as string[], image_md5s: {} as Record<string, string>, source: 'cdr', external_code: externalCode, price_usd: priceUsd, active: false, last_synced_at: new Date().toISOString(),
		cdr_gtin: f.gtin || null, cdr_modelo: f.modelo || null, cdr_nro_parte: f.nro_parte || null,
		cdr_marca: f.marca || null, cdr_marca_url: f.webmarca || null, cdr_fabricante_url: f.fabricante || null,
		cdr_categoria: f.categoria || null, cdr_garantia: f.garantia || null, cdr_garantia_url: f.vinculogarantia || null,
		cdr_descripcion_comercial: f.descripcion_comercial || null,
		// 0 = "sin sugerido", no "gratis" (doc 7.7) -> null.
		cdr_pvp_usd: f.pvp || null, cdr_pvpml_usd: f.pvpml || null,
		cdr_peso_gramos: f.peso || null, cdr_ancho_cm: f.ancho || null, cdr_alto_cm: f.alto || null, cdr_profundidad_cm: f.profundidad || null,
		cdr_habilitado: f.habilitado > 0, cdr_fields_updated_at: new Date().toISOString() };

	// 1) Insertar el producto PRIMERO (sin imagenes). Si falla, no se bajo ninguna imagen => sin huerfanas.
	// v27: si choca el slug (codigos CDR casi identicos: "CEL1315" vs "CEL1315." slugifican
	// igual), reintenta con sufijo -2/-3 en vez de fallar la alta en cada corrida.
	let inserted: { id: string } | null = null;
	let lastErr: { message: string } | null = null;
	for (let attempt = 1; attempt <= 3; attempt++) {
		const slugTry = attempt === 1 ? baseSlug : `${baseSlug}-${attempt}`;
		const { data, error } = await supabase.from('products').insert({ ...productRow, slug: slugTry }).select('id').single();
		if (!error) { inserted = data; lastErr = null; break; }
		lastErr = error;
		if (!(error.message ?? '').includes('products_slug_key')) break;
	}
	if (!inserted) { counters.errors.push(`insert ${externalCode}: ${lastErr?.message}`); return; }
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

async function runSync(mode: 'new-only' | 'update-prices' | 'full', counters: any, force?: { enabled: boolean; dryRun: boolean }, fullFeed?: boolean) {
	// v29: la fecha ya NO es fija. Cada modo lleva su cursor y pide solo lo que
	// cambio desde su ultima corrida OK.
	const cursorKey = `cdr_ws_cursor_${mode}`;
	const cursor = await getSetting<string>(cursorKey, '');
	// OJO: el MODO y el FEED son cosas distintas.
	//   mode 'full'  = que haga las dos cosas, altas Y update (vs solo una).
	//   fullFeed     = que le pida a CDR el catalogo COMPLETO en vez del incremental.
	// Mezclarlos hacia que el tick unificado (mode 'full' cada 5 min) pidiera el
	// catalogo entero en cada corrida, que es exactamente lo que hay que evitar.
	// Full feed solo si lo piden explicito, o si todavia no hay cursor (primera
	// corrida: hay que partir de una foto completa).
	const isFullFeed = fullFeed === true || !cursor;
	const fecha = isFullFeed ? FULL_FEED_DATE : cursor;
	// El proximo cursor se calcula ANTES de llamar: si se tomara al terminar, todo
	// lo que CDR modifique DURANTE la corrida quedaria del lado ya consultado y se
	// perderia. El solapamiento cubre ademas el desfasaje de reloj.
	const nextCursor = fmtCdr(new Date(Date.now() - CURSOR_OVERLAP_MIN * 60_000));
	counters.feed_mode = isFullFeed ? 'full' : 'incremental';
	counters.fecha_desde = fecha;
	// coreOk decide si el cursor puede avanzar: solo lo bajan el fallo del WS y el
	// del update en lote. Un error de imagen o de un alta puntual NO debe trabar el
	// cursor para siempre (el full feed los recupera).
	let coreOk = true;
	try {
		const fetchedRaw = await fetchProductosConGaleria(CDR_EMAIL, CDR_TOKEN, fecha);
		// v26: dedupe por codigo (el WS de CDR devuelve conteos inconsistentes; ante
		// codigos repetidos nos quedamos con la primera aparicion).
		const seenCodes = new Set<string>();
		const products: CdrProduct[] = [];
		for (const p of fetchedRaw) {
			if (!p.codigo || seenCodes.has(p.codigo)) continue;
			seenCodes.add(p.codigo);
			products.push(p);
		}
		counters.fetched = fetchedRaw.length;
		counters.fetched_unique = products.length;

		// v29: `habilitado` (doc 7.1). Es decimal y puede llegar como 1/0 o "1.0"/"0.0"
		// segun el cliente SOAP: la unica prueba que funciona siempre es el cast numerico.
		// CDR devuelve SIEMPRE los deshabilitados, ignorando el filtro de fecha, asi que
		// en un incremental suelen ser la mayoria del payload.
		const habilitados: CdrProduct[] = [];
		const deshabilitados: CdrProduct[] = [];
		for (const p of products) {
			if (Number((p as any).habilitado ?? 0) > 0) habilitados.push(p);
			else deshabilitados.push(p);
		}
		counters.disabled_in_feed = deshabilitados.length;

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

		// Solo los habilitados entran o se actualizan. Un producto que CDR despublico
		// NUNCA se da de alta.
		const toInsert = habilitados.filter(p => p.codigo && !existingCodes.has(p.codigo));
		const toUpdate = habilitados.filter(p => p.codigo && existingCodes.has(p.codigo));
		counters.disabled_skipped_insert = deshabilitados.filter(p => p.codigo && !existingCodes.has(p.codigo)).length;
		counters.to_insert = toInsert.length;
		counters.to_update = toUpdate.length;

		if (mode === 'new-only' || mode === 'full') {
			// v26: TOPE por corrida. Insertar miles de productos (con imagenes) en una sola
			// corrida mata el edge function por limite de tiempo (falla MUDA: sin reporte ni
			// alerta). Se procesa una tanda y el resto queda como backlog para la proxima.
			const maxInserts = Number(await getSetting<number | string>('cdr_max_inserts_per_run', MAX_INSERTS_PER_RUN_DEFAULT)) || MAX_INSERTS_PER_RUN_DEFAULT;
			const insertBatch = toInsert.slice(0, maxInserts);
			counters.insert_batch = insertBatch.length;
			counters.insert_backlog = toInsert.length - insertBatch.length;
			for (let i = 0; i < insertBatch.length; i += PRODUCT_CONCURRENCY) {
				const chunk = insertBatch.slice(i, i + PRODUCT_CONCURRENCY);
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
			// Deshabilitados que YA tenemos: se les fuerza stock 0 (CDR los despublico).
			// No se borran ni se desactivan solos: eso lo decide el admin. El RPC sigue
			// respetando stock_locked y el owned_stock del deposito.
			const disabledRows = deshabilitados
				.filter(p => p.codigo && existingCodes.has(p.codigo))
				.map(p => ({ code: p.codigo, precio: Number(p.precio) || 0, stock: 0 }));
			counters.disabled_zeroed = disabledRows.length;
			// p_reconcile: apagar lo ausente SOLO tiene sentido si esto es el catalogo
			// completo. En incremental, 'no vino' = 'no cambio'.
			const { data: res, error: bulkErr } = await supabase.rpc('cdr_bulk_update_stock_price', { p_rows: [...rows, ...disabledRows], p_reconcile: isFullFeed });
			if (bulkErr) { counters.errors.push(`bulk_update: ${bulkErr.message}`); coreOk = false; }
			else { counters.updated = (res as { variants?: number } | null)?.variants ?? 0; counters.bulk = res; }

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
			// v32: campos crudos de CDR (marca, categoria, garantia, medidas...). Se mandan
			// TODOS los del feed, habilitados y no: para los deshabilitados es lo que deja
			// cdr_habilitado en false y permite listarlos en el panel.
			// El RPC solo escribe si algo cambio de verdad, asi que en las 288 corridas
			// diarias no genera escrituras ni disk IO al pedo.
			const fieldRows = [...toUpdate, ...deshabilitados.filter(p => p.codigo && existingCodes.has(p.codigo))].map(cdrFieldsRow);
			counters.fields_updated = 0;
			for (let i = 0; i < fieldRows.length; i += FIELDS_CHUNK) {
				const chunk = fieldRows.slice(i, i + FIELDS_CHUNK);
				const { data: fres, error: fErr } = await supabase.rpc('cdr_bulk_update_fields', { p_rows: chunk });
				// Best-effort: si falla, se anota pero NO baja coreOk. Son datos de referencia;
				// trabar el cursor por esto haria perder cambios de precio y stock, que importan mas.
				if (fErr) { counters.errors.push(`fields_update: ${fErr.message}`); continue; }
				counters.fields_updated += Number((fres as any)?.fields_updated ?? 0);
			}

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
		// v29: el cursor avanza SOLO si la corrida sirvio. Si falla, la proxima vuelve
		// a pedir desde la misma fecha y se recupera sola. Si quedaron altas en backlog
		// tampoco avanza, para no dejarlas afuera de la proxima ventana.
		if (coreOk && (counters.insert_backlog ?? 0) === 0) {
			await setSetting(cursorKey, nextCursor);
			counters.cursor_saved = nextCursor;
		} else {
			counters.cursor_saved = null;
			counters.cursor_kept = cursor || null;
		}
		await setSetting(`cdr_last_sync_report_${mode}`, counters);
		await setSetting('cdr_last_sync_report', counters);
		// v31: DOS marcas distintas, porque responden preguntas distintas.
		//  cdr_last_full_sync   = "cuando corrio el sync por ultima vez". La muestra el panel
		//    (DashboardCdrSyncPage) como 'Ultima fecha de sync'. Se actualiza en TODA corrida
		//    OK: si solo se tocara en el full feed, el panel mostraria hasta 12 h de atraso y
		//    pareceria que el sync esta muerto.
		//  cdr_last_full_feed_at = "cuando se pidio el catalogo COMPLETO por ultima vez", que
		//    es la unica corrida que reconcilia por ausencia. health-alerts vigila ESTA: si
		//    pasan mas de ~14 h sin una, se pierde la red de seguridad contra la ventana de
		//    24 h de CDR y el stock puede quedar congelado en silencio.
		await setSetting('cdr_last_full_sync', new Date().toISOString().slice(0, 19).replace('T', ' '));
		if (isFullFeed) await setSetting('cdr_last_full_feed_at', new Date().toISOString().slice(0, 19).replace('T', ' '));
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
		// Fallo fatal: el cursor NO se toca. La proxima corrida vuelve a pedir desde
		// la misma fecha y recupera lo de esta ventana.
		coreOk = false;
		counters.errors.push(`fatal: ${e.message}`);
		counters.ok = false;
		counters.cursor_kept = cursor || null;
		counters.finished_at = new Date().toISOString();
		await setSetting(`cdr_last_sync_report_${mode}`, counters);
		await setSetting('cdr_last_sync_report', counters);
		// v30: el limite de accesos por hora de CDR es AUTOLIMITANTE (se libera solo al
		// pasar la hora) y el cursor no avanzo, asi que no se perdio nada. No merece un
		// mail: solo queda en el historial.
		const rateLimited = /MAXIMOS DE ACCESOS/i.test(String(e?.message ?? ''));
		if (rateLimited) counters.rate_limited = true;
		// v28: supresion de fallo TRANSITORIO. El WS de CDR se cae ~1 vez al dia
		// (mantenimiento de medianoche) y esto mandaba un mail de FALLO diario a las 00:03.
		// Si la corrida anterior del mismo modo fue OK hace <2 h, es un hipo puntual: queda
		// registrado en cdr_sync_run_history pero NO se manda mail (el proximo tick, a los
		// 10 min, confirma). DOS fallos seguidos => mail (problema real).
		// Nota: el trigger de app_settings ya inserto ESTA corrida fallida en el historial,
		// por eso la "anterior" es range(1,1).
		let transient = false;
		try {
			const { data: prev } = await supabase
				.from('cdr_sync_run_history')
				.select('ok, created_at')
				.eq('mode', mode)
				.order('id', { ascending: false })
				.range(1, 1);
			const p = (prev ?? [])[0] as { ok: boolean | null; created_at: string } | undefined;
			transient = p?.ok === true && Date.now() - new Date(p.created_at).getTime() < TRANSIENT_WINDOW_MS;
		} catch (_) { /* si falla la consulta del historial, mandamos el mail igual */ }
		if (rateLimited || transient) {
			console.warn(`fallo no-critico (${mode}) - mail suprimido${rateLimited ? ' [rate limit CDR]' : ''}:`, e.message);
		} else {
			await sendAdminAlert(`RF Store - Sync CDR (${mode}) FALLO`, [`Error fatal: ${e.message}`, 'Segundo fallo consecutivo (o sin corrida previa OK reciente).']);
		}
	}
}

Deno.serve(async req => {
	if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
	const body: { mode?: 'new-only' | 'update-prices' | 'full'; background?: boolean; full?: boolean; full_feed?: boolean; force_content?: boolean; force_dry_run?: boolean } = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
	const mode = body.mode ?? (body.full ? 'full' : 'new-only');
	const bg = body.background !== false;
	// Resync FORZADO de contenido (one-shot manual): solo tiene sentido en modos que corren
	// el update (update-prices/full). force_dry_run cuenta sin aplicar.
	const force = body.force_content ? { enabled: true, dryRun: body.force_dry_run === true } : undefined;
	// full_feed: pedir el catalogo COMPLETO en esta corrida (reconciliacion). Lo usa
	// el cron de full sync; el resto de los ticks van incrementales.
	const fullFeed = body.full_feed === true;
	const counters: any = { inserted: 0, updated: 0, images_downloaded: 0, fetched: 0, already_in_db: 0, to_insert: 0, to_update: 0, errors: [], inserted_list: [], mode };

	if (bg) {
		// @ts-ignore EdgeRuntime global
		EdgeRuntime.waitUntil(runSync(mode, counters, force, fullFeed));
		return new Response(JSON.stringify({ ok: true, started: true, mode_dispatched: mode }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 202 });
	}
	await runSync(mode, counters, force, fullFeed);
	return new Response(JSON.stringify(counters), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
});
