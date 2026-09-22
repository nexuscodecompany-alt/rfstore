// deno-lint-ignore-file no-explicit-any
// ml-stock-reconcile (v1, 2026-09-22)
//
// Compara el stock REAL de todas las publicaciones de ML contra el de RF Store y lo corrige.
// Es la red de seguridad: no depende de que el trigger haya disparado, ni de que la cola haya
// procesado, ni de que nuestro mapping este al dia. Lee ML y arregla lo que encuentra.
//
// POR QUE EXISTE
// El 22/09/2026 se vendio en ML un Redmi Note 15 Pro (CEL2261) que no existia: RF tenia 0 y
// ML lo mostraba con stock. Al mirarlo aparecieron 18 publicaciones mas en la misma situacion,
// 94 unidades en total. Ninguna de las tres defensas que ya existian lo vio, porque las tres
// cometian el MISMO error de fondo: decidian mirando ml_item_mapping.status (nuestra propia
// anotacion) en lugar del estado real de ML, justo en el camino donde equivocarse se paga con
// una venta sin stock.
//   1) ml-process-sync-queue: con stock 0 y el mapping en 'paused' daba por pausada la
//      publicacion SIN preguntarle a ML. Si ML la tenia activa, nunca le llegaba el 0.
//   2) las publicaciones que ML tiene bloqueadas se enterraban como 'skipped_moderated' con
//      result='ok' -> stock fantasma reportado como exito.
//   3) health-alerts tenia el chequeo (ml_active_no_stock) pero filtrado por m.status='active',
//      el mismo punto ciego.
// Y nada comparaba nunca contra ML: last_known_stock es lo que EMPUJAMOS, no lo que ML tiene.
// En la publicacion que se vendio decia 10 desde el 30/06 y nadie lo desmintio en 3 meses.
//
// EL MODELO QUE IMPORTA: en ML el stock NO vive en la publicacion, vive en el producto de
// inventario (user_product_id). Varias publicaciones pueden compartirlo — tipicamente la
// propia y la de CATALOGO (la ficha /p/MLUxxxx). Un solo stock detras de varias publicaciones.
// Por eso aca se razona por user_product_id y no por publicacion:
//   - alcanza con escribir UNA vez por grupo; el resto lo espeja ML solo.
//   - si ML tiene bloqueada una publicacion (under_review/forbidden no deja tocar stock ni
//     status), se escribe por una HERMANA del mismo grupo que si sea editable y el stock baja
//     igual en la bloqueada. Verificado en vivo: MLU1466144108 (forbidden) paso de 10 a 9 al
//     escribir 9 en MLU1488151706.
//   - las publicaciones de catalogo (54, sin mapping propio en RF por diseño) quedan cubiertas
//     sin tratarlas aparte: cuelgan del mismo user_product_id que su publicacion padre.
//
// REGLAS DE ORO
//  - NUNCA reactiva ni despausa nada. Bajar stock corta ventas, subir status las crea: lo
//    segundo es decision del dueño (ver el freeze de vacaciones de 09/2026, donde un sync
//    reactivo 47 publicaciones pausadas a proposito). Aca solo se corrigen CANTIDADES.
//  - Lo que no se pudo corregir NO se reporta como ok: queda marcado en
//    ml_item_mapping.stock_out_of_sync y dispara aviso.
//  - ?dry=1 muestra que haria sin tocar nada.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ML_CLIENT_ID = Deno.env.get('ML_CLIENT_ID')!;
const ML_CLIENT_SECRET = Deno.env.get('ML_CLIENT_SECRET')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'pedidos@rfstore.uy';
const ADMIN_EMAIL_ENV = Deno.env.get('ADMIN_EMAIL') ?? '';
const ML_API_BASE = 'https://api.mercadolibre.com';

// sub_status con los que ML bloquea TODA edicion del item (stock y status incluidos).
// waiting_for_patch NO entra: esos si aceptan edicion (verificado).
const HARD_BLOCK_SUBSTATUS = ['forbidden', 'banned', 'deleted', 'freezed', 'suspended'];
// Tope de escrituras por corrida. 300 fue demasiado: la primera corrida real completo las 300
// y se quedo sin tiempo de ejecucion en el cierre, sin llegar a registrar nada. Con 150 entra
// holgado. Lo que no entra NO se pierde ni se da por roto: lo toma la corrida siguiente, que
// vuelve a empezar por lo mas urgente (y las urgentes se drenan en la primera).
const MAX_WRITES = 150;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

