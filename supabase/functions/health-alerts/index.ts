// deno-lint-ignore-file no-explicit-any
// health-alerts (v6, 2026-09-21)
// Vigilante del sistema: chequea cada hora y manda UN reporte por mail por dia con todo
// lo que no deberia estar pasando.
//
// Por que existe: el 2026-08-26 se descubrio que 74 publicaciones de ML estaban pausadas con
// stock disponible desde hacia semanas (bug de reactivacion, ver ml-process-sync-queue v12).
// Nadie se entero porque nada vigilaba nada: el sistema fallaba en silencio. Esto cierra eso.
//
// UN SOLO MAIL POR DIA, 9:00 de Uruguay, con todo junto (pedido explicito del dueño:
// "que me llegue 1 por dia con todo, no quiero que me atomice").
// La DETECCION es horaria y el AVISO se acumula: correr los chequeos seguido permite fechar
// con precision desde cuando esta rota cada cosa (first_seen_at) y registrar las que aparecen
// y se arreglan solas entre reportes, sin que eso cueste un mail cada vez.
// El reporte sale SIEMPRE, incluso sin novedades: en un mail diario el silencio no puede
// significar dos cosas a la vez ("todo bien" y "el vigilante se murio").
// Estado en public.health_alerts_state; ultima fecha de envio en app_settings.health_alerts_last_digest.
//
// Cada chequeo esta aislado en try/catch: si uno se rompe, abre la incidencia 'check_failed'
// y los demas siguen corriendo. El vigilante nunca se cae entero por un chequeo malo.
//
// v2: dos falsos positivos que aparecieron en la primera corrida real.
//  - ventas manuales por descripcion libre (manual_description) nacen SIN order_items a
//    proposito -> no son "ordenes cobradas sin productos" (ordenes 291 y 310).
//  - una publicacion que ML pausa por 'out_of_stock' teniendo RF tambien 0 no es una anomalia:
//    es la realidad coincidiendo, solo esta viejo nuestro mapping.
// v3: de aviso por incidencia a REPORTE DIARIO unico (ver bloque de arriba).
// v4 (2026-08-27): chequeo ml_qty_mismatch. Hasta ahora se vigilaba que la publicacion
//    estuviera VIVA, pero no que el NUMERO fuera el correcto. El dueño lo puso en palabras:
//    "es importantisimo tener el stock sincronizado". Ahora se compara, publicacion por
//    publicacion, la cantidad que ve el comprador en ML contra la de RF.
// v5 (2026-09-03): adaptado al sync INCREMENTAL de CDR (cdr-sync-products v29-v31).
//    - cdr_feed_drop comparaba `fetched` entre corridas cualesquiera. Con el incremental eso
//      dejo de tener sentido: una corrida trae 0-60 productos y el full feed 1857, asi que la
//      comparacion generaba falsos criticos por mail. Ahora se comparan full contra full.
//    - NUEVO cdr_full_feed_stale: vigila que el catalogo COMPLETO siga corriendo.
//    - los rate limit de CDR no cuentan como corridas fallidas.
// v6 (2026-09-21): el vigilante estuvo 18 dias diciendo "todo en orden" mientras NO entraba
//    ni un producto nuevo de CDR. Lo detecto el cliente. Dos agujeros, los dos tapados:
//    - NUEVO cdr_insert_stalled: el feed completo detectaba 55 altas y no insertaba ninguna
//      (iba en mode 'update-prices', que las cuenta y no las da de alta). La señal
//      `to_insert > 0 con inserted = 0` estuvo a la vista 36 corridas y nadie la miraba.
//    - NUEVO cdr_no_new_products: red de seguridad por dias sin altas, por si el fallo
//      viene por otro lado.
//    - ARREGLADO cdr_failed_runs: miraba "las ultimas 20 corridas" sin distinguir tipo, y
//      con 288 incrementales por dia eso son 90 MINUTOS. Un full feed que corre cada 12 h
//      no caia nunca ahi: venia fallando desde el 18/09 y no se reporto una sola vez.
//      Ahora los full feed tienen su propio chequeo (cdr_full_feed_failed).
// v7 (2026-09-22): el vigilante tenia el chequeo correcto y no vio nada. ml_active_no_stock
//    exigia que NUESTRO mapping dijera 'active'; las 32 publicaciones que estaban vendiendo
//    sin stock lo tenian en 'paused' mientras ML las tenia ACTIVAS. El mapping desactualizado
//    era la causa del problema Y la razon por la que el chequeo no lo veia. Ahora el estado
//    lo dicta ML. Se suma ml_stock_out_of_sync: lo que se intento corregir y ML no dejo.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const ML_CLIENT_ID = Deno.env.get('ML_CLIENT_ID')!;
const ML_CLIENT_SECRET = Deno.env.get('ML_CLIENT_SECRET')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'pedidos@rfstore.uy';
const ADMIN_EMAIL_ENV = Deno.env.get('ADMIN_EMAIL') ?? '';
const ML_TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';
const ML_API_BASE = 'https://api.mercadolibre.com';

