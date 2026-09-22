// deno-lint-ignore-file no-explicit-any
// Procesa pending de ml_sync_queue: update_stock, update_price, pause, reactivate, close
// REACTIVACION (2026-06-17, refinada): solo se reactiva una publicacion pausada si
// ML mismo indica que la pauso por STOCK (sub_status incluye 'out_of_stock') y NO
// tiene flags de moderacion. Gateado por app_settings.ml_auto_reactivate_enabled.
//
// v6 (2026-06-24):
//  - update_price: si ML tiene el item MODERADO (under_review / forbidden / banned / etc.)
//    el precio esta BLOQUEADO ('item.price.not_modifiable') -> se SALTEA y se loguea
//    'skipped_moderated' (no error, no reintento infinito).
//  - se loguea el CUERPO del error de ML (no solo el status).
//  - reintentos con backoff para errores transitorios (red / 5xx / 429); los 4xx quedan en error.
//
// v7 (2026-06-26):
//  - update_price: ML SI permite cambiar el currency_id de una publicacion activa (verificado
//    empiricamente con PUT /items -> 200). La logica anterior que forzaba la moneda actual era
//    incorrecta y hacia que bajar el umbral USD no tuviera efecto sobre lo ya publicado.
//    Ahora se empuja SIEMPRE la moneda OBJETIVO (la que dicta el umbral). Si ML rechaza el
//    cambio de moneda (algunos items con ventas pueden bloquearlo), se hace FALLBACK a la
//    moneda actual del item convirtiendo el precio con el dolar, para no fallar la operacion.
//
// v9 (2026-08-03):
//  - El stock que se publica en ML es SIEMPRE el de RF Store (variants.stock). Los productos
//    con STOCK MANUAL (products.stock_locked = mercaderia propia comprada a CDR) usan umbral 0
//    en vez de app_settings.ml_stock_threshold: se venden hasta la ultima unidad, porque el
//    stock esta fisicamente y no depende de que CDR lo tenga.
//
// v10 (2026-08-03):
//  - REACTIVACION en productos con stock_locked: se reactiva tambien la publicacion que ML
//    reporta como 'paused_by_seller' (antes solo la de 'out_of_stock'). Motivo: cuando el
//    admin carga stock manual esta declarando mercaderia propia, y ML marca como "pausada por
//    el vendedor" tanto las pausas manuales como las que hicimos nosotros por stock 0 -> la
//    publicacion quedaba muerta con stock cargado. Las MODERADAS por ML se siguen respetando.
//
// v11 (2026-08-04):
//  - update_stock con mapping en 'paused': si ML responde que la publicacion esta ACTIVA,
//    el mapping esta desactualizado (el vendedor la reactivo a mano en ML). Se corrige el
//    mapping y se empuja la cantidad, en vez de abandonar con 'skipped_not_stock_pause'
//    (que dejaba la publicacion sin sincronizar stock NUNCA MAS -> riesgo de sobreventa).
//    El chequeo va ARRIBA del candado ml_auto_reactivate_enabled: si ya esta activa no hay
//    nada que reactivar, solo sincronizarle el stock.
//
// v12 (2026-08-26):
//  - BUG DE FONDO de la reactivacion: la condicion exigia sub_status 'out_of_stock', pero ese
//    flag SOLO aparece cuando ML pausa por su cuenta. Cuando pausamos NOSOTROS por stock<=umbral
//    (PUT status=paused) ML la marca 'paused_by_seller' -> la condicion era inalcanzable para
//    nuestras propias pausas y la publicacion quedaba muerta para siempre aunque volviera el
//    stock. La excepcion v10 tapaba el agujero solo para stock_locked; el dropship (la mayoria)
//    quedaba afuera. Caso real: FIL42 / MLU694332931 pausada el 19/08 por stock 0 de CDR, stock
//    de vuelta en 10 el 20/08, reactivacion abandonada con 'skipped_not_stock_pause'; 74
//    publicaciones en el mismo estado, la mas vieja desde el 14/07.
//    FIX: la prueba de que la pausa fue NUESTRA por stock ya la teniamos guardada y no se miraba:
//    ml_item_mapping.auto_paused_stock. Ese flag lo pone en true SOLO la pausa automatica por
//    stock; la pausa MANUAL (operation 'pause') lo pone en false a proposito. Asi que se reactiva
//    tambien cuando auto_paused_stock = true, respetando siempre la moderacion de ML.
//    Sigue valiendo la regla de oro: NUNCA reactivar una pausa manual ni una suspension.
//
// v13 (2026-08-27): update_stock no tenia el candado de moderacion que update_price ya tenia
// desde v6. Cuando ML tiene un item MODERADO bloquea TODA edicion -> nuestros PUT volvian
// 400 ('item.status.not_modifiable' / 'field_not_updatable'), se reintentaban 3 veces y
// terminaban en 'error'. Dos publicaciones forbidden (CEL2261 y RAN76) ensuciaban la alerta
// todos los dias con un fallo que no es nuestro y que reintentar no arregla.
// Ahora, ante un 400 se consulta el estado real: si esta moderado se loguea 'skipped_moderated'
// y se da por terminado. La consulta se hace SOLO al fallar, no en cada actualizacion, para
// no duplicar las llamadas a ML de todo el catalogo.
// El problema de fondo (la moderacion) se reporta aparte, en el chequeo ml_moderated de
// health-alerts: ahi es donde tiene que verse, no como "fallo de sincronizacion".
//
// v14 (2026-09-22): EL BUG QUE TERMINO EN UNA VENTA SIN STOCK.
// El 22/09 se vendio en ML un Redmi Note 15 Pro (CEL2261) que RF no tenia. Al mirarlo habia
// 32 publicaciones ACTIVAS ofreciendo 154 unidades inexistentes. Dos agujeros, los dos aca:
//
//  a) STOCK 0 CON EL MAPPING EN 'paused': se daba por pausada la publicacion mirando NUESTRA
//     anotacion, sin preguntarle a ML:
//         if (mapping.status === 'paused') { logSync('already_paused'); return ok; }
//     Si el mapping estaba desactualizado y ML la tenia ACTIVA, la publicacion no recibia el 0
//     NUNCA y seguia vendiendo con la cantidad vieja para siempre. Y el trigger solo encola
//     cuando el stock CAMBIA (trg_variant_stock_to_ml), asi que una vez en 0 no se reintentaba
//     jamas. Lo perverso era la asimetria: el camino inverso (volvio el stock, mapping paused)
//     SI le pregunta a ML desde la v11 -- se desconfiaba del mapping donde no habia riesgo y se
//     le creia justo donde el error se paga con una venta que no se puede cumplir.
//     FIX: con stock <= umbral el estado lo dicta ML, no nuestro mapping. Siempre se lee.
//
//  b) MODERADAS DADAS POR BUENAS: la v13 convirtio el fallo en 'skipped_moderated' con
//     result='ok' y devolvia { ok: true }. Era cierto que reintentar no sirve, pero el efecto
//     fue que una publicacion con stock fantasma quedaba reportada como exito y desaparecia de
//     todos los tableros. CEL2261 estuvo asi desde el 12/08 hasta que se vendio.
//     FIX: sigue sin reintentarse (no arregla nada), pero YA NO se reporta como ok: se marca
//     ml_item_mapping.stock_out_of_sync y ml-stock-reconcile -- que tiene la vista completa por
//     user_product_id -- intenta bajarlo por una publicacion HERMANA del mismo inventario. Si
//     tampoco puede, manda aviso. Buscar la hermana no se hace aca a proposito: esta funcion
//     corre cada minuto sobre pocos items y no tiene por que pagar ese barrido.
//
// Ademas: para dejar de vender ahora se escribe available_quantity = 0 en vez de status=paused.
// ML pausa sola la publicacion y la marca 'out_of_stock' (que es el sub_status que la
// reactivacion sabe reconocer), es idempotente, y se propaga a TODAS las publicaciones que
// compartan el inventario -- incluida la de catalogo, que antes quedaba afuera y es por donde
// se vendio el Redmi.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const ML_CLIENT_ID = Deno.env.get('ML_CLIENT_ID')!;
const ML_CLIENT_SECRET = Deno.env.get('ML_CLIENT_SECRET')!;
const ML_TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';
const ML_API_BASE = 'https://api.mercadolibre.com';
const MAX_PER_RUN = 20;
const MAX_ATTEMPTS = 3;
// sub_status de ML que indican moderacion/infraccion/baneo: NUNCA editar / reactivar.
const MODERATION_SUBSTATUS = ['under_review', 'banned', 'forbidden', 'freezed', 'deleted', 'suspended', 'waiting_for_patch'];

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