const nowIso = () => new Date().toISOString();

async function getToken(): Promise<string> {
  const { data: cred } = await supabase.from('ml_credentials').select('*').order('id', { ascending: false }).limit(1).maybeSingle();
  if (!cred) throw new Error('no_ml_credentials');
  if (new Date(cred.expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
    const resp = await fetch(`${ML_API_BASE}/oauth/token`, {
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

async function ml(path: string, method: string, token: string, body?: any) {
  const r = await fetch(`${ML_API_BASE}${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let d: any = {}; try { d = JSON.parse(t); } catch { d = { raw: t }; }
  return { ok: r.ok, status: r.status, data: d };
}

// PostgREST corta en 1000 filas: paginar siempre, si no la comparacion miente en silencio.
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

const isHardBlocked = (sub: string[]) => HARD_BLOCK_SUBSTATUS.some(s => sub.includes(s));

type MlItem = { id: string; status: string; sub: string[]; qty: number; upid: string | null; catalog: boolean };

// Todas las publicaciones del vendedor, sin filtrar por lo que creemos tener mapeado:
// las de catalogo no tienen mapping propio y son justamente las que venden.
async function fetchAllMlItems(token: string, uid: number): Promise<MlItem[]> {
  const ids: string[] = [];
  let scroll = '';
  for (let i = 0; i < 60; i++) {
    const q = await ml(`/users/${uid}/items/search?search_type=scan&limit=100${scroll ? `&scroll_id=${encodeURIComponent(scroll)}` : ''}`, 'GET', token);
    if (!q.ok) throw new Error(`items_search: ${q.status}`);
    const batch: string[] = q.data?.results ?? [];
    ids.push(...batch);
    scroll = q.data?.scroll_id ?? '';
    if (!scroll || batch.length === 0) break;
  }
  const items: MlItem[] = [];
  for (let i = 0; i < ids.length; i += 20) { // 20 es el maximo de /items?ids=
    const chunk = ids.slice(i, i + 20);
    const r = await ml(`/items?ids=${chunk.join(',')}&attributes=id,status,sub_status,available_quantity,user_product_id,catalog_listing`, 'GET', token);
    if (!r.ok) continue;
    for (const e of (r.data ?? [])) {
      const b = e?.body;
      if (e?.code === 200 && b?.id) {
        items.push({
          id: String(b.id), status: String(b.status ?? ''),
          sub: (b.sub_status ?? []).map((s: any) => String(s)),
          qty: Number(b.available_quantity ?? 0),
          upid: b.user_product_id ? String(b.user_product_id) : null,
          catalog: b.catalog_listing === true,
        });
      }
    }
  }
  return items;
}

async function notifyEmail(): Promise<string> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'alerts_notify_email').maybeSingle();
  const fromSetting = typeof data?.value === 'string' ? data.value : (data?.value as any)?.email;
  return fromSetting || ADMIN_EMAIL_ENV || 'nexuscode.company@gmail.com';
}

// Aviso INMEDIATO, aparte del reporte diario de health-alerts. Una publicacion vendiendo algo
// que no existe no puede esperar a las 9 de la mañana: cada hora que pasa es una venta que hay
// que cancelar a mano. Anti-spam: un solo mail por dia mientras el conjunto no cambie.
async function alertUnfixable(rows: any[]): Promise<boolean> {
  if (!rows.length || !RESEND_API_KEY) return false;
  const fingerprint = rows.map(r => `${r.ml_item_id}:${r.ml_qty}`).sort().join('|');
  const { data: prev } = await supabase.from('app_settings').select('value').eq('key', 'ml_reconcile_last_alert').maybeSingle();
  const prevFp = (prev?.value as any)?.fingerprint ?? '';
  const prevAt = (prev?.value as any)?.at ?? null;
  const sameDay = prevAt && (Date.now() - new Date(prevAt).getTime()) < 24 * 3600_000;
  if (prevFp === fingerprint && sameDay) return false;

  const li = rows.slice(0, 20).map(r =>
    `<li style="margin:0 0 8px"><b>${r.producto ?? r.ml_item_id}</b><br>
     <span style="color:#555">ML muestra <b>${r.ml_qty}</b> · RF tiene <b>${r.rf_stock}</b> — ${r.motivo}</span><br>
     <a href="https://www.mercadolibre.com.uy/p/${r.ml_item_id}" style="font-size:12px">${r.ml_item_id}</a></li>`).join('');
  const html = `<div style="max-width:720px;margin:0 auto;padding:24px;font:14px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111">
    <h2 style="font:700 19px/1.3 system-ui;margin:0 0 6px;color:#b00020">Publicaciones vendiendo sin stock</h2>
    <p style="margin:0 0 16px">${rows.length} publicacion(es) muestran stock en MercadoLibre que RF Store no tiene, y el sistema
    <b>no pudo corregirlas solo</b> porque ML tiene bloqueada la edicion y no hay otra publicacion del mismo inventario por donde bajarlas.</p>
    <ul style="padding-left:18px;margin:0">${li}</ul>
    ${rows.length > 20 ? `<p style="color:#666">y ${rows.length - 20} mas.</p>` : ''}
    <p style="margin-top:20px;font-size:13px;color:#444">Hay que resolverlo en ML: destrabar la publicacion (Mis publicaciones &rarr; ver el motivo de la revision) o darla de baja.</p>
    <p style="color:#888;font-size:12px;margin-top:24px;border-top:1px solid #eee;padding-top:12px">Aviso automatico de ml-stock-reconcile. Se manda una vez por dia mientras la situacion no cambie.</p></div>`;

  const to = await notifyEmail();
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `RF Store <${FROM_EMAIL}>`, to: [to], subject: `🔴 RF Store: ${rows.length} publicacion(es) vendiendo sin stock en ML`, html }),
  });
  if (r.ok) await supabase.from('app_settings').upsert({ key: 'ml_reconcile_last_alert', value: { fingerprint, at: nowIso() } as any, updated_at: nowIso() });
  return r.ok;
}

async function run(dry: boolean) {
  const t0 = Date.now();
  const token = await getToken();
  const me = await ml('/users/me', 'GET', token);
  const uid = Number(me.data?.id);
  if (!uid) throw new Error('no_ml_user');

  const items = await fetchAllMlItems(token, uid);

  const [mappings, variants, products, thrRow] = await Promise.all([
    fetchAll('ml_item_mapping', 'id, ml_item_id, product_id, variant_id, status, last_known_stock, auto_paused_stock, stock_out_of_sync, out_of_sync_since, ml_verified_qty, ml_verified_status'),
    fetchAll('variants', 'id, stock'),
    fetchAll('products', 'id, name, external_code, stock_locked'),
    supabase.from('app_settings').select('value').eq('key', 'ml_stock_threshold').maybeSingle(),
  ]);
  const threshold = Number((thrRow as any)?.data?.value ?? 0) || 0;
  const stockOf = new Map(variants.map((v: any) => [v.id, Number(v.stock ?? 0)]));
  const prodOf = new Map(products.map((p: any) => [p.id, p]));
  const mapByItem = new Map(mappings.map((m: any) => [m.ml_item_id, m]));

  // --- agrupar por user_product_id: la unidad real de stock en ML -----------------------
  // Una publicacion sin upid (raro) se trata como grupo de a uno.
  const groups = new Map<string, MlItem[]>();
  for (const it of items) {
    const key = it.upid ?? `solo:${it.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(it);
  }

  const fixed: any[] = [];
  const unfixable: any[] = [];
  const pending: any[] = [];
  const conflicts: any[] = [];
  const uncontrolled: any[] = [];
  const verified: Array<{ id: number; qty: number; status: string }> = [];

  // --- PASADA 1: calcular que hay que corregir, sin tocar nada --------------------------
  // Calcular y arreglar van separados para poder ORDENAR: primero lo que esta ofreciendo de
  // mas, que es lo unico que termina en una venta sin stock. Si la corrida no alcanza para
  // todo, lo que queda afuera es lo inofensivo.
  type Plan = { maps: any[]; label: string; prod: any; mlQty: number; rfStock: number; target: number; sobreventa: number; editable: MlItem | null; blocked: string; itemVivo: string };
  const plan: Plan[] = [];

  for (const [key, grp] of groups) {
    // Los mappings del grupo. Varias publicaciones del mismo inventario deberian apuntar
    // todas al mismo variant de RF.
    const maps = grp.map(it => mapByItem.get(it.id)).filter(Boolean) as any[];
    for (const m of maps) {
      const it = grp.find(g => g.id === m.ml_item_id)!;
      // Solo lo que cambio: reescribir las 1583 filas cada hora es I/O puro al pedo, y este
      // proyecto ya se comio una alerta de disco de Supabase por escrituras de este tipo.
      if (m.ml_verified_qty !== it.qty || m.ml_verified_status !== it.status) {
        verified.push({ id: m.id, qty: it.qty, status: it.status });
      }
    }

    // Una publicacion cerrada conserva la cantidad que tenia el dia que se cerro y no vende
    // nada: contarla inventa desajustes que no existen y gasta escrituras al pedo.
    const alive = grp.filter(it => it.status !== 'closed' && it.status !== 'inactive');
    if (!alive.length) continue;

    if (!maps.length) {
      // Publicacion viva en ML que RF no controla: no sabemos que stock deberia tener.
      if (alive.some(it => it.status === 'active' && it.qty > 0)) {
        uncontrolled.push({ upid: key, items: alive.map(g => ({ id: g.id, qty: g.qty, catalog: g.catalog })) });
      }
      continue;
    }

    const variantIds = [...new Set(maps.map(m => m.variant_id).filter(Boolean))];
    if (variantIds.length > 1) {
      // Dos productos distintos de RF compartiendo un inventario de ML: cualquier cantidad
      // que escribamos estaria mal para alguno. Se reporta y no se toca (ver el caso FIL80/FIL114
      // de 08/2026, donde un mapping cruzado hizo que ML vendiera por la ficha equivocada).
      conflicts.push({ upid: key, variants: variantIds, items: alive.map(g => g.id) });
      continue;
    }

    const m0 = maps[0];
    const prod: any = prodOf.get(m0.product_id) ?? {};
    const rfStock = stockOf.get(m0.variant_id) ?? 0;
    // Mismo criterio que ml-process-sync-queue v9: el stock manual es mercaderia propia y se
    // vende hasta la ultima unidad; el dropship guarda el colchon anti-oversell.
    const thr = prod.stock_locked ? 0 : threshold;
    // Poner 0 es mas seguro que pausar: ML pausa sola la publicacion con sub_status
    // 'out_of_stock' (que es justo lo que la reactivacion automatica sabe reconocer), es
    // idempotente, y se propaga a TODAS las publicaciones del grupo, catalogo incluido.
    const target = rfStock <= thr ? 0 : rfStock;

    const mlQty = Math.max(...alive.map(g => g.qty));
    if (mlQty === target) {
      // Coincide: si venia marcada como desincronizada, se limpia la marca.
      if (m0.stock_out_of_sync && !dry) {
        await supabase.from('ml_item_mapping').update({ stock_out_of_sync: false, out_of_sync_since: null, out_of_sync_reason: null }).in('id', maps.map(m => m.id));
      }
      continue;
    }

    // Una publicacion del grupo que ML deje editar. Si la principal esta bloqueada sirve
    // cualquier hermana: el stock es uno solo (verificado en vivo). Se prefiere una propia
    // antes que la de catalogo, mas quisquillosa con las validaciones de ML.
    const libres = alive.filter(it => !isHardBlocked(it.sub));
    const editable = libres.find(it => !it.catalog) ?? libres[0] ?? null;

    // SOBREVENTA de verdad = lo que un comprador puede comprar ahora mismo y no existe. Solo
    // cuentan las ACTIVAS: una publicacion pausada conserva la cantidad vieja congelada y no
    // vende nada. Confundir las dos cosas infla la alarma 20 veces (595 contra 27 reales) y
    // termina en un aviso que nadie mira, que es como se llego hasta aca.
    const vendibles = alive.filter(it => it.status === 'active');
    const activeQty = vendibles.length ? Math.max(...vendibles.map(g => g.qty)) : 0;
    // La publicacion por la que se esta vendiendo de mas, para poder nombrarla en el aviso:
    // el mapping puede apuntar a una hermana ya cerrada y decir el id equivocado.
    const expuesta = vendibles.find(it => it.qty === activeQty) ?? alive[0];

    plan.push({
      maps, prod, mlQty, rfStock, target, editable,
      label: (prod.external_code ?? '?') + ' - ' + (prod.name ?? m0.ml_item_id),
      itemVivo: expuesta.id,
      sobreventa: Math.max(0, activeQty - target),
      blocked: alive.map(g => g.sub.join('/')).filter(Boolean).join(', '),
    });
  }

  const mismatches = plan.length;
  const sobreventaTotal = plan.filter(p => p.sobreventa > 0).length;
  const unidadesDeMas = plan.reduce((a, p) => a + p.sobreventa, 0);

  // Lo que puede terminar en una venta sin stock va primero, y dentro de eso lo que mas expone.
  plan.sort((a, b) => (b.sobreventa > 0 ? 1 : 0) - (a.sobreventa > 0 ? 1 : 0) || b.sobreventa - a.sobreventa);

  // --- PASADA 2: aplicar -----------------------------------------------------------------
  let writes = 0;
  const pendingLogs: any[] = [];
  const flushLogs = async () => {
    if (!pendingLogs.length) return;
    const batch = pendingLogs.splice(0, pendingLogs.length);
    await supabase.from('ml_sync_log').insert(batch).then(() => {}, () => {});
  };
  for (const p of plan) {
    const m0 = p.maps[0];
    const row = { ml_item_id: p.itemVivo, producto: p.label, ml_qty: p.mlQty, rf_stock: p.rfStock, target: p.target, sobreventa: p.sobreventa > 0 };

    if (dry) {
      (p.editable ? fixed : unfixable).push({ ...row, via: p.editable?.id ?? null, motivo: p.editable ? 'dry-run' : 'ML bloquea todas las publicaciones del inventario' });
      continue;
    }

    if (!p.editable) {
      // Irreparable de verdad: ML no deja tocar ninguna publicacion de este inventario.
      const motivo = 'ML tiene bloqueada la edicion (' + (p.blocked || 'sin detalle') + ') y no hay otra publicacion del mismo inventario por donde bajar el stock';
      unfixable.push({ ...row, motivo });
      await supabase.from('ml_item_mapping').update({
        stock_out_of_sync: true,
        out_of_sync_since: m0.out_of_sync_since ?? nowIso(),
        out_of_sync_reason: motivo.slice(0, 300),
      }).in('id', p.maps.map((m: any) => m.id));
      continue;
    }

    if (writes >= MAX_WRITES) {
      // Queda para la proxima corrida. Esto NO es una desincronizacion irreparable, asi que no
      // se marca como tal: marcarla ensuciaria la señal que dispara el aviso urgente.
      pending.push(row);
      continue;
    }

    const w = await ml('/items/' + p.editable.id, 'PUT', token, { available_quantity: p.target });
    writes++;
    if (!w.ok) {
      const motivo = 'ML rechazo la correccion en ' + p.editable.id + ': ' + w.status + ' ' + JSON.stringify(w.data).slice(0, 160);
      unfixable.push({ ...row, motivo });
      await supabase.from('ml_item_mapping').update({
        stock_out_of_sync: true,
        out_of_sync_since: m0.out_of_sync_since ?? nowIso(),
        out_of_sync_reason: motivo.slice(0, 300),
      }).in('id', p.maps.map((m: any) => m.id));
      continue;
    }

    fixed.push({ ...row, via: p.editable.id, catalog_via: p.editable.catalog });
    await supabase.from('ml_item_mapping').update({
      last_known_stock: p.target,
      ml_verified_qty: p.target,
      ml_verified_at: nowIso(),
      stock_out_of_sync: false,
      out_of_sync_since: null,
      out_of_sync_reason: null,
      // Si la dejamos en 0, ML la pausa sola: dejamos constancia de que la pausa fue NUESTRA
      // por stock, que es lo que ml-process-sync-queue v12 necesita para reactivarla despues.
      ...(p.target === 0 ? { auto_paused_stock: true } : {}),
    }).in('id', p.maps.map((m: any) => m.id));
    for (const mm of p.maps) {
      pendingLogs.push({
        ml_item_id: mm.ml_item_id, variant_id: mm.variant_id, external_code: p.prod.external_code ?? null,
        operation: 'reconcile', action: p.target === 0 ? 'reconciled_to_zero' : 'reconciled_qty',
        old_ml_status: mm.status, new_ml_status: null, stock: p.target, result: 'ok',
        error: 'ML tenia ' + p.mlQty + ', RF ' + p.rfStock + (p.editable.id !== mm.ml_item_id ? ' (corregido via ' + p.editable.id + (p.editable.catalog ? ', publicacion de catalogo' : '') + ')' : ''),
        source: 'reconcile',
      });
    }
    // De a un insert por publicacion son cientos de round-trips en la parte mas cara de la
    // corrida; se mandan de a 50 y se vacia el buffer al terminar.
    if (pendingLogs.length >= 50) { await flushLogs(); }
  }
  await flushLogs();

  const sobreventaRows = unfixable.filter(u => u.sobreventa);
  let emailed = false;
  if (!dry) emailed = await alertUnfixable(sobreventaRows).catch(() => false);

  const elapsed = Number(((Date.now() - t0) / 1000).toFixed(1));
  const report = {
    dry, grupos: groups.size, mismatches, sobreventa: sobreventaTotal, unidades_de_mas: unidadesDeMas,
    fixed_total: fixed.length, fixed: fixed.slice(0, 40),
    pendientes_proxima_corrida: pending.length,
    unfixable, conflicts, uncontrolled: uncontrolled.slice(0, 20),
    uncontrolled_total: uncontrolled.length, emailed,
  };
  // El historial se graba ANTES del cierre: si lo que sigue se queda sin tiempo, la corrida
  // igual queda registrada. En la primera corrida real paso justo al reves y no hubo rastro
  // de 300 correcciones que si se habian hecho.
  await supabase.from('ml_stock_reconcile_runs').insert({
    ok: true, dry_run: dry, items_ml: items.length, mismatches,
    fixed: fixed.length, unfixable: unfixable.length, elapsed_s: elapsed, report,
  });

  // El espejo deja de mentir: se guarda lo que ML REALMENTE reporto, no lo que empujamos.
  // De a una fila son ~1500 UPDATE y eso fue lo que mato la primera corrida: va por RPC, que
  // lo resuelve en una sola sentencia.
  let verificados = 0;
  if (!dry && verified.length) {
    for (let i = 0; i < verified.length; i += 500) {
      const { data: n } = await supabase.rpc('ml_mapping_mark_verified', { p_rows: verified.slice(i, i + 500) });
      verificados += Number(n ?? 0);
    }
  }

  return { ok: true, verificados, dry, items_ml: items.length, grupos: groups.size, mismatches, sobreventa: sobreventaTotal, unidades_de_mas: unidadesDeMas, fixed: fixed.length, pendientes: pending.length, unfixable: unfixable.length, conflicts: conflicts.length, uncontrolled: uncontrolled.length, emailed, elapsed_s: elapsed, detalle: report };
}

Deno.serve(async (req: Request) => {
  const qs = new URL(req.url).searchParams;
  const dry = qs.get('dry') === '1';
  // ?sync=1 devuelve el resultado (para correr a mano); por defecto dispara y corta, que es
  // lo que necesita el cron.
  if (qs.get('sync') === '1' || dry) {
    try { return new Response(JSON.stringify(await run(dry), null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
    catch (e: any) {
      await supabase.from('ml_stock_reconcile_runs').insert({ ok: false, dry_run: dry, error: String(e?.message ?? e).slice(0, 500) });
      return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  }
  // @ts-ignore EdgeRuntime
  EdgeRuntime.waitUntil(run(false).catch(async (e: any) => {
    await supabase.from('ml_stock_reconcile_runs').insert({ ok: false, error: String(e?.message ?? e).slice(0, 500) });
  }));
  return new Response(JSON.stringify({ ok: true, started: true }), { status: 202, headers: { 'Content-Type': 'application/json' } });
});