const MODERATION_SUBSTATUS = ['under_review', 'banned', 'forbidden', 'freezed', 'deleted', 'suspended', 'waiting_for_patch'];
// UN mail por dia, a las 9 de la mañana de Uruguay. Los chequeos igual corren cada hora: eso
// permite fechar con precision cuando empezo cada problema y no perder los que aparecen y se
// arreglan solos entre reportes. Lo que se acumula es el AVISO, no la deteccion.
const DIGEST_HOUR_UY = 9;
const UY_OFFSET_MS = 3 * 3600_000; // Uruguay es UTC-3 fijo (no tiene horario de verano desde 2015)
// Horas sin una corrida de catalogo COMPLETO antes de avisar.
// 22/09/2026: el full feed paso de 2 por dia a CADA HORA, porque se verifico que es el UNICO
// que actualiza el stock -- el incremental no trae cambios de stock, solo los deshabilitados
// (33 productos tenian stock distinto al de CDR, todos con last_synced_at en el full feed
// anterior; el incremental no los trajo en 10 h y el full los corrigio todos de una).
// Con el stock dependiendo de una corrida horaria, esperar 14 h para avisar deja el catalogo
// medio dia desincronizado sin que nadie se entere. 3 h = ya se saltearon tres corridas.
const FULL_FEED_MAX_HOURS = 3;
// Dias sin que entre un producto nuevo de CDR antes de avisar. CDR da de alta casi todos los
// dias; 3 dias secos ya es raro y 7 es casi seguro que las altas se rompieron.
const NO_NEW_PRODUCTS_MAX_DAYS = 3;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

type Finding = { key: string; check_id: string; severity: 'crit' | 'warn'; title: string; detail: any; fingerprint: string };

const nowIso = () => new Date().toISOString();
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

// --------------------------------------------------------------------------------------
// helpers
// --------------------------------------------------------------------------------------

// PostgREST corta en 1000 filas: paginar siempre, si no los chequeos mienten en silencio.
async function fetchAll(table: string, columns: string, tweak?: (q: any) => any): Promise<any[]> {
  const out: any[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(table).select(columns).range(from, from + PAGE - 1);
    if (tweak) q = tweak(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

async function getMlToken(): Promise<string> {
  const { data: cred } = await supabase.from('ml_credentials').select('*').order('id', { ascending: false }).limit(1).maybeSingle();
  if (!cred) throw new Error('no_ml_credentials');
  if (new Date(cred.expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
    const resp = await fetch(ML_TOKEN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: ML_CLIENT_ID, client_secret: ML_CLIENT_SECRET, refresh_token: cred.refresh_token }).toString(),
    });
    const data: any = await resp.json();
    if (!resp.ok) throw new Error(`refresh_token: ${JSON.stringify(data).slice(0, 200)}`);
    const exp = new Date(Date.now() + (Number(data.expires_in) - 30) * 1000).toISOString();
    await supabase.from('ml_credentials').update({ access_token: data.access_token, refresh_token: data.refresh_token ?? cred.refresh_token, expires_at: exp }).eq('id', cred.id);
    return data.access_token;
  }
  return cred.access_token;
}

// multiget de ML: 20 ids por request es el maximo que acepta /items?ids=
async function mlItemStates(ids: string[], token: string): Promise<Map<string, { status: string; sub: string[]; qty: number | null }>> {
  const out = new Map<string, { status: string; sub: string[]; qty: number | null }>();
  for (let i = 0; i < ids.length; i += 20) {
    const chunk = ids.slice(i, i + 20);
    const r = await fetch(`${ML_API_BASE}/items?ids=${chunk.join(',')}&attributes=id,status,sub_status,available_quantity`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) continue;
    const arr: any = await r.json();
    for (const e of Array.isArray(arr) ? arr : []) {
      const b = e?.body;
      if (b?.id) out.set(String(b.id), { status: String(b.status ?? ''), sub: (b.sub_status ?? []).map((s: any) => String(s)), qty: b.available_quantity ?? null });
    }
  }
  return out;
}

const isModerated = (st: string, sub: string[]) => MODERATION_SUBSTATUS.some(f => sub.includes(f)) || st === 'under_review';

async function notifyEmail(): Promise<string> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'alerts_notify_email').maybeSingle();
  const fromSetting = typeof data?.value === 'string' ? data.value : (data?.value as any)?.email;
  return fromSetting || ADMIN_EMAIL_ENV || 'nexuscode.company@gmail.com';
}

// --------------------------------------------------------------------------------------
// chequeos
// --------------------------------------------------------------------------------------

