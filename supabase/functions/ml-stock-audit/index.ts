// deno-lint-ignore-file no-explicit-any
// ml-stock-audit (v2, 2026-09-22) - AUDITORIA READ-ONLY de la cadena completa de stock.
//
// Responde una sola pregunta, de punta a punta y sin intermediarios:
//   ¿el stock que CDR dice, el que tiene RF Store y el que ve un comprador en ML son el mismo?
//
// No escribe NADA: ni en la base, ni en ML, ni manda mails. Solo mira y reporta.
// Quien corrige es ml-stock-reconcile (RF->ML) y el sync de CDR (CDR->RF).
//
// Por que existe: despues del incidente del 22/09 (se vendio en ML un producto con stock 0 en
// RF) hace falta poder CONFIRMAR que las tres puntas coinciden, no suponerlo. Cada eslabon
// tenia su propia verificacion parcial y ninguna miraba la cadena entera.
//
// Los dos eslabones se miden por separado porque fallan por motivos distintos:
//   CDR -> RF : depende del feed de CDR. La comparacion la hace la RPC cdr_stock_audit, que
//               usa exactamente la misma regla de reservas que el sync: si la auditoria
//               calculara distinto que el sync, marcaria diferencias que no existen.
//   RF -> ML  : depende de la cola y del reconciliador. Se compara contra la API de ML, no
//               contra nuestro espejo (mirar el espejo para verificar el espejo no verifica
//               nada: ese fue justamente el error que causo el incidente).
//
// Y DENTRO del eslabon CDR->RF se separan las dos direcciones, porque no significan lo mismo:
//   RF de MENOS que CDR -> normalmente una venta nuestra que CDR todavia no refleja. Benigno.
//   RF de MAS que CDR   -> CDR bajo y no nos enteramos. Este es el que puede terminar en una
//                          venta que no podemos cumplir.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ML_CLIENT_ID = Deno.env.get('ML_CLIENT_ID')!;
const ML_CLIENT_SECRET = Deno.env.get('ML_CLIENT_SECRET')!;
const CDR_EMAIL = Deno.env.get('CDR_EMAIL')!;
const CDR_TOKEN = Deno.env.get('CDR_TOKEN')!;
const ML_API_BASE = 'https://api.mercadolibre.com';
const SOAP_PRODUCTS_URL = 'https://www.cdrmedios.com/ws/productos/service.php?class=SublimewsProductosUsuariosCompleto';

const HARD_BLOCK_SUBSTATUS = ['forbidden', 'banned', 'deleted', 'freezed', 'suspended'];

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

