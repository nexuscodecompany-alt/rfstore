// deno-lint-ignore-file no-explicit-any
// Edge Function: ml-update-content (v1)
// Actualiza TITULO y DESCRIPCION de una publicacion ML ya existente, tomando el
// contenido ACTUAL del producto en RF Store (que se sincroniza de CDR).
// Disparo MANUAL (boton "Actualizar en ML" en el panel): NO se auto-encola, para no
// re-disparar la moderacion de ML sin control mientras la cuenta esta bajo revision.
// NO toca precio / stock / atributos: solo titulo + descripcion (con filtro anti-spam).
// Al terminar OK apaga products.ml_content_dirty.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { getValidAccessToken, mlFetch, descriptionToText, parseWarranty, extractFromFeatures, buildTitle, extractAttributesFromText, sanitizeDescription, buildMlDescription } from './ml-helpers.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// sub_status de ML que indican moderacion/infraccion/baneo: NUNCA editar (rebota o empeora).
const MODERATION_SUBSTATUS = ['under_review', 'banned', 'forbidden', 'freezed', 'deleted', 'suspended', 'waiting_for_patch'];

// Texto plano "seguro" para ML: sin tags, sin entidades, sin caracteres de control.
function toPureplainText(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&[a-zA-Z]+;/g, ' ')
    .replace(/&#\d+;/g, ' ')
    .replace(/[\x00-\x08\x0b-\x1f]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
}

async function logEvent(topic: string, payload: any, errorMsg?: string) {
  try { await supabase.from('ml_webhook_events').insert({ topic, resource: 'update-content', payload, processing_status: errorMsg ? 'error' : 'done', error: errorMsg ?? null }); } catch (_) {}
}

interface Body { product_id: string; variant_id?: string; dry_run?: boolean; }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  let body: Body;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'invalid_json' }, 400); }
  const { product_id, variant_id, dry_run } = body;
  if (!product_id) return json({ ok: false, error: 'missing_product_id' }, 400);

  try {
    const { data: product, error: pErr } = await supabase.from('products').select('id, name, external_code, features, description, brand_id, active').eq('id', product_id).single();
    if (pErr || !product) throw new Error(`product_not_found: ${pErr?.message ?? 'null'}`);

    let brandName: string | null = null;
    if (product.brand_id) {
      const { data: b } = await supabase.from('brands').select('name').eq('id', product.brand_id).single();
      brandName = b?.name ?? null;
    }

    // Publicacion vinculada (activa o pausada). Si mandan variant_id, filtramos por el.
    let mapQuery = supabase.from('ml_item_mapping').select('id, ml_item_id, status, variant_id').eq('product_id', product_id).in('status', ['active', 'paused']);
    if (variant_id) mapQuery = mapQuery.eq('variant_id', variant_id);
    const { data: mapping } = await mapQuery.order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!mapping) throw new Error('no_active_mapping');
    const mlItemId = mapping.ml_item_id;

    const { data: settingsRows } = await supabase.from('app_settings').select('key, value').in('key', ['ml_warranty_months_default']);
    const settings = new Map((settingsRows ?? []).map((r: any) => [r.key, r.value]));
    const warrantyDefault = Number(settings.get('ml_warranty_months_default') ?? 6);

    const { token } = await getValidAccessToken(supabase);

    // Guard de moderacion: si ML tiene el item bajo revision/forbidden/etc, editar rebota o
    // lo empeora -> no lo tocamos y dejamos ml_content_dirty en true para reintentar mas tarde.
    const cq = await mlFetch(`/items/${mlItemId}?attributes=status,sub_status`, { token });
    const st = cq.data?.status;
    const sub: string[] = Array.isArray(cq.data?.sub_status) ? cq.data.sub_status.map((s: any) => String(s)) : [];
    if (cq.ok && (MODERATION_SUBSTATUS.some(f => sub.includes(f)) || st === 'under_review')) {
      await logEvent('ml_update_content_skipped_moderated', { product_id, ml_item_id: mlItemId, status: st, sub_status: sub });
      return json({ ok: false, error: 'item_moderated', ml_status: st, sub_status: sub }, 200);
    }

    // Variante (para color / almacenamiento en la ficha de la descripcion).
    let variantColorName: string | null = null;
    let variantStorage: string | null = null;
    if (mapping.variant_id) {
      const { data: v } = await supabase.from('variants').select('color_name, storage').eq('id', mapping.variant_id).maybeSingle();
      variantColorName = v?.color_name ?? null;
      variantStorage = v?.storage ?? null;
    }

    const title = buildTitle(product.name, brandName, 60);
    const rawDescText = descriptionToText(product.description);
    const cleanDesc = sanitizeDescription(rawDescText);
    const fullText = `${rawDescText}\n${(product.features ?? []).join('\n')}\n${product.name}`;
    const warranty = parseWarranty(fullText, warrantyDefault);
    const featuresExtracted = extractFromFeatures(product.features);
    const attrsFromText = extractAttributesFromText(product.name, rawDescText);
    const color = attrsFromText.color || (variantColorName && variantColorName !== 'Unico' ? variantColorName : null);
    const internalMemory = attrsFromText.internal_memory || (variantStorage && variantStorage !== '-' ? variantStorage : null);

    const builtDesc = buildMlDescription({
      productName: product.name, cleanDesc: toPureplainText(cleanDesc), brand: brandName,
      model: featuresExtracted.model, gtin: featuresExtracted.gtin,
      color, ram: attrsFromText.ram, internalMemory, isDualSim: attrsFromText.is_dual_sim,
      warrantyMonths: warranty.months, warrantyType: warranty.type,
    });
    const finalDescription = toPureplainText(builtDesc);

    if (dry_run) {
      return json({ ok: true, dry_run: true, ml_item_id: mlItemId, title, descriptionPreview: finalDescription, descriptionLength: finalDescription.length });
    }

    // Titulo: PUT /items/{id}. ML puede rechazarlo si el item ya tuvo ventas (limita cambios de titulo).
    const put = await mlFetch(`/items/${mlItemId}`, { method: 'PUT', token, body: { title } });
    const titleOk = put.ok;

    // Descripcion: PUT para modificar; si no existe / rechaza, POST para crear.
    let descOk = false;
    let descErr: any = null;
    const dput = await mlFetch(`/items/${mlItemId}/description`, { method: 'PUT', token, body: { plain_text: finalDescription } });
    if (dput.ok) descOk = true;
    else {
      const dpost = await mlFetch(`/items/${mlItemId}/description`, { method: 'POST', token, body: { plain_text: finalDescription } });
      descOk = dpost.ok;
      if (!descOk) descErr = dpost.data;
    }

    const bothOk = titleOk && descOk;
    // Solo apagamos el flag si TODO salio bien; si algo fallo lo dejamos prendido para reintentar.
    if (bothOk) {
      await supabase.from('products').update({ ml_content_dirty: false }).eq('id', product_id);
    }
    await supabase.from('ml_item_mapping').update({ last_synced_at: new Date().toISOString() }).eq('id', mapping.id);

    await logEvent('ml_update_content', { product_id, ml_item_id: mlItemId, title, titleOk, descOk, title_error: titleOk ? null : put.data, desc_error: descErr, descriptionLength: finalDescription.length }, bothOk ? undefined : `title=${titleOk} desc=${descOk}`);

    return json({
      ok: bothOk,
      ml_item_id: mlItemId,
      title,
      title_updated: titleOk,
      description_updated: descOk,
      detail: titleOk ? undefined : put.data,
      desc_error: descErr,
    });
  } catch (e: any) {
    await logEvent('ml_update_content_exception', { product_id, stack: e?.stack?.slice(0, 500) }, e?.message);
    return json({ ok: false, error: e?.message ?? 'unknown' }, 500);
  }
});