// Barrido unico contra la API de ML de TODAS las publicaciones que creemos vivas.
// De aca salen 5 incidencias distintas; se hace en una sola pasada para no repetir requests.
async function checkMercadoLibre(): Promise<Finding[]> {
  const f: Finding[] = [];
  const [mappings, variants, products, settingRow] = await Promise.all([
    fetchAll('ml_item_mapping', 'id, ml_item_id, status, auto_paused_stock, product_id, variant_id, stock_out_of_sync, out_of_sync_since, out_of_sync_reason', q => q.in('status', ['active', 'paused'])),
    fetchAll('variants', 'id, stock'),
    fetchAll('products', 'id, name, external_code, stock_locked'),
    supabase.from('app_settings').select('value').eq('key', 'ml_stock_threshold').maybeSingle(),
  ]);
  const threshold = Number((settingRow as any)?.data?.value ?? 0) || 0;
  const stockOf = new Map(variants.map((v: any) => [v.id, Number(v.stock ?? 0)]));
  const prodOf = new Map(products.map((p: any) => [p.id, p]));

  const token = await getMlToken();
  const states = await mlItemStates(mappings.map((m: any) => m.ml_item_id).filter(Boolean), token);

  // Los hallazgos de ML se AGRUPAN por tipo, no uno por publicacion: hoy hay ~180 fichas
  // moderadas por ML de arrastre, y un mail con 180 items no lo lee nadie. Una incidencia por
  // tipo, con el conteo y una muestra; el fingerprint es el conteo, asi que solo re-avisa
  // cuando el numero se mueve (aparecio una nueva o se arreglo alguna).
  const buckets: Record<string, any[]> = { ml_paused_with_stock: [], ml_moderated: [], ml_down_externally: [], ml_active_no_stock: [], ml_qty_mismatch: [] };

  for (const m of mappings as any[]) {
    const st = states.get(m.ml_item_id);
    if (!st) continue; // ML no la devolvio (borrada/ajena): no inventamos una incidencia
    const p: any = prodOf.get(m.product_id) ?? {};
    const stock = stockOf.get(m.variant_id) ?? 0;
    const thr = p.stock_locked ? 0 : threshold;
    const label = `${p.external_code ?? '?'} — ${p.name ?? m.ml_item_id}`;
    const row = { ml_item_id: m.ml_item_id, producto: label, stock_rf: stock, ml_status: st.status, ml_sub_status: st.sub.join(',') };

    // 1) EL BUG DE AGOSTO: la pausamos nosotros por stock, volvio el stock y sigue pausada.
    //    Con ml-process-sync-queue v12 esto deberia auto-resolverse en < 2 min; si aparece,
    //    la reactivacion se volvio a romper.
    if (m.status === 'paused' && m.auto_paused_stock && stock > thr && st.status === 'paused' && !isModerated(st.status, st.sub)) buckets.ml_paused_with_stock.push(row);
    // 2) ML la moderó (ficha incompleta, infraccion). No se toca sola: hay que arreglar la ficha.
    if (isModerated(st.status, st.sub)) buckets.ml_moderated.push(row);
    // 3) Nosotros la creemos activa y ML la tiene pausada/cerrada por su cuenta -> no vende y no lo sabiamos.
    //    Excepcion: ML pausada por 'out_of_stock' con RF tambien en 0 no es una anomalia, es la
    //    realidad coincidiendo (solo esta desactualizado nuestro mapping). Avisar seria ruido.
    const coherentSinStock = st.sub.includes('out_of_stock') && stock <= thr;
    if (m.status === 'active' && (st.status === 'paused' || st.status === 'closed') && !isModerated(st.status, st.sub) && !coherentSinStock) buckets.ml_down_externally.push(row);
    // 4) Activa en ML sin stock real en RF -> riesgo de vender algo que no tenemos.
    //    v7 (2026-09-22): ESTE CHEQUEO EXISTIA Y NO VIO NADA. Exigia m.status === 'active',
    //    o sea que NUESTRA anotacion dijera que la publicacion estaba activa. Las 32 que
    //    estaban vendiendo sin stock tenian el mapping en 'paused' y ML las tenia ACTIVAS:
    //    justamente por estar desactualizado el mapping es que nadie les bajo el stock, y por
    //    mirar ese mismo mapping es que el vigilante tampoco las vio. Ahora la condicion la
    //    pone ML y solo ML: si ML dice que esta activa y ofrece unidades, se mira, diga lo que
    //    diga nuestra anotacion.
    if (st.status === 'active' && Number(st.qty ?? 0) > 0 && stock <= thr) buckets.ml_active_no_stock.push({ ...row, stock_en_ml: st.qty, mapping_status: m.status });
    // 5) La pregunta que importa de verdad: ¿el numero que ve el comprador en ML es el que
    //    tenemos? Se compara contra el MISMO objetivo que usa el sincronizador (0 cuando el
    //    stock esta en el umbral o por debajo), tambien sin filtrar por m.status.
    //    En una pausada ML congela la cantidad vieja a proposito, asi que esas no cuentan:
    //    no son vendibles y avisar por ellas seria ruido (lo cubre el reconciliador).
    const objetivo = stock <= thr ? 0 : stock;
    if (st.status === 'active' && !isModerated(st.status, st.sub)
        && st.qty !== null && Number(st.qty) !== objetivo && objetivo > 0) {
      buckets.ml_qty_mismatch.push({ ...row, stock_en_ml: st.qty, deberia_ser: objetivo });
    }
  }

  const titles: Record<string, (n: number) => string> = {
    ml_paused_with_stock: n => `${n} publicacion(es) pausadas en ML teniendo stock — la reactivacion automatica no esta funcionando`,
    ml_moderated: n => `${n} publicacion(es) bajo revision de ML (ficha incompleta o infraccion)`,
    ml_down_externally: n => `${n} publicacion(es) que damos por activas estan caidas en ML`,
    ml_active_no_stock: n => `${n} publicacion(es) ACTIVAS en ML ofreciendo stock que RF no tiene — se puede vender algo inexistente`,
    ml_qty_mismatch: n => `${n} publicacion(es) activas muestran en ML una cantidad distinta a la de RF`,
  };
  for (const [id, rows] of Object.entries(buckets)) {
    if (!rows.length) continue;
    f.push({
      key: id, check_id: id, severity: 'crit', title: titles[id](rows.length),
      detail: { total: rows.length, muestra: rows.slice(0, 15), ...(rows.length > 15 ? { nota: `y ${rows.length - 15} mas` } : {}) },
      fingerprint: String(rows.length),
    });
  }
  return f;
}

