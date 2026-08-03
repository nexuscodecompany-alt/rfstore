// deno-lint-ignore-file no-explicit-any
// Edge Function: ml-item-activate (v1, 2026-08-03)
// Activa (o pausa) A MANO una publicacion de ML desde el panel de admin.
//
// Caso de uso: RF compro todo el stock en CDR -> el stock quedo en 0 y la publicacion
// se pauso; despues cargaron stock manual pero la publicacion nunca volvio. Con esto
// el admin la reactiva cuando quiere, sin automatismos.
//
// IMPORTANTE (aprendido el 2026-08-03 con MLU694307011): ML puede responder 200 al
// PUT status=active y DEJAR la publicacion igual (p.ej. si esta en under_review /
// waiting_for_patch). Por eso esta funcion NO confia en el 200: vuelve a leer el item
// y devuelve el estado REAL, y sincroniza ml_item_mapping con lo que ML dice de verdad.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ML_CLIENT_ID = Deno.env.get('ML_CLIENT_ID')!;
const ML_CLIENT_SECRET = Deno.env.get('ML_CLIENT_SECRET')!;
const ML_TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';
const ML_API_BASE = 'https://api.mercadolibre.com';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// sub_status de ML que indican moderacion/infraccion: activar NO sirve (ML lo ignora).
const MODERATION_SUBSTATUS = ['under_review', 'banned', 'forbidden', 'freezed', 'deleted', 'suspended', 'waiting_for_patch'];

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

async function mlReq(path: string, method: string, token: string, body?: any) {
  const r = await fetch(`${ML_API_BASE}${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let d: any = {};
  try { d = JSON.parse(t); } catch { d = { raw: t }; }
  return { ok: r.ok, status: r.status, data: d };
}

async function logSync(row: any) {
  try { await supabase.from('ml_sync_log').insert(row); } catch (_e) { /* best effort */ }
}

interface Body { product_id: string; variant_id?: string; action?: 'activate' | 'pause'; }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  let body: Body;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'invalid_json' }, 400); }
  const { product_id, variant_id } = body;
  const action = body.action === 'pause' ? 'pause' : 'activate';
  if (!product_id) return json({ ok: false, error: 'missing_product_id' }, 400);

  try {
    // Publicacion vinculada (activa o pausada).
    let mapQuery = supabase.from('ml_item_mapping')
      .select('id, ml_item_id, status, variant_id')
      .eq('product_id', product_id).in('status', ['active', 'paused']);
    if (variant_id) mapQuery = mapQuery.eq('variant_id', variant_id);
    const { data: mapping } = await mapQuery.order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!mapping) return json({ ok: false, error: 'no_active_mapping' }, 200);

    const mlItemId = mapping.ml_item_id;
    const token = await getToken();

    // Stock actual de RF Store: es el que mandamos a ML (nunca el de CDR).
    const { data: variant } = await supabase.from('variants').select('stock').eq('id', mapping.variant_id).maybeSingle();
    const stock = Number(variant?.stock ?? 0);

    const { data: prod } = await supabase.from('products').select('external_code').eq('id', product_id).maybeSingle();
    const baseLog = { ml_item_id: mlItemId, variant_id: mapping.variant_id, external_code: prod?.external_code ?? null, operation: action === 'pause' ? 'pause' : 'reactivate', old_ml_status: mapping.status, source: 'admin_button' };

    // Estado ANTES: si ML la tiene moderada, activar no hace nada (responde 200 y la deja igual).
    const before = await mlReq(`/items/${mlItemId}?attributes=status,sub_status,available_quantity`, 'GET', token);
    const stBefore = before.data?.status;
    const subBefore: string[] = Array.isArray(before.data?.sub_status) ? before.data.sub_status.map((s: any) => String(s)) : [];
    const moderated = before.ok && (MODERATION_SUBSTATUS.some(f => subBefore.includes(f)) || stBefore === 'under_review');

    if (action === 'activate' && moderated) {
      await supabase.from('ml_item_mapping').update({ last_synced_at: new Date().toISOString() }).eq('id', mapping.id);
      await logSync({ ...baseLog, action: 'skipped_moderated', new_ml_status: stBefore, stock, result: 'ok', error: `status=${stBefore} sub=${JSON.stringify(subBefore)}` });
      return json({ ok: false, error: 'item_moderated', ml_status: stBefore, sub_status: subBefore, ml_item_id: mlItemId }, 200);
    }

    if (action === 'activate' && stock <= 0) {
      return json({ ok: false, error: 'no_stock', stock, ml_item_id: mlItemId }, 200);
    }

    // El PUT. Al activar mandamos tambien la cantidad: reactivar solo cambia el estado y
    // ML conserva la cantidad vieja (por eso una publicacion reactivada mostraba "2").
    const payload = action === 'pause' ? { status: 'paused' } : { status: 'active', available_quantity: stock };
    const put = await mlReq(`/items/${mlItemId}`, 'PUT', token, payload);

    // Estado DESPUES, leido de ML: la unica verdad. ML puede devolver 200 y no cambiar nada.
    const after = await mlReq(`/items/${mlItemId}?attributes=status,sub_status,available_quantity,permalink`, 'GET', token);
    const stAfter = after.data?.status;
    const subAfter: string[] = Array.isArray(after.data?.sub_status) ? after.data.sub_status.map((s: any) => String(s)) : [];
    const qtyAfter = after.data?.available_quantity ?? null;

    // Sincronizamos el mapping con lo que ML dice DE VERDAD (no con el 200 del PUT).
    const realStatus = stAfter === 'active' ? 'active' : stAfter === 'paused' ? 'paused' : mapping.status;
    await supabase.from('ml_item_mapping').update({
      status: realStatus,
      auto_paused_stock: false,
      last_known_stock: stock,
      last_synced_at: new Date().toISOString(),
    }).eq('id', mapping.id);

    const applied = action === 'activate' ? stAfter === 'active' : stAfter === 'paused';
    await logSync({
      ...baseLog,
      action: applied ? (action === 'pause' ? 'paused' : 'reactivated') : 'not_applied',
      new_ml_status: stAfter, stock, result: applied ? 'ok' : 'error',
      error: applied ? null : `ML respondio ${put.status} pero quedo status=${stAfter} sub=${JSON.stringify(subAfter)}`,
    });

    if (!applied) {
      return json({
        ok: false,
        error: put.ok ? 'not_applied' : `ml_${put.status}`,
        ml_status: stAfter, sub_status: subAfter, ml_item_id: mlItemId,
        detail: put.ok ? null : put.data,
      }, 200);
    }

    return json({
      ok: true, ml_item_id: mlItemId, ml_status: stAfter, sub_status: subAfter,
      available_quantity: qtyAfter, stock, permalink: after.data?.permalink ?? null,
    });
  } catch (e: any) {
    return json({ ok: false, error: e?.message ?? 'unknown_error' }, 200);
  }
});
