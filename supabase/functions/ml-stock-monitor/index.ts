// deno-lint-ignore-file no-explicit-any
// Polling CDR → refleja stock real CDR menos reservas activas en variants.stock.
// Bidireccional: si CDR sube (reposición) actualiza, si baja (venta externa) actualiza.
// Las reservas activas (rfstore-stock-reservation) protegen contra oversell.
//
// OJO: hoy esta funcion NO tiene cron (nunca corrio en prod). Se deja blindada por si
// se vuelve a encender.
//
// v5 (2026-08-03): EXCLUYE los productos con STOCK MANUAL (products.stock_locked). En esos
// la mercaderia es propia (comprada a CDR) y el stock de RF Store manda: si CDR dice 0 no
// hay que pisarlo. Es la misma regla que respeta cdr_bulk_update_stock_price.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CDR_EMAIL = Deno.env.get('CDR_EMAIL')!;
const CDR_TOKEN = Deno.env.get('CDR_TOKEN')!;
const SOAP_STOCKS_URL = 'https://www.cdrmedios.com/ws/productos/service.php?class=SublimewsProductosStocks';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

function escapeXml(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }
function buildEnvelope(method: string, params: Record<string, string | string[]>): string {
  const args = Object.entries(params).map(([k, v]) => {
    if (Array.isArray(v)) { const items = v.map(it => `<item xsi:type="xsd:string">${escapeXml(it)}</item>`).join(''); return `<${k} xsi:type="SOAP-ENC:Array" SOAP-ENC:arrayType="xsd:string[${v.length}]">${items}</${k}>`; }
    return `<${k} xsi:type="xsd:string">${escapeXml(v)}</${k}>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/"><SOAP-ENV:Body><${method}>${args}</${method}></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
}
async function fetchGetStock(email: string, token: string, codigos: string[]): Promise<{ codigo: string; stock: number }[]> {
  const envelope = buildEnvelope('get_stock', { email, token, productos: codigos, formato: 'json' });
  const resp = await fetch(SOAP_STOCKS_URL, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '"get_stock"' }, body: envelope });
  if (!resp.ok) throw new Error(`SOAP ${resp.status}`);
  const xml = await resp.text();
  const match = xml.match(/<(?:[a-zA-Z0-9_:]+:)?(?:[a-zA-Z0-9_]*[Rr]eturn|return)\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_:]+:)?(?:[a-zA-Z0-9_]*[Rr]eturn|return)>/);
  if (!match) throw new Error('no_return_tag');
  const decoded = match[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
  const parsed = JSON.parse(decoded);
  if (!Array.isArray(parsed)) throw new Error('not_array');
  return parsed.map((it: any) => ({ codigo: String(it.codigo), stock: typeof it.stock === 'number' ? it.stock : Number(it.stock) }));
}

async function run() {
  const t0 = Date.now();
  const stats = { items_checked: 0, increased: 0, decreased: 0, no_change: 0, skipped_locked: 0, errors: [] as string[] };

  const { data: items } = await supabase.from('ml_item_mapping').select('id, ml_item_id, status, product_id, variant_id').in('status', ['active', 'paused']);
  if (!items || items.length === 0) return { ok: true, ...stats, message: 'no_items' };

  const productIds = [...new Set(items.map((it: any) => it.product_id))];
  const variantIds = [...new Set(items.map((it: any) => it.variant_id))];
  const { data: products } = await supabase.from('products').select('id, external_code, source, stock_locked').in('id', productIds);
  const { data: variants } = await supabase.from('variants').select('id, stock').in('id', variantIds);
  const productMap = new Map((products ?? []).map((p: any) => [p.id, p]));
  const variantMap = new Map((variants ?? []).map((v: any) => [v.id, v]));

  // Stock manual = mercaderia propia: el stock de RF Store manda, CDR no lo toca.
  stats.skipped_locked = items.filter((it: any) => productMap.get(it.product_id)?.stock_locked === true).length;
  const cdrItems = items.filter((it: any) => { const p = productMap.get(it.product_id); return p?.source === 'cdr' && p?.external_code && p?.stock_locked !== true; });
  if (cdrItems.length === 0) return { ok: true, ...stats, message: 'no_cdr_items' };
  stats.items_checked = cdrItems.length;

  const codes = [...new Set(cdrItems.map((it: any) => productMap.get(it.product_id)?.external_code))] as string[];
  let cdrStocks;
  try { cdrStocks = await fetchGetStock(CDR_EMAIL, CDR_TOKEN, codes); }
  catch (e: any) { stats.errors.push(`cdr: ${e?.message}`); return { ok: false, ...stats }; }
  const cdrMap = new Map<string, number>();
  for (const s of cdrStocks) { if (s.stock === -999) continue; cdrMap.set(s.codigo, s.stock); }

  for (const it of cdrItems) {
    const product = productMap.get((it as any).product_id);
    const variant = variantMap.get((it as any).variant_id);
    if (!product || !variant) continue;
    const localStock = Number(variant.stock);
    const cdrStock = cdrMap.get(product.external_code);
    if (cdrStock === undefined) continue;

    // Restar reservas activas (ordenes en pago_pendiente / pagado / Cotización)
    const { data: reservedData } = await supabase.rpc('reserved_quantity_for_product', { p_external_code: product.external_code });
    const reserved = Number(reservedData) || 0;
    const targetLocal = Math.max(0, cdrStock - reserved);

    if (targetLocal === localStock) {
      stats.no_change++;
      continue;
    }

    // Bidireccional: aplicar el target real (CDR - reservas).
    // Es seguro porque las reservas activas ya descuentan nuestras ventas locales.
    // Si CDR repuso (sube), local sube. Si CDR vendio externamente (baja), local baja.
    const { error } = await supabase.from('variants').update({ stock: targetLocal }).eq('id', (it as any).variant_id);
    if (error) { stats.errors.push(`update ${product.external_code}: ${error.message}`); continue; }
    if (targetLocal > localStock) stats.increased++; else stats.decreased++;
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  await supabase.from('app_settings').upsert({ key: 'ml_stock_monitor_last_run', value: { ...stats, elapsed_s: Number(elapsed), at: new Date().toISOString() } as any, updated_at: new Date().toISOString() });
  return { ok: true, ...stats, elapsed_s: Number(elapsed) };
}

Deno.serve(async (_req: Request) => {
  // @ts-ignore EdgeRuntime
  EdgeRuntime.waitUntil(run());
  return new Response(JSON.stringify({ ok: true, started: true }), { status: 202, headers: { 'Content-Type': 'application/json' } });
});