// Desincronizaciones que el sistema intento arreglar y NO pudo: ML bloquea la edicion de la
// publicacion y no hay hermana del mismo inventario por donde bajar el stock. Antes esto se
// enterraba como 'skipped_moderated' con result='ok' y desaparecia de todos lados; asi CEL2261
// estuvo seis semanas invisible hasta que se vendio.
// Va como chequeo APARTE y no dentro del barrido de ML a proposito: aquel solo mira los
// mappings en active/paused y dejaba afuera 9 de las 27 marcadas. Un chequeo que informa dos
// tercios de lo que pasa es exactamente la clase de verdad a medias que causo este incidente.
async function checkStockOutOfSync(): Promise<Finding[]> {
  const rows = await fetchAll('ml_item_mapping', 'ml_item_id, status, out_of_sync_since, out_of_sync_reason, ml_verified_qty, ml_verified_status, product_id', q => q.eq('stock_out_of_sync', true));
  if (!rows.length) return [];
  const products = await fetchAll('products', 'id, name, external_code');
  const prodOf = new Map(products.map((p: any) => [p.id, p]));
  // Las que ML tiene ACTIVAS son las unicas que pueden vender algo inexistente ahora mismo.
  const vendibles = rows.filter((r: any) => r.ml_verified_status === 'active');
  const muestra = rows.slice(0, 15).map((r: any) => {
    const p: any = prodOf.get(r.product_id) ?? {};
    return { ml_item_id: r.ml_item_id, producto: `${p.external_code ?? '?'} - ${p.name ?? r.ml_item_id}`, stock_en_ml: r.ml_verified_qty, ml_status: r.ml_verified_status, desde: r.out_of_sync_since, motivo: String(r.out_of_sync_reason ?? '').slice(0, 160) };
  });
  return [{
    key: 'ml_stock_out_of_sync', check_id: 'ml_stock_out_of_sync',
    severity: vendibles.length ? 'crit' : 'warn',
    title: vendibles.length
      ? `${vendibles.length} publicacion(es) ACTIVAS con stock que no se puede corregir - ML tiene bloqueada la edicion`
      : `${rows.length} publicacion(es) sin sincronizar - ML tiene bloqueada la edicion (ninguna esta activa, no venden)`,
    detail: { total: rows.length, activas: vendibles.length, que_hacer: 'Se resuelve en ML: destrabar la publicacion (Mis publicaciones -> motivo de la revision) o darla de baja. Por API no hay forma.', muestra },
    fingerprint: `${rows.length}:${vendibles.length}`,
  }];
}

// La cola que empuja precio y stock a ML. Si se traba o falla, ML queda desincronizado.
async function checkSyncQueue(): Promise<Finding[]> {
  const f: Finding[] = [];
  const { data: errs } = await supabase.from('ml_sync_queue').select('id, operation, variant_id, last_error, created_at').eq('status', 'error').gte('created_at', hoursAgo(24));
  if (errs?.length) {
    f.push({ key: 'ml_queue_errors', check_id: 'ml_queue_errors', severity: 'crit', title: `${errs.length} operacion(es) hacia ML fallaron en las ultimas 24 h`, detail: { total: errs.length, muestra: errs.slice(0, 10) }, fingerprint: String(errs.length) });
  }
  // 'pending' vencido hace rato = el cron jobid 13 no esta corriendo, o la funcion se cae al arrancar.
  const { data: stuck } = await supabase.from('ml_sync_queue').select('id').eq('status', 'pending').lt('scheduled_for', hoursAgo(0.25)).limit(500);
  if (stuck && stuck.length > 0) {
    f.push({ key: 'ml_queue_stuck', check_id: 'ml_queue_stuck', severity: 'crit', title: `La cola de ML esta trabada: ${stuck.length} pendiente(s) hace mas de 15 min`, detail: { pendientes: stuck.length }, fingerprint: stuck.length > 50 ? 'muchos' : 'pocos' });
  }
  // 'processing' viejo = una corrida murio a mitad y dejo filas tomadas que nadie va a procesar.
  const { data: zombie } = await supabase.from('ml_sync_queue').select('id').eq('status', 'processing').lt('created_at', hoursAgo(1)).limit(500);
  if (zombie && zombie.length > 0) {
    f.push({ key: 'ml_queue_zombie', check_id: 'ml_queue_zombie', severity: 'warn', title: `${zombie.length} fila(s) de la cola de ML quedaron colgadas en 'processing'`, detail: { colgadas: zombie.length }, fingerprint: String(zombie.length) });
  }
  return f;
}