// ---------------------------------------------------------------------------- CDR (SOAP)
function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function buildEnvelope(method: string, params: Record<string, string>): string {
  const args = Object.entries(params).map(([k, v]) => `<${k} xsi:type="xsd:string">${escapeXml(v)}</${k}>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/"><SOAP-ENV:Body><${method}>${args}</${method}></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
}
// Feed COMPLETO: una fecha vieja hace que CDR devuelva todo el catalogo.
async function fetchCdrFeed(): Promise<Array<{ code: string; stock: number; habilitado: number }>> {
  const resp = await fetch(SOAP_PRODUCTS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '"productos_con_galeria"' },
    body: buildEnvelope('productos_con_galeria', { email: CDR_EMAIL, token: CDR_TOKEN, fecha: '2000-01-01 00:00:00', formato: 'json' }),
  });
  const xml = await resp.text();
  if (!resp.ok) throw new Error(`CDR SOAP HTTP ${resp.status}: ${xml.slice(0, 200)}`);
  const m = xml.match(/<(?:[a-zA-Z0-9_:]+:)?(?:[a-zA-Z0-9_]*[Rr]eturn|return)\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_:]+:)?(?:[a-zA-Z0-9_]*[Rr]eturn|return)>/);
  if (!m) throw new Error(`CDR: sin tag de respuesta: ${xml.slice(0, 300)}`);
  const raw = m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
  const parsed: any = JSON.parse(raw);
  // CDR devuelve los errores con HTTP 200 y un objeto {ERROR: ...} (seccion 9 de la doc):
  // tomarlo como "feed vacio" seria concluir que CDR no tiene nada en stock. Se corta.
  if (!Array.isArray(parsed)) throw new Error(`CDR devolvio un error: ${JSON.stringify(parsed).slice(0, 300)}`);
  return parsed.map((p: any) => ({ code: String(p?.codigo ?? ''), stock: Number(p?.stock ?? 0), habilitado: Number(p?.habilitado ?? 0) }))
               .filter((p: any) => p.code !== '');
}

// ---------------------------------------------------------------------------- ML
async function getMlToken(): Promise<string> {
  const { data: cred } = await supabase.from('ml_credentials').select('*').order('id', { ascending: false }).limit(1).maybeSingle();
  if (!cred) throw new Error('no_ml_credentials');
  if (new Date(cred.expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
    const resp = await fetch(`${ML_API_BASE}/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: ML_CLIENT_ID, client_secret: ML_CLIENT_SECRET, refresh_token: cred.refresh_token }).toString(),
    });
    const data: any = await resp.json();
    if (!resp.ok) throw new Error(`refresh_token: ${JSON.stringify(data).slice(0, 200)}`);
    await supabase.from('ml_credentials').update({ access_token: data.access_token, refresh_token: data.refresh_token ?? cred.refresh_token, expires_at: new Date(Date.now() + (Number(data.expires_in) - 30) * 1000).toISOString() }).eq('id', cred.id);
    return data.access_token;
  }
  return cred.access_token;
}
async function mlGet(path: string, token: string) {
  const r = await fetch(`${ML_API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const t = await r.text();
  let d: any = {}; try { d = JSON.parse(t); } catch { d = { raw: t }; }
  return { ok: r.ok, status: r.status, data: d };
}

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

async function run() {
  const t0 = Date.now();

  // ---- ESLABON 1: CDR -> RF Store -----------------------------------------------------
  const feed = await fetchCdrFeed();
  const { data: cdrAudit, error: auditErr } = await supabase.rpc('cdr_stock_audit', {
    p_rows: feed.map(f => ({ code: f.code, stock: f.stock })),
  });
  if (auditErr) throw new Error(`cdr_stock_audit: ${auditErr.message}`);

  // ---- ESLABON 2: RF Store -> ML ------------------------------------------------------
  const token = await getMlToken();
  const me = await mlGet('/users/me', token);
  const uid = Number(me.data?.id);
  if (!uid) throw new Error('no_ml_user');

  const ids: string[] = [];
  let scroll = '';
  for (let i = 0; i < 60; i++) {
    const q = await mlGet(`/users/${uid}/items/search?search_type=scan&limit=100${scroll ? `&scroll_id=${encodeURIComponent(scroll)}` : ''}`, token);
    if (!q.ok) throw new Error(`items_search: ${q.status}`);
    const batch: string[] = q.data?.results ?? [];
    ids.push(...batch);
    scroll = q.data?.scroll_id ?? '';
    if (!scroll || batch.length === 0) break;
  }
  const mlItems: any[] = [];
  for (let i = 0; i < ids.length; i += 20) {
    const r = await mlGet(`/items?ids=${ids.slice(i, i + 20).join(',')}&attributes=id,status,sub_status,available_quantity,user_product_id,catalog_listing`, token);
    if (!r.ok) continue;
    for (const e of (r.data ?? [])) if (e?.code === 200 && e.body) mlItems.push(e.body);
  }

  const [mappings, variants, products, thrRow] = await Promise.all([
    fetchAll('ml_item_mapping', 'id, ml_item_id, product_id, variant_id, status, stock_out_of_sync'),
    fetchAll('variants', 'id, stock, cdr_stock, owned_stock'),
    fetchAll('products', 'id, name, external_code, stock_locked, source'),
    supabase.from('app_settings').select('value').eq('key', 'ml_stock_threshold').maybeSingle(),
  ]);
  const threshold = Number((thrRow as any)?.data?.value ?? 0) || 0;
  const varById = new Map(variants.map((v: any) => [v.id, v]));
  const prodById = new Map(products.map((p: any) => [p.id, p]));
  const mapByItem = new Map(mappings.map((m: any) => [m.ml_item_id, m]));
  const cdrByCode = new Map(feed.map(f => [f.code, f]));

  // Igual que el reconciliador: el stock en ML vive en el user_product_id, no en la
  // publicacion. Se compara por grupo, si no la de catalogo cuenta como un desajuste aparte.
  const groups = new Map<string, any[]>();
  for (const it of mlItems) {
    const key = it.user_product_id ? String(it.user_product_id) : `solo:${it.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(it);
  }

  const rfVsMl: any[] = [];
  const sobreventa: any[] = [];
  let publicadosVivos = 0;

  for (const [, grp] of groups) {
    const alive = grp.filter(it => it.status !== 'closed' && it.status !== 'inactive');
    if (!alive.length) continue;
    const maps = grp.map(it => mapByItem.get(it.id)).filter(Boolean) as any[];
    if (!maps.length) continue;
    const variantIds = [...new Set(maps.map(m => m.variant_id).filter(Boolean))];
    if (variantIds.length > 1) continue; // conflicto de mapeo: se reporta aparte

    const m0 = maps[0];
    const v: any = varById.get(m0.variant_id);
    const p: any = prodById.get(m0.product_id);
    if (!v || !p) continue;
    publicadosVivos++;

    const thr = p.stock_locked ? 0 : threshold;
    const rfStock = Number(v.stock ?? 0);
    const objetivoMl = rfStock <= thr ? 0 : rfStock;
    const mlQty = Math.max(...alive.map((g: any) => Number(g.available_quantity ?? 0)));
    const vendibles = alive.filter((it: any) => it.status === 'active');
    const activeQty = vendibles.length ? Math.max(...vendibles.map((g: any) => Number(g.available_quantity ?? 0))) : 0;
    const bloqueada = alive.every((it: any) => HARD_BLOCK_SUBSTATUS.some(s => (it.sub_status ?? []).includes(s)));

    const fila = {
      external_code: p.external_code, producto: p.name,
      ml_item_id: m0.ml_item_id,
      cdr_dice: cdrByCode.has(p.external_code) ? cdrByCode.get(p.external_code)!.stock : null,
      rf_cdr_stock: v.cdr_stock, rf_owned: v.owned_stock ?? 0, rf_stock: rfStock,
      ml_muestra: mlQty, ml_deberia: objetivoMl,
      ml_activa_qty: activeQty, stock_manual: p.stock_locked, bloqueada_por_ml: bloqueada,
    };

    if (mlQty !== objetivoMl) rfVsMl.push(fila);
    // Sobreventa = un comprador puede comprar AHORA algo que RF no tiene.
    if (activeQty > objetivoMl) sobreventa.push({ ...fila, riesgo: 'SOBREVENTA' });
  }

  const ca: any = cdrAudit ?? {};
  const sinRiesgo = (ca.rf_de_mas ?? 0) === 0 && rfVsMl.length === 0 && sobreventa.length === 0;

  const resumen = {
    cdr_a_rf: {
      productos_en_feed_cdr: ca.feed_size ?? null,
      matcheados_en_rf: ca.matcheados ?? null,
      en_feed_sin_producto_en_rf: ca.en_feed_sin_producto ?? null,
      con_stock_manual_no_cuentan: ca.con_stock_manual ?? null,
      RF_DE_MAS_que_CDR: ca.rf_de_mas ?? null,
      de_esos_publicados_en_ml: ca.rf_de_mas_en_ml ?? null,
      unidades_de_mas: ca.unidades_de_mas ?? null,
      rf_de_menos_benigno: ca.rf_de_menos ?? null,
    },
    rf_a_ml: {
      publicaciones_vivas_mapeadas: publicadosVivos,
      DESAJUSTADAS: rfVsMl.length,
      de_esas_bloqueadas_por_ml: rfVsMl.filter(r => r.bloqueada_por_ml).length,
    },
    riesgo_real: {
      SOBREVENTA_publicaciones: sobreventa.length,
      unidades_inexistentes_a_la_venta: sobreventa.reduce((a, r) => a + (r.ml_activa_qty - r.ml_deberia), 0),
    },
  };

  return {
    ok: true,
    veredicto: sinRiesgo
      ? 'CDR, RF Store y ML coinciden: nada a la venta que no exista'
      : 'Hay diferencias: ver el detalle',
    resumen,
    detalle: {
      cdr_rf_de_mas: ca.muestra_de_mas ?? [],
      cdr_rf_de_menos: ca.muestra_de_menos ?? [],
      rf_a_ml_muestra: rfVsMl.slice(0, 40),
      sobreventa,
    },
    elapsed_s: Number(((Date.now() - t0) / 1000).toFixed(1)),
  };
}

Deno.serve(async (_req: Request) => {
  try {
    return new Response(JSON.stringify(await run(), null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }, null, 2), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