async function getToken(): Promise<string> {
  const { data: cred } = await supabase.from('ml_credentials').select('*').order('id', { ascending: false }).limit(1).maybeSingle();
  if (!cred) throw new Error('no_ml_credentials');
  if (new Date(cred.expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
    const resp = await fetch(ML_TOKEN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: ML_CLIENT_ID, client_secret: ML_CLIENT_SECRET, refresh_token: cred.refresh_token }).toString(),
    });
    const data: any = await resp.json();
    if (!resp.ok) throw new Error(`refresh: ${JSON.stringify(data)}`);
    const exp = new Date(Date.now() + (Number(data.expires_in) - 30) * 1000).toISOString();
    await supabase.from('ml_credentials').update({ access_token: data.access_token, refresh_token: data.refresh_token ?? cred.refresh_token, expires_at: exp }).eq('id', cred.id);
    return data.access_token;
  }
  return cred.access_token;
}

let _fxCache: { rate: number; at: number } | null = null;
async function getFxRate(): Promise<number> {
  if (_fxCache && Date.now() - _fxCache.at < 5 * 60 * 1000) return _fxCache.rate;
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/get-fx-rate`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } });
  if (!resp.ok) throw new Error(`fx_rate_fetch_failed: ${resp.status}`);
  const j: any = await resp.json();
  const rate = Number(j.rate);
  if (!rate || rate <= 0) throw new Error('invalid_fx_rate');
  _fxCache = { rate, at: Date.now() };
  return rate;
}

async function mlReq(path: string, method: string, token: string, body?: any): Promise<{ ok: boolean; status: number; data: any }> {
  const r = await fetch(`${ML_API_BASE}${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let d: any = {};
  try { d = JSON.parse(t); } catch { d = { raw: t }; }
  return { ok: r.ok, status: r.status, data: d };
}

function isRetryable(status: number): boolean {
  return status === 0 || status === 429 || status >= 500;
}
function isModerated(st: any, sub: string[]): boolean {
  return MODERATION_SUBSTATUS.some(f => sub.includes(f)) || st === 'under_review' || st === 'closed' || st === 'inactive';
}

// Devuelve el estado si ML tiene el item moderado (y por lo tanto bloqueado para editar),
// o null si no lo esta / no se pudo averiguar. Se usa como explicacion de un 400.
async function moderadoPorML(mlItemId: string, token: string): Promise<string | null> {
  const q = await mlReq(`/items/${mlItemId}?attributes=status,sub_status`, 'GET', token);
  if (!q.ok) return null;
  const st = String(q.data?.status ?? '');
  const sub: string[] = Array.isArray(q.data?.sub_status) ? q.data.sub_status.map((s: any) => String(s)) : [];
  return isModerated(st, sub) ? `status=${st} sub=${JSON.stringify(sub)}` : null;
}

// v14: una desincronizacion que no se pudo arreglar TIENE que quedar anotada. Mientras esta
// marca este puesta, ml-stock-reconcile la vuelve a intentar por una publicacion hermana y
// health-alerts la reporta. Lo que no se anota, no existe: asi se perdio CEL2261 seis semanas.
async function marcarDesincronizado(mappingId: number, motivo: string): Promise<void> {
  try {
    const { data: cur } = await supabase.from('ml_item_mapping').select('out_of_sync_since').eq('id', mappingId).maybeSingle();
    await supabase.from('ml_item_mapping').update({
      stock_out_of_sync: true,
      out_of_sync_since: cur?.out_of_sync_since ?? new Date().toISOString(),
      out_of_sync_reason: motivo.slice(0, 300),
    }).eq('id', mappingId);
  } catch (_e) { /* best-effort */ }
}

const SYNC_OK = { stock_out_of_sync: false, out_of_sync_since: null, out_of_sync_reason: null };

async function logSync(row: any): Promise<void> {
  try { await supabase.from('ml_sync_log').insert(row); } catch (_e) { /* log best-effort */ }
}

async function processItem(item: any, token: string, settings: Map<string, any>): Promise<{ ok: boolean; error?: string; retryable?: boolean }> {
  const { data: mapping } = await supabase.from('ml_item_mapping').select('id, ml_item_id, status, last_known_stock, auto_paused_stock, product_id').eq('variant_id', item.variant_id).in('status', ['active', 'paused']).maybeSingle();
  if (!mapping) return { ok: false, error: 'no_active_mapping' };
  const mlItemId = mapping.ml_item_id;
  const source = (item.payload as any)?.source ?? null;

  const reactivateEnabled = settings.get('ml_auto_reactivate_enabled') === true;

  let externalCode: string | null = null;
  let stockLocked = false;
  if (mapping.product_id) {
    const { data: prod } = await supabase.from('products').select('external_code, stock_locked').eq('id', mapping.product_id).maybeSingle();
    externalCode = prod?.external_code ?? null;
    stockLocked = (prod as any)?.stock_locked === true;
  }
  const baseLog = { ml_item_id: mlItemId, variant_id: item.variant_id, external_code: externalCode, operation: item.operation, old_ml_status: mapping.status, source };

  // v9 (2026-08-03): ML publica SIEMPRE el stock de RF Store (variants.stock), nunca el de CDR.
  // El umbral de pausa es un colchon anti-oversell que solo tiene sentido en dropship puro,
  // donde el stock es una PROMESA de CDR. Si el producto tiene STOCK MANUAL (products.stock_locked)
  // la mercaderia es propia y esta fisicamente: se vende hasta la ultima unidad -> umbral 0.
  const threshold = stockLocked ? 0 : Number(settings.get('ml_stock_threshold') ?? 0);

  switch (item.operation) {
    case 'update_stock': {
      const { data: v } = await supabase.from('variants').select('stock').eq('id', item.variant_id).single();
      if (!v) return { ok: false, error: 'variant_not_found' };
      const stock = Number(v.stock);

      if (stock <= threshold) {
        // v14: EL ESTADO LO DICTA ML, NO NUESTRO MAPPING. Antes, con el mapping en 'paused' se
        // daba por hecho que la publicacion ya estaba frenada y se devolvia ok sin mirar nada.
        // Cuando el mapping estaba desactualizado, la publicacion seguia ACTIVA en ML con la
        // cantidad vieja y no se enteraba nadie: asi se vendio CEL2261.
        const itq = await mlReq(`/items/${mlItemId}?attributes=status,sub_status,available_quantity`, 'GET', token);
        const mlStatus = String(itq.data?.status ?? '');
        const mlSub: string[] = Array.isArray(itq.data?.sub_status) ? itq.data.sub_status.map((s: any) => String(s)) : [];
        const mlQty = Number(itq.data?.available_quantity ?? 0);

        // Ya esta como tiene que estar: con 0 no se puede comprar nada, este el estado que
        // este. Unico caso en que no se escribe (y el que evita reescribir todo el catalogo
        // cada vez que CDR confirma un 0 que ya estaba).
        if (itq.ok && mlQty === 0) {
          await supabase.from('ml_item_mapping').update({ status: mlStatus === 'active' ? 'active' : 'paused', auto_paused_stock: true, last_known_stock: stock, ml_verified_qty: 0, ml_verified_status: mlStatus, ml_verified_at: new Date().toISOString(), last_synced_at: new Date().toISOString(), ...SYNC_OK }).eq('id', mapping.id);
          await logSync({ ...baseLog, action: 'already_paused', new_ml_status: mlStatus, stock, result: 'ok' });
          return { ok: true };
        }

        // Si ni siquiera se pudo leer el estado, NO se asume que esta todo bien: se reintenta.
        if (!itq.ok) {
          await logSync({ ...baseLog, action: 'read_state', new_ml_status: mapping.status, stock, result: 'error', error: `get_item: ${itq.status}` });
          return { ok: false, error: `get_item: ${itq.status}`, retryable: true };
        }

        // Dejar la cantidad en 0 es lo que corta la venta: ML pausa sola la publicacion con
        // sub_status 'out_of_stock' y el 0 se propaga a todas las publicaciones que compartan
        // el inventario (la de catalogo incluida, que es por donde se vendio el Redmi).
        const r = await mlReq(`/items/${mlItemId}`, 'PUT', token, { available_quantity: 0 });
        if (!r.ok) {
          const mod = r.status === 400 ? await moderadoPorML(mlItemId, token) : null;
          if (mod) {
            // v14: ML no deja tocarlo y reintentar no lo arregla, pero esto NO es un exito:
            // la publicacion queda ofreciendo algo que no existe. Se anota para que
            // ml-stock-reconcile lo intente por una hermana del mismo inventario y, si
            // tampoco puede, avise. Antes esto devolvia ok y se perdia de vista.
            const motivo = `no se pudo poner en 0 (ML tiene la publicacion bloqueada): ${mod}`;
            await marcarDesincronizado(mapping.id, motivo);
            await logSync({ ...baseLog, action: 'blocked_by_ml', new_ml_status: mlStatus, stock, result: 'error', error: motivo });
            return { ok: false, error: 'blocked_by_ml', retryable: false };
          }
          await logSync({ ...baseLog, action: 'zero_qty', new_ml_status: mlStatus, stock, result: 'error', error: `zero_qty: ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}` });
          return { ok: false, error: `zero_qty: ${r.status}`, retryable: isRetryable(r.status) };
        }
        await supabase.from('ml_item_mapping').update({ status: 'paused', auto_paused_stock: true, last_known_stock: stock, ml_verified_qty: 0, ml_verified_at: new Date().toISOString(), last_synced_at: new Date().toISOString(), ...SYNC_OK }).eq('id', mapping.id);
        await logSync({ ...baseLog, action: 'paused', new_ml_status: 'paused', stock, result: 'ok', error: mlStatus === 'active' ? `el mapping decia ${mapping.status}; ML la tenia ACTIVA con ${mlQty}` : null });
        return { ok: true };
      }

      if (mapping.status === 'paused') {
        // El estado real lo dicta ML, no nuestro mapping: leemos ANTES de decidir. Esto va
        // arriba del candado de auto-reactivacion a proposito - si la publicacion ya esta
        // activa en ML no hay nada que reactivar, solo hay que sincronizarle el stock.
        const itq = await mlReq(`/items/${mlItemId}?attributes=status,sub_status`, 'GET', token);
        const mlStatus = itq.data?.status;
        const subStatus: string[] = Array.isArray(itq.data?.sub_status) ? itq.data.sub_status.map((s: any) => String(s)) : [];
        // v11 (2026-08-04): si ML dice que la publicacion esta ACTIVA y nuestro mapping quedo
        // en 'paused' (tipico cuando el vendedor la reactiva y le carga stock a mano desde ML),
        // no hay nada que reactivar: corregimos el mapping con la verdad de ML y empujamos la
        // cantidad como en el caso normal. ANTES esto caia en 'skipped_not_stock_pause' y la
        // publicacion quedaba CONGELADA para siempre - RF no volvia a empujarle stock nunca mas
        // (caso real: MLU694332351, activa en ML con 6 unidades que RF no conocia).
        if (itq.ok && mlStatus === 'active') {
          const up = await mlReq(`/items/${mlItemId}`, 'PUT', token, { available_quantity: stock });
          if (!up.ok) {
            await logSync({ ...baseLog, action: 'qty_update', new_ml_status: 'active', stock, result: 'error', error: `resync_qty: ${up.status}: ${JSON.stringify(up.data).slice(0, 200)}` });
            return { ok: false, error: `update_qty: ${up.status}`, retryable: isRetryable(up.status) };
          }
          await supabase.from('ml_item_mapping').update({ status: 'active', auto_paused_stock: false, last_known_stock: stock, ml_verified_qty: stock, ml_verified_status: 'active', ml_verified_at: new Date().toISOString(), last_synced_at: new Date().toISOString(), ...SYNC_OK }).eq('id', mapping.id);
          await logSync({ ...baseLog, action: 'qty_updated_resynced', new_ml_status: 'active', stock, result: 'ok', error: 'el mapping decia paused; ML la tenia ACTIVA -> se corrigio y se empujo el stock' });
          return { ok: true };
        }

        if (!reactivateEnabled) {
          await supabase.from('ml_item_mapping').update({ last_known_stock: stock, last_synced_at: new Date().toISOString() }).eq('id', mapping.id);
          await logSync({ ...baseLog, action: 'skipped_reactivate_disabled', new_ml_status: 'paused', stock, result: 'ok' });
          return { ok: true };
        }

        const moderated = isModerated(mlStatus, subStatus);
        const pausedByStock = itq.ok && mlStatus === 'paused' && subStatus.includes('out_of_stock') && !moderated;
        // v10 (2026-08-03): en productos con STOCK MANUAL (stock_locked) cargar stock es una
        // decision explicita del admin sobre mercaderia que tiene fisicamente, asi que tambien
        // se reactiva la que figura 'paused_by_seller' (incluye las que pausamos nosotros por
        // stock 0: ML las reporta como pausadas por el vendedor, no como out_of_stock).
        // Las MODERADAS por ML se siguen respetando siempre.
        const pausedBySellerOnStockLock = itq.ok && mlStatus === 'paused' && stockLocked && !moderated;
        // v12 (2026-08-26): la senal confiable de que la pausa la hicimos NOSOTROS por stock es
        // nuestro propio flag, no el sub_status de ML: 'out_of_stock' solo lo pone ML cuando pausa
        // por su cuenta, mientras que nuestras pausas por API quedan como 'paused_by_seller'
        // (el seller somos nosotros) y nunca cumplian la condicion de arriba.
        // auto_paused_stock lo pone en true SOLO la pausa automatica por stock <= umbral; la pausa
        // MANUAL (operation 'pause') y toda reactivacion lo ponen en false. Por eso alcanza como
        // prueba, y sigue sin tocar pausas manuales ni suspensiones de ML.
        const pausedByUsOnStock = itq.ok && mlStatus === 'paused' && mapping.auto_paused_stock === true && !moderated;
        if (!pausedByStock && !pausedBySellerOnStockLock && !pausedByUsOnStock) {
          await supabase.from('ml_item_mapping').update({ last_known_stock: stock, last_synced_at: new Date().toISOString() }).eq('id', mapping.id);
          await logSync({ ...baseLog, action: 'skipped_not_stock_pause', new_ml_status: 'paused', stock, result: 'ok', error: itq.ok ? `ml_status=${mlStatus} sub=${JSON.stringify(subStatus)}` : `get_item_${itq.status}` });
          return { ok: true };
        }
        const ra = await mlReq(`/items/${mlItemId}`, 'PUT', token, { status: 'active', available_quantity: stock });
        if (!ra.ok) { await logSync({ ...baseLog, action: 'reactivate', new_ml_status: 'paused', stock, result: 'error', error: `reactivate: ${ra.status}: ${JSON.stringify(ra.data).slice(0, 150)}` }); return { ok: false, error: `reactivate: ${ra.status}`, retryable: isRetryable(ra.status) }; }
        await supabase.from('ml_item_mapping').update({ status: 'active', auto_paused_stock: false, last_known_stock: stock, ml_verified_qty: stock, ml_verified_status: 'active', ml_verified_at: new Date().toISOString(), last_synced_at: new Date().toISOString(), ...SYNC_OK }).eq('id', mapping.id);
        const reason = pausedByStock ? null : (pausedBySellerOnStockLock ? `stock_locked: sub=${JSON.stringify(subStatus)}` : `auto_paused_stock: sub=${JSON.stringify(subStatus)}`);
        await logSync({ ...baseLog, action: 'reactivated', new_ml_status: 'active', stock, result: 'ok', error: reason });
        return { ok: true };
      }

      const r = await mlReq(`/items/${mlItemId}`, 'PUT', token, { available_quantity: stock });
      if (!r.ok) {
        const mod = r.status === 400 ? await moderadoPorML(mlItemId, token) : null;
        if (mod) {
          // v14: igual que arriba. Reintentar no arregla que ML lo tenga bloqueado, pero la
          // publicacion queda mostrando una cantidad que no es la nuestra -> se anota para que
          // el reconciliador lo intente por una hermana del mismo inventario.
          const motivo = `no se pudo empujar el stock (ML tiene la publicacion bloqueada): ${mod}`;
          await marcarDesincronizado(mapping.id, motivo);
          await logSync({ ...baseLog, action: 'blocked_by_ml', new_ml_status: 'active', stock, result: 'error', error: motivo });
          return { ok: false, error: 'blocked_by_ml', retryable: false };
        }
        await logSync({ ...baseLog, action: 'qty_update', new_ml_status: 'active', stock, result: 'error', error: `update_qty: ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}` });
        return { ok: false, error: `update_qty: ${r.status}`, retryable: isRetryable(r.status) };
      }
      await supabase.from('ml_item_mapping').update({ last_known_stock: stock, ml_verified_qty: stock, ml_verified_at: new Date().toISOString(), last_synced_at: new Date().toISOString(), ...SYNC_OK }).eq('id', mapping.id);
      await logSync({ ...baseLog, action: 'qty_updated', new_ml_status: 'active', stock, result: 'ok' });
      return { ok: true };
    }
    case 'update_price': {
      const newPrice = Number((item.payload as any)?.new_price);
      const targetCurrency = (item.payload as any)?.currency_id;
      if (!newPrice || !targetCurrency) return { ok: false, error: 'missing_price_payload' };

      // Estado actual del item. Si ML lo tiene moderado (under_review/forbidden/banned/...),
      // el precio esta BLOQUEADO ('item.price.not_modifiable') -> saltar, no es editable.
      // A diferencia del stock, un precio desactualizado no genera una venta que no podamos
      // cumplir, asi que aca 'skipped_moderated' sigue siendo un desenlace aceptable.
      const cq = await mlReq(`/items/${mlItemId}?attributes=status,sub_status,currency_id`, 'GET', token);
      const st = cq.data?.status;
      const sub: string[] = Array.isArray(cq.data?.sub_status) ? cq.data.sub_status.map((s: any) => String(s)) : [];
      if (cq.ok && isModerated(st, sub)) {
        await logSync({ ...baseLog, action: 'skipped_moderated', new_ml_status: st, result: 'ok', error: `status=${st} sub=${JSON.stringify(sub)}` });
        return { ok: true };
      }

      const itemCur: string | null = cq.ok ? cq.data?.currency_id ?? null : null;

      // Intento 1: empujar en la moneda OBJETIVO (la que dicta el umbral USD). ML SI permite
      // cambiar currency_id de una publicacion activa (verificado: PUT /items -> 200).
      let pushCurrency: string = targetCurrency;
      let pushPrice: number = newPrice;
      let r = await mlReq(`/items/${mlItemId}`, 'PUT', token, { price: pushPrice, currency_id: pushCurrency });

      // Fallback: si ML rechaza el cambio de moneda (p.ej. items con ventas que la bloquean),
      // reintentar en la moneda ACTUAL del item, convirtiendo el precio con el dolar.
      if (!r.ok && itemCur && itemCur !== targetCurrency && (r.status === 400 || r.status === 403)) {
        const firstErr = JSON.stringify(r.data).slice(0, 200);
        const fx = await getFxRate();
        if (itemCur === 'UYU' && targetCurrency === 'USD') pushPrice = Math.round(newPrice * fx);
        else if (itemCur === 'USD' && targetCurrency === 'UYU') pushPrice = Math.round((newPrice / fx) * 100) / 100;
        pushCurrency = itemCur;
        r = await mlReq(`/items/${mlItemId}`, 'PUT', token, { price: pushPrice, currency_id: pushCurrency });
        if (r.ok) {
          await supabase.from('ml_item_mapping').update({ last_known_price_uyu: pushPrice, last_synced_at: new Date().toISOString() }).eq('id', mapping.id);
          await logSync({ ...baseLog, action: 'price_updated_currency_fallback', new_ml_status: mapping.status, result: 'ok', error: `target ${targetCurrency} rechazado (${firstErr}); push ${pushCurrency} ${pushPrice}` });
          return { ok: true };
        }
      }

      if (!r.ok) {
        const body = JSON.stringify(r.data).slice(0, 300);
        await logSync({ ...baseLog, action: 'price_update', new_ml_status: mapping.status, result: 'error', error: `update_price: ${r.status}: ${body}` });
        return { ok: false, error: `update_price: ${r.status}: ${body}`, retryable: isRetryable(r.status) };
      }
      await supabase.from('ml_item_mapping').update({ last_known_price_uyu: pushPrice, last_synced_at: new Date().toISOString() }).eq('id', mapping.id);
      await logSync({ ...baseLog, action: 'price_updated', new_ml_status: mapping.status, result: 'ok', error: `${pushCurrency} ${pushPrice}` });
      return { ok: true };
    }
    case 'pause': {
      const r = await mlReq(`/items/${mlItemId}`, 'PUT', token, { status: 'paused' });
      if (!r.ok) { await logSync({ ...baseLog, action: 'pause', new_ml_status: mapping.status, result: 'error', error: `pause: ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}` }); return { ok: false, error: `pause: ${r.status}`, retryable: isRetryable(r.status) }; }
      await supabase.from('ml_item_mapping').update({ status: 'paused', auto_paused_stock: false, last_synced_at: new Date().toISOString() }).eq('id', mapping.id);
      await logSync({ ...baseLog, action: 'paused', new_ml_status: 'paused', result: 'ok' });
      return { ok: true };
    }
    case 'reactivate': {
      if (!reactivateEnabled) {
        await logSync({ ...baseLog, action: 'skipped_reactivate_disabled', new_ml_status: mapping.status, result: 'ok' });
        return { ok: true };
      }
      const r = await mlReq(`/items/${mlItemId}`, 'PUT', token, { status: 'active' });
      if (!r.ok) { await logSync({ ...baseLog, action: 'reactivate', new_ml_status: mapping.status, result: 'error', error: `reactivate: ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}` }); return { ok: false, error: `reactivate: ${r.status}`, retryable: isRetryable(r.status) }; }
      await supabase.from('ml_item_mapping').update({ status: 'active', auto_paused_stock: false, last_synced_at: new Date().toISOString() }).eq('id', mapping.id);
      await logSync({ ...baseLog, action: 'reactivated', new_ml_status: 'active', result: 'ok' });
      return { ok: true };
    }
    case 'close': {
      const r = await mlReq(`/items/${mlItemId}`, 'PUT', token, { status: 'closed' });
      if (!r.ok) { await logSync({ ...baseLog, action: 'close', new_ml_status: mapping.status, result: 'error', error: `close: ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}` }); return { ok: false, error: `close: ${r.status}`, retryable: isRetryable(r.status) }; }
      await supabase.from('ml_item_mapping').update({ status: 'closed', last_synced_at: new Date().toISOString() }).eq('id', mapping.id);
      await logSync({ ...baseLog, action: 'closed', new_ml_status: 'closed', result: 'ok' });
      return { ok: true };
    }
    default:
      return { ok: false, error: `unknown_operation: ${item.operation}` };
  }
}

async function run() {
  const t0 = Date.now();
  const stats = { taken: 0, ok: 0, failed: 0, retried: 0, errors: [] as any[] };

  const { data: pending } = await supabase.from('ml_sync_queue')
    .select('id, operation, product_id, variant_id, ml_item_id, payload, attempts')
    .in('operation', ['update_stock', 'update_price', 'update_both', 'pause', 'reactivate', 'close'])
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .order('id', { ascending: true })
    .limit(MAX_PER_RUN);

  if (!pending || pending.length === 0) return { ok: true, ...stats, message: 'nothing_to_do' };

  const ids = pending.map(p => p.id);
  await supabase.from('ml_sync_queue').update({ status: 'processing' }).in('id', ids);

  const { data: settingsRows } = await supabase.from('app_settings').select('key, value').in('key', ['ml_stock_threshold', 'ml_auto_reactivate_enabled']);
  const settings = new Map((settingsRows ?? []).map((r: any) => [r.key, r.value]));

  let token: string;
  try { token = await getToken(); }
  catch (e: any) {
    await supabase.from('ml_sync_queue').update({ status: 'pending', last_error: `setup: ${e?.message}` }).in('id', ids);
    return { ok: false, error: e?.message };
  }

  for (const item of pending) {
    stats.taken++;
    const attempts = (item.attempts ?? 0) + 1;
    try {
      const r = await processItem(item, token, settings);
      if (r.ok) {
        await supabase.from('ml_sync_queue').update({ status: 'done', processed_at: new Date().toISOString(), attempts }).eq('id', item.id);
        stats.ok++;
      } else if (r.retryable && attempts < MAX_ATTEMPTS) {
        await supabase.from('ml_sync_queue').update({ status: 'pending', attempts, last_error: r.error, scheduled_for: new Date(Date.now() + 60000 * attempts).toISOString() }).eq('id', item.id);
        stats.retried++;
      } else {
        await supabase.from('ml_sync_queue').update({ status: 'error', processed_at: new Date().toISOString(), last_error: r.error, attempts }).eq('id', item.id);
        stats.failed++;
        stats.errors.push({ id: item.id, op: item.operation, error: r.error });
      }
    } catch (e: any) {
      if (attempts < MAX_ATTEMPTS) {
        await supabase.from('ml_sync_queue').update({ status: 'pending', attempts, last_error: `exc: ${e?.message}`, scheduled_for: new Date(Date.now() + 60000 * attempts).toISOString() }).eq('id', item.id);
        stats.retried++;
      } else {
        await supabase.from('ml_sync_queue').update({ status: 'error', processed_at: new Date().toISOString(), last_error: `exc: ${e?.message}`, attempts }).eq('id', item.id);
        stats.failed++;
      }
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  await supabase.from('app_settings').upsert({ key: 'ml_sync_last_run', value: { ...stats, elapsed_s: Number(elapsed), at: new Date().toISOString() } as any, updated_at: new Date().toISOString() });
  return { ok: true, ...stats, elapsed_s: Number(elapsed) };
}

Deno.serve(async (_req: Request) => {
  // @ts-ignore EdgeRuntime
  EdgeRuntime.waitUntil(run());
  return new Response(JSON.stringify({ ok: true, started: true }), { status: 202, headers: { 'Content-Type': 'application/json' } });
});