// El feed de CDR es la fuente de precio y stock de casi todo el catalogo.
// v5: reescrito para el sync INCREMENTAL (ver historial arriba).
// v6 (2026-09-21): DOS AGUJEROS que dejaron pasar 18 dias sin altas sin un solo aviso.
//  a) No habia NINGUN chequeo de altas. El 03/09 dejaron de entrar productos nuevos (el
//     feed completo iba en modo 'update-prices', que los detecta y NO los inserta) y el
//     reporte diario siguio diciendo "todo en orden" 18 dias. Lo detecto el CLIENTE, no
//     nosotros. Ahora se vigila la señal exacta que estuvo a la vista 36 corridas
//     seguidas: to_insert > 0 con inserted = 0. Y de red, los dias sin un alta.
//  b) cdr_failed_runs miraba "las ultimas 20 corridas" SIN distinguir el tipo. Con 288
//     incrementales por dia, 20 corridas = 90 MINUTOS, asi que un full feed que corre
//     cada 12 h no cae NUNCA en esa ventana. El full feed venia fallando desde el 18/09
//     ('content_update: null value in column features') y no se reporto una sola vez.
//     Ahora los full feed se miran aparte, sobre sus propias ultimas corridas.
async function checkCdrSync(): Promise<Finding[]> {
  const f: Finding[] = [];
  const { data: runs } = await supabase.from('cdr_sync_run_history').select('id, mode, ok, fetched, errors, report, created_at').order('id', { ascending: false }).limit(20);
  if (!runs?.length) {
    f.push({ key: 'cdr_no_runs', check_id: 'cdr_sync', severity: 'crit', title: 'El sync de CDR no tiene ninguna corrida registrada', detail: {}, fingerprint: 'none' });
    return f;
  }
  const last: any = runs[0];
  const mins = Math.round((Date.now() - new Date(last.created_at).getTime()) / 60000);
  // cron cada 5 min: 45 sin correr es que se apago o se cuelga.
  if (mins > 45) {
    f.push({ key: 'cdr_stale', check_id: 'cdr_sync', severity: 'crit', title: `El sync de CDR no corre hace ${mins} min`, detail: { ultima: last.created_at, mode: last.mode }, fingerprint: mins > 180 ? 'muy_viejo' : 'viejo' });
  }
  // Los rate limit de CDR NO son un fallo nuestro: son autolimitantes (se liberan al pasar
  // la hora) y el cursor no avanza, asi que no se pierde ningun cambio.
  // v6: esta ventana son ~90 min de corridas INCREMENTALES. Sirve para ver que el tick de
  // 5 min este sano, y para nada mas: los full feed se chequean por separado mas abajo.
  const failed = (runs as any[]).filter(r => r.ok === false && !r.report?.rate_limited);
  if (failed.length) {
    f.push({ key: 'cdr_failed_runs', check_id: 'cdr_sync', severity: 'warn', title: `${failed.length} de las ultimas 20 corridas de CDR (tick de 5 min) fallaron`, detail: { muestra: failed.slice(0, 5).map((r: any) => ({ id: r.id, mode: r.mode, errors: r.errors })) }, fingerprint: String(failed.length) });
  }

  // ---- Todo lo que sigue mira el FULL FEED, que es otra cosa --------------------------
  // Con una corrida por hora, estas 8 son las ultimas 8 horas. Mirarlas mezcladas con los
  // incrementales es precisamente lo que oculto el fallo del 18/09.
  const { data: fullRuns, error: fullErr } = await supabase
    .from('cdr_sync_run_history')
    .select('id, fetched, ok, errors, report, created_at')
    .filter('report->>feed_mode', 'eq', 'full')
    .order('id', { ascending: false })
    .limit(8);

  // Si la consulta falla NO se asume lo peor: decir "no hay full feed" cuando en realidad
  // no pudimos mirar seria una falsa alarma critica. Se reporta como chequeo roto.
  if (fullErr) {
    f.push({ key: 'cdr_full_feed_check_failed', check_id: 'cdr_sync', severity: 'warn', title: 'No se pudo verificar si el catalogo completo de CDR esta corriendo', detail: { error: String(fullErr.message).slice(0, 300) }, fingerprint: 'query_error' });
    return f;
  }

  // v6: full feeds que terminaron mal. ANTES no se miraban nunca (quedaban fuera de la
  // ventana de 20 corridas) y por eso el bug de `features` estuvo 3 dias sin reportarse.
  const fullFailed = (fullRuns ?? []).filter((r: any) => r.ok === false && !r.report?.rate_limited);
  if (fullFailed.length) {
    f.push({
      key: 'cdr_full_feed_failed', check_id: 'cdr_sync', severity: 'crit',
      title: `${fullFailed.length} de las ultimas ${(fullRuns ?? []).length} corridas de catalogo COMPLETO de CDR fallaron`,
      detail: { por_que: 'El full feed es el unico que da de alta y el unico que reconcilia el stock. Si falla, el tick de 5 min no lo suple ni lo denuncia.', muestra: fullFailed.slice(0, 4).map((r: any) => ({ id: r.id, cuando: r.created_at, errors: r.errors })) },
      fingerprint: String(fullFailed.length),
    });
  }

  const lastFull: any = (fullRuns ?? []).find((r: any) => r.ok !== false);
  if (!lastFull) {
    f.push({ key: 'cdr_no_full_feed', check_id: 'cdr_sync', severity: 'crit', title: 'No hay ninguna corrida de catalogo COMPLETO de CDR — no entran altas ni se reconcilia el stock', detail: { nota: 'Sin full feed no se apaga el stock de los productos que CDR deja de mandar, y tampoco entra ningun producto nuevo.', esperado: 'cada hora (cron cdr-sync-fullfeed, minuto 10)' }, fingerprint: 'never' });
    return f;
  }

  const hs = Math.round((Date.now() - new Date(lastFull.created_at).getTime()) / 3600_000);
  if (hs >= FULL_FEED_MAX_HOURS) {
    f.push({ key: 'cdr_full_feed_stale', check_id: 'cdr_sync', severity: 'crit', title: `Hace ${hs} h que no corre el catalogo completo de CDR — el stock puede quedar congelado`, detail: { ultimo_full_feed: lastFull.created_at, esperado: 'cada hora (minuto 10)', por_que: 'Es la unica corrida que apaga el stock de productos que CDR dejo de mandar, y CDR los devuelve solo durante 24 h.' }, fingerprint: hs >= 26 ? 'critico' : 'atrasado' });
  }

  // ---- ALTAS: la señal que se nos paso 18 dias ----------------------------------------
  // El feed completo es el UNICO lugar donde CDR muestra los productos nuevos: el
  // incremental no los trae (verificado; docs/cdr/README.md "Hallazgo 5"). Si una corrida
  // completa dice "hay 55 para insertar" y despues inserta 0, las altas estan rotas, por
  // mas que la corrida diga ok: true.
  const ti = Number(lastFull.report?.to_insert ?? 0);
  const ins = Number(lastFull.report?.inserted ?? 0);
  if (ti > 0 && ins === 0) {
    f.push({
      key: 'cdr_insert_stalled', check_id: 'cdr_sync', severity: 'crit',
      title: `CDR tiene ${ti} producto(s) nuevo(s) esperando y no se dio de alta ninguno`,
      detail: {
        corrida: lastFull.id, cuando: lastFull.created_at, to_insert: ti, inserted: ins,
        que_mirar: 'cdr-sync-fullfeed tiene que llamar con mode=full. En update-prices las altas se detectan y NO se insertan.',
        historia: 'Asi se perdieron 18 dias de altas entre el 03/09 y el 21/09/2026.',
      },
      fingerprint: String(ti),
    });
  }

  // Red de seguridad por si el fallo viene de otro lado (el WS deja de mandar altas, el
  // tope por corrida queda en 0, la corrida muere antes de insertar): si hace dias que no
  // entra NADA, hay que mirarlo igual.
  const { data: lastNew } = await supabase.from('products').select('created_at').eq('source', 'cdr').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (lastNew?.created_at) {
    const dias = Math.floor((Date.now() - new Date(lastNew.created_at).getTime()) / 86_400_000);
    if (dias >= NO_NEW_PRODUCTS_MAX_DAYS) {
      f.push({
        key: 'cdr_no_new_products', check_id: 'cdr_sync', severity: dias >= 7 ? 'crit' : 'warn',
        title: `Hace ${dias} dias que no entra un producto nuevo de CDR`,
        detail: { ultima_alta: lastNew.created_at, nota: `CDR viene dando de alta productos casi todos los dias. ${NO_NEW_PRODUCTS_MAX_DAYS}+ dias sin ninguno casi siempre significa que las altas se rompieron, no que CDR dejo de publicar.` },
        fingerprint: dias >= 7 ? 'critico' : String(dias),
      });
    }
  }

  // Caida brusca del feed COMPLETO: se comparan full contra full, que es lo unico
  // comparable. Un incremental trae 0-60 productos por diseño y no dice nada del catalogo.
  const counts = (fullRuns ?? []).map((r: any) => Number(r.fetched ?? 0)).filter(n => n > 0).sort((a, b) => a - b);
  if (counts.length >= 3) {
    const median = counts[Math.floor(counts.length / 2)];
    const lastFetched = Number(lastFull.fetched ?? 0);
    if (median > 0 && lastFetched > 0 && lastFetched < median * 0.75) {
      f.push({ key: 'cdr_feed_drop', check_id: 'cdr_sync', severity: 'crit', title: `El catalogo completo de CDR cayo a ${lastFetched} productos (lo normal ronda ${median})`, detail: { ultimo: lastFetched, mediana_full_feeds: median }, fingerprint: `${Math.round((lastFetched / median) * 10)}` });
    }
  }
  return f;
}

// Plata: ordenes cobradas que quedaron a medias en la base.
async function checkOrders(): Promise<Finding[]> {
  const f: Finding[] = [];
  const since = hoursAgo(24 * 14);
  const orders = await fetchAll('orders', 'id, status, payment_status, payment_method, channel, concept_id, manual_description, created_at, total_amount', q => q.gte('created_at', since));
  if (!orders.length) return f;
  // in() de a 200: con 14 dias de ordenes la URL se pasa de largo y PostgREST devuelve 414.
  const withItems = new Set<any>();
  const ids = orders.map((o: any) => o.id);
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const rows = await fetchAll('order_items', 'order_id', q => q.in('order_id', chunk));
    for (const r of rows) withItems.add(r.order_id);
  }

  // Sin items = sin costo, sin ganancia y sin descuento de stock. Fue un bug real en ML
  // (ver rfstore-ml-ventas-de-catalogo-sin-items): las ventas de catalogo entraban vacias.
  // NO cuentan las ventas manuales por concepto (concept_id) ni por descripcion libre
  // (manual_description): esas nacen sin productos a proposito, no es un agujero.
  // Ademas 2 h de gracia: una venta de ML recien entrada todavia puede estar completandose
  // por el reproceso del webhook, y avisar a los 5 minutos seria una falsa alarma.
  const graceMs = 2 * 3600_000;
  const vacias = orders.filter((o: any) => o.payment_status === 'paid' && !withItems.has(o.id)
    && !o.concept_id && !o.manual_description
    && new Date(o.created_at).getTime() < Date.now() - graceMs);
  if (vacias.length) {
    f.push({ key: 'orders_paid_no_items', check_id: 'orders', severity: 'crit', title: `${vacias.length} orden(es) cobradas quedaron SIN productos cargados`, detail: { ordenes: vacias.slice(0, 10).map((o: any) => ({ id: o.id, channel: o.channel, total: o.total_amount, fecha: o.created_at })) }, fingerprint: String(vacias.length) });
  }
  // Concretada pero el pago figura pendiente: o no cobramos, o falta confirmarlo (y el cliente
  // nunca recibio el mail de pago confirmado). Ver rfstore-email-formspree.
  const desalineadas = orders.filter((o: any) => o.status === 'Concretado' && o.payment_status === 'pending' && new Date(o.created_at).getTime() < Date.now() - 24 * 3600_000);
  if (desalineadas.length) {
    f.push({ key: 'orders_payment_mismatch', check_id: 'orders', severity: 'warn', title: `${desalineadas.length} orden(es) Concretadas siguen con el pago sin confirmar`, detail: { ordenes: desalineadas.slice(0, 10).map((o: any) => ({ id: o.id, metodo: o.payment_method, fecha: o.created_at })) }, fingerprint: String(desalineadas.length) });
  }
  return f;
}

// El dolar: si esta funcion falla, todo el catalogo se muestra mal precio.
async function checkFxRate(): Promise<Finding[]> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/get-fx-rate`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } });
  if (!r.ok) return [{ key: 'fx_down', check_id: 'fx', severity: 'crit', title: `La cotizacion del dolar no responde (HTTP ${r.status})`, detail: { status: r.status }, fingerprint: String(r.status) }];
  const j: any = await r.json().catch(() => ({}));
  const rate = Number(j?.rate);
  if (!rate || rate <= 0) return [{ key: 'fx_invalid', check_id: 'fx', severity: 'crit', title: 'La cotizacion del dolar devolvio un valor invalido', detail: j, fingerprint: 'invalid' }];
  // Un salto grande casi siempre es la fuente rota, no el mercado.
  if (rate < 25 || rate > 70) return [{ key: 'fx_out_of_range', check_id: 'fx', severity: 'crit', title: `La cotizacion del dolar dio ${rate}, fuera de todo rango razonable`, detail: j, fingerprint: String(Math.round(rate)) }];
  return [];
}

// --------------------------------------------------------------------------------------
// mail
// --------------------------------------------------------------------------------------

function renderEmail(nuevas: any[], resueltas: any[], recordatorio: any[]): { subject: string; html: string; text: string } {
  const crit = nuevas.filter(n => n.severity === 'crit').length;
  // El asunto lo decide lo mas urgente que haya. Si no hay NADA igual sale el mail: en un
  // reporte diario el silencio no puede significar dos cosas ("todo bien" y "el vigilante
  // se murio"), asi que el dia bueno tiene que decir explicitamente que esta todo bien.
  const subject = nuevas.length
    ? `${crit ? '🔴' : '🟠'} RF Store: ${nuevas.length} problema${nuevas.length > 1 ? 's' : ''} nuevo${nuevas.length > 1 ? 's' : ''}`
    : recordatorio.length
      ? `🟠 RF Store: ${recordatorio.length} problema${recordatorio.length > 1 ? 's' : ''} sin resolver`
      : resueltas.length
        ? `✅ RF Store: ${resueltas.length} problema${resueltas.length > 1 ? 's' : ''} resuelto${resueltas.length > 1 ? 's' : ''}`
        : '✅ RF Store: todo en orden';

  const li = (r: any, icon: string) => {
    const d = r.detail && Object.keys(r.detail).length ? `<div style="font:12px/1.5 ui-monospace,Menlo,monospace;color:#555;background:#f6f6f6;border-radius:6px;padding:8px;margin-top:6px;white-space:pre-wrap;word-break:break-word">${escapeHtml(JSON.stringify(r.detail, null, 2)).slice(0, 1200)}</div>` : '';
    const desde = r.first_seen_at ? `<div style="font:12px/1.4 system-ui;color:#888;margin-top:4px">desde ${new Date(r.first_seen_at).toLocaleString('es-UY', { timeZone: 'America/Montevideo' })}</div>` : '';
    return `<li style="margin:0 0 14px"><b style="font:15px/1.4 system-ui">${icon} ${escapeHtml(r.title)}</b>${desde}${d}</li>`;
  };
  const section = (t: string, rows: any[], icon: string) => rows.length
    ? `<h3 style="font:600 15px/1.4 system-ui;margin:22px 0 10px;color:#111">${t}</h3><ul style="padding-left:18px;margin:0">${rows.map(r => li(r, icon)).join('')}</ul>` : '';

  const html = `<div style="max-width:720px;margin:0 auto;padding:24px;font:14px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111">
    <h2 style="font:700 19px/1.3 system-ui;margin:0 0 4px">Reporte de salud — RF Store</h2>
    <div style="color:#777;font-size:13px">${new Date().toLocaleString('es-UY', { timeZone: 'America/Montevideo' })}</div>
    ${nuevas.length || recordatorio.length || resueltas.length ? '' : '<p style="margin:22px 0 0;font-size:15px">Sin novedades: los 5 chequeos pasaron limpios.</p>'}
    ${section('Nuevo desde el reporte anterior', nuevas, '🔴')}
    ${section('Sigue sin resolverse', recordatorio, '🟠')}
    ${section('Resuelto', resueltas, '✅')}
    <p style="color:#888;font-size:12px;margin-top:28px;border-top:1px solid #eee;padding-top:12px">
      Reporte diario, 9:00. Los chequeos corren cada hora; el mail se manda una sola vez por dia con todo junto.<br>
      Cambiar destinatario: <code>app_settings.alerts_notify_email</code>.
    </p></div>`;

  const text = [...nuevas.map(n => `[NUEVO] ${n.title}`), ...recordatorio.map(n => `[ABIERTO] ${n.title}`), ...resueltas.map(n => `[RESUELTO] ${n.title}`)].join('\n');
  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

// --------------------------------------------------------------------------------------
// run
// --------------------------------------------------------------------------------------

async function run(force = false) {
  const checks: Array<[string, () => Promise<Finding[]>]> = [
    ['mercadolibre', checkMercadoLibre],
    ['sync_queue', checkSyncQueue],
    ['stock_out_of_sync', checkStockOutOfSync],
    ['cdr_sync', checkCdrSync],
    ['orders', checkOrders],
    ['fx', checkFxRate],
  ];

  const findings: Finding[] = [];
  const healthy: string[] = [];
  for (const [name, fn] of checks) {
    try {
      findings.push(...await fn());
      healthy.push(name);
    } catch (e: any) {
      // Un chequeo roto ES una incidencia: si no, el vigilante calla por estar ciego.
      findings.push({ key: `check_failed:${name}`, check_id: 'check_failed', severity: 'crit', title: `El chequeo "${name}" se rompio y no pudo verificar nada`, detail: { error: String(e?.message ?? e).slice(0, 500) }, fingerprint: String(e?.message ?? e).slice(0, 80) });
    }
  }

  // Estado ANTES de esta corrida. Se traen tambien las resueltas recientes: si una incidencia
  // ya cerrada vuelve a aparecer no es "nueva", es una recaida, y hay que decirlo asi.
  const { data: prevRows } = await supabase.from('health_alerts_state').select('*');
  const prev = new Map((prevRows ?? []).map((r: any) => [r.key, r]));
  const seen = new Set(findings.map(f => f.key));
  const ts = nowIso();

  for (const f of findings) {
    const before: any = prev.get(f.key);
    if (!before || before.resolved_at) {
      // Nueva o recaida: en ambos casos arranca un ciclo nuevo, con first_seen_at de hoy.
      await supabase.from('health_alerts_state').upsert({ key: f.key, check_id: f.check_id, severity: f.severity, title: f.title, detail: f.detail, fingerprint: f.fingerprint, first_seen_at: ts, last_seen_at: ts, resolved_at: null });
    } else {
      // Sigue abierta: se refresca el contenido pero se CONSERVA first_seen_at, que es el dato
      // que responde "¿desde cuando esta rota?" en el reporte.
      await supabase.from('health_alerts_state').update({ severity: f.severity, title: f.title, detail: f.detail, fingerprint: f.fingerprint, last_seen_at: ts }).eq('key', f.key);
    }
  }

  for (const [key, row] of prev) {
    if (seen.has(key) || row.resolved_at) continue;
    await supabase.from('health_alerts_state').update({ resolved_at: ts }).eq('key', key);
  }

  // ---- Reporte: UNA vez por dia, 9:00 de Uruguay ----
  // El dueño pidio explicitamente 1 mail por dia con todo junto ("no quiero que me atomice"),
  // asi que la deteccion es horaria pero el aviso se acumula. Se manda cuando ya paso la hora
  // del reporte y el ultimo que salio NO fue de hoy; si un dia el cron no corre a las 9, la
  // primera corrida posterior lo manda igual (por eso se compara el DIA, no la hora exacta).
  const { data: lastDigestRow } = await supabase.from('app_settings').select('value').eq('key', 'health_alerts_last_digest').maybeSingle();
  const lastDigestAt: string | null = (lastDigestRow?.value as any)?.at ?? null;
  const lastDigestDay: string | null = (lastDigestRow?.value as any)?.uy_day ?? null;
  const uyNow = new Date(Date.now() - UY_OFFSET_MS);
  const uyDay = uyNow.toISOString().slice(0, 10);
  const shouldSend = force || (uyNow.getUTCHours() >= DIGEST_HOUR_UY && lastDigestDay !== uyDay);

  let emailed = false;
  let nuevas: any[] = [], recordatorio: any[] = [], resueltas: any[] = [];

  if (shouldSend) {
    const cutoff = lastDigestAt ? new Date(lastDigestAt).getTime() : 0;
    const { data: current } = await supabase.from('health_alerts_state').select('*');
    for (const r of (current ?? []) as any[]) {
      if (!r.resolved_at) {
        // "Nuevo" = aparecio despues del ultimo reporte. Lo demas ya lo venia viendo.
        (new Date(r.first_seen_at).getTime() > cutoff ? nuevas : recordatorio).push(r);
      } else if (new Date(r.resolved_at).getTime() > cutoff) {
        resueltas.push(r);
      }
    }
    nuevas.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'crit' ? -1 : 1));

    const to = await notifyEmail();
    if (RESEND_API_KEY) {
      const { subject, html, text } = renderEmail(nuevas, resueltas, recordatorio);
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: `RF Store <${FROM_EMAIL}>`, to: [to], subject, html, text }),
      });
      emailed = r.ok;
      if (!r.ok) console.error('resend', r.status, (await r.text()).slice(0, 300));
    } else {
      console.warn('RESEND_API_KEY no configurada - no se envia mail');
    }
    // Solo se marca el reporte como enviado si REALMENTE salio: si Resend falla, el proximo
    // intento vuelve a armarlo con la misma ventana en vez de saltearse el dia.
    if (emailed) {
      await supabase.from('app_settings').upsert({ key: 'health_alerts_last_digest', value: { at: ts, uy_day: uyDay } as any, updated_at: ts });
      // Las resueltas ya reportadas no hacen falta mas; se guardan 30 dias por si sirven de historial.
      await supabase.from('health_alerts_state').delete().not('resolved_at', 'is', null).lt('resolved_at', hoursAgo(24 * 30));
    }
  }

  const abiertas = findings.length;
  const report = { enviado: shouldSend, nuevas: nuevas.map(n => n.title), recordatorio: recordatorio.map(n => n.title), resueltas: resueltas.map((n: any) => n.title), healthy };
  await supabase.from('health_alerts_runs').insert({ ok: true, checks_run: checks.length, opened: nuevas.length, resolved: resueltas.length, still_open: abiertas, emailed, report });
  return { ok: true, abiertas, reporte_enviado: shouldSend, nuevas: nuevas.length, recordatorio: recordatorio.length, resueltas: resueltas.length, emailed };
}

Deno.serve(async (req: Request) => {
  const qs = new URL(req.url).searchParams;
  // ?sync=1 devuelve el resultado en vez de disparar y cortar (para probar a mano).
  // ?force=1 manda el reporte ya, sin esperar a la hora del dia (tambien para probar).
  const force = qs.get('force') === '1';
  if (qs.get('sync') === '1') {
    try { return new Response(JSON.stringify(await run(force)), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
    catch (e: any) {
      await supabase.from('health_alerts_runs').insert({ ok: false, error: String(e?.message ?? e).slice(0, 500) });
      return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  }
  // @ts-ignore EdgeRuntime
  EdgeRuntime.waitUntil(run(force).catch(async (e: any) => {
    await supabase.from('health_alerts_runs').insert({ ok: false, error: String(e?.message ?? e).slice(0, 500) });
  }));
  return new Response(JSON.stringify({ ok: true, started: true }), { status: 202, headers: { 'Content-Type': 'application/json' } });
});
