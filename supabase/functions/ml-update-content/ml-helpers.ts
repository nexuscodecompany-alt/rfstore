// deno-lint-ignore-file no-explicit-any
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
const ML_TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';
const ML_API_BASE = 'https://api.mercadolibre.com';
export async function getValidAccessToken(supabase: SupabaseClient): Promise<{ token: string; ml_user_id: number }> {
  const { data: cred } = await supabase.from('ml_credentials').select('id, access_token, refresh_token, expires_at, ml_user_id').order('id', { ascending: false }).limit(1).maybeSingle();
  if (!cred) throw new Error('no_ml_credentials');
  if (new Date(cred.expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
    const resp = await fetch(ML_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: Deno.env.get('ML_CLIENT_ID')!, client_secret: Deno.env.get('ML_CLIENT_SECRET')!, refresh_token: cred.refresh_token }).toString() });
    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(`refresh_failed: ${JSON.stringify(data).slice(0, 200)}`);
    const newExpires = new Date(Date.now() + (Number(data.expires_in) - 30) * 1000).toISOString();
    await supabase.from('ml_credentials').update({ access_token: data.access_token, refresh_token: data.refresh_token ?? cred.refresh_token, expires_at: newExpires }).eq('id', cred.id);
    return { token: data.access_token, ml_user_id: cred.ml_user_id };
  }
  return { token: cred.access_token, ml_user_id: cred.ml_user_id };
}
export async function mlFetch(path: string, options: { method?: string; token: string; body?: any } = { token: '' }): Promise<{ ok: boolean; status: number; data: any }> {
  const resp = await fetch(`${ML_API_BASE}${path}`, { method: options.method ?? 'GET', headers: { Authorization: `Bearer ${options.token}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: options.body ? JSON.stringify(options.body) : undefined });
  const text = await resp.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { ok: resp.ok, status: resp.status, data };
}
export async function getFxRate(supabaseUrl: string, anonKey: string): Promise<number> {
  const resp = await fetch(`${supabaseUrl}/functions/v1/get-fx-rate`, { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } });
  if (!resp.ok) throw new Error(`fx_rate_fetch_failed: ${resp.status}`);
  const j: any = await resp.json();
  const rate = Number(j.rate);
  if (!rate || rate <= 0) throw new Error('invalid_fx_rate');
  return rate;
}
export function htmlToPlainText(html: string): string {
  return html.replace(/<br\s*\/?\>/gi, '\n').replace(/<\/p\s*>/gi, '\n\n').replace(/<\/?[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\n{3,}/g, '\n\n').trim();
}
export function descriptionToText(description: any): string {
  if (!description) return '';
  if (typeof description === 'string') return description;
  if (description.content && Array.isArray(description.content)) {
    const parts: string[] = [];
    for (const node of description.content) {
      if (node?.type === 'html' && typeof node.html === 'string') parts.push(htmlToPlainText(node.html));
      else if (typeof node?.text === 'string') parts.push(node.text);
    }
    return parts.join('\n').trim();
  }
  return '';
}
export interface WarrantyResult { months: number; type: 'seller' | 'manufacturer'; source: 'parsed' | 'default'; }
export function parseWarranty(text: string, defaultMonths = 6): WarrantyResult {
  const lower = text.toLowerCase();
  const isOfficial = /garant[ií]a\s+(oficial|de\s+f[aá]brica|del\s+fabricante)/i.test(text) || /fabricante/i.test(lower);
  const type: 'seller' | 'manufacturer' = isOfficial ? 'manufacturer' : 'seller';
  let months: number | null = null;
  const mesMatch = lower.match(/(\d{1,3})\s*(meses?|mes)\s*(de\s+)?garant/i);
  if (mesMatch) months = parseInt(mesMatch[1], 10);
  if (!months) { const altMatch = lower.match(/garant[ií]a[^\d]{0,40}(\d{1,3})\s*(meses?|mes)/i); if (altMatch) months = parseInt(altMatch[1], 10); }
  if (!months) { const anioMatch = lower.match(/(\d{1,2})\s*a[ñn]os?\s*(de\s+)?garant/i) || lower.match(/garant[ií]a[^\d]{0,40}(\d{1,2})\s*a[ñn]os?/i); if (anioMatch) months = parseInt(anioMatch[1], 10) * 12; }
  if (months && months > 0 && months <= 60) return { months, type, source: 'parsed' };
  return { months: defaultMonths, type: 'seller', source: 'default' };
}
export function extractFromFeatures(features: string[] | null | undefined): { gtin?: string; model?: string; nro_parte?: string } {
  const result: { gtin?: string; model?: string; nro_parte?: string } = {};
  if (!features) return result;
  for (const f of features) {
    const gtinMatch = f.match(/GTIN[:\s]+(\d{8,14})/i); if (gtinMatch) result.gtin = gtinMatch[1];
    const modelMatch = f.match(/Modelo[:\s]+(.+?)(?:\s*$|\s*\.)/i); if (modelMatch) result.model = modelMatch[1].trim();
    const partMatch = f.match(/Nro\.?\s*parte[:\s]+(.+?)(?:\s*$|\s*\.)/i); if (partMatch) result.nro_parte = partMatch[1].trim();
  }
  return result;
}
export function buildTitle(productName: string, brand?: string | null, maxLen = 60): string {
  let t = productName.trim();
  t = t.replace(/\$\s*\d[\d.,]*/g, '').replace(/\b\d{8,}\b/g, '');
  if (brand && !new RegExp(`^${brand}`, 'i').test(t)) t = `${brand} ${t}`;
  t = t.replace(/\s+/g, ' ').trim();
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen).trim();
}
export interface AttrsFromText { color?: string; ram?: string; internal_memory?: string; is_dual_sim?: boolean; }
const COLOR_MAP: Record<string, string> = { negro: 'Negro', blanco: 'Blanco', azul: 'Azul', rojo: 'Rojo', verde: 'Verde', amarillo: 'Amarillo', rosa: 'Rosa', rosado: 'Rosa', dorado: 'Dorado', plateado: 'Plateado', gris: 'Gris', violeta: 'Violeta', morado: 'Violeta', celeste: 'Celeste', naranja: 'Naranja', marron: 'Marrón', beige: 'Beige', turquesa: 'Turquesa', ultramarine: 'Azul', ultramar: 'Azul' };
export function extractAttributesFromText(name: string, description: string): AttrsFromText {
  const fullText = `${name}\n${description}`;
  const lowerName = name.toLowerCase();
  const lowerFull = fullText.toLowerCase();
  const result: AttrsFromText = {};
  for (const [key, label] of Object.entries(COLOR_MAP)) { const re = new RegExp(`\\b${key}\\b`, 'i'); if (re.test(lowerName)) { result.color = label; break; } }
  if (!result.color) { for (const [key, label] of Object.entries(COLOR_MAP)) { const re = new RegExp(`\\bcolor\\s+${key}\\b`, 'i'); if (re.test(lowerFull)) { result.color = label; break; } } }
  const ramMatch = fullText.match(/(\d{1,3})\s*GB\s*(de\s+)?RAM/i) || name.match(/(\d{1,3})\s*GB\b(?=\s+\d)/i);
  if (ramMatch) result.ram = `${ramMatch[1]} GB`;
  const memMatch = fullText.match(/(\d{2,4})\s*GB\s+(de\s+)?almacenamiento/i) || fullText.match(/almacenamiento[^\d]{0,30}(\d{2,4})\s*GB/i) || name.match(/\b(\d{2,4})\s*GB\b(?!\s*RAM)/i);
  if (memMatch) { const gb = parseInt(memMatch[1], 10); if (gb >= 16) result.internal_memory = `${gb} GB`; }
  if (/dual\s*sim/i.test(fullText) || /dos\s+sim/i.test(fullText) || /2\s+sim/i.test(fullText)) result.is_dual_sim = true;
  else if (/single\s*sim/i.test(fullText) || /\b1\s*sim\b/i.test(fullText)) result.is_dual_sim = false;
  return result;
}
const BLACKLIST_PHRASES = ['mundo mac', 'telcomar', 'plaza tech', 'tienda inglesa', 'punto blanco', 'mall del libertador', 'ishop', 'cdrmedios'];
// ML marca como spam las direcciones fisicas y datos de contacto de terceros (services,
// distribuidores). En RF Store la descripcion queda INTACTA; esto solo limpia lo que se
// manda a Mercado Libre. Ejemplo real que ML rechaza: "Direccion: Constituyente 1681".
const ADDRESS_LABEL_RE = /^\s*(direcci[oó]n|domicilio|local(es)?|sucursal(es)?|ubicaci[oó]n|dir|showroom|show\s?room|atenci[oó]n al p[uú]blico|nos encontramos|nuestro local|retir(o|ar)|venta[s]? al p[uú]blico)\b/i;
const ADDRESS_STREET_START_RE = /^\s*(av\.?|avda\.?|avenida|bulevar|bvar\.?|blvd\.?|calle|ruta|camino|cno\.?|pasaje|psje\.?)\s+\S+.*\b\d{1,5}\b/i;
const SERVICE_CONTEXT_RE = /\b(concurrir|acercarse|dirigirse|presentarse|dirij[aá]se)\b.{0,80}\b(factura|service|garant[ií]a|t[eé]cnico|oficial)\b/i;
export function sanitizeDescription(text: string): string {
  if (!text) return '';
  let s = text.replace(/https?:\/\/\S+/gi, '').replace(/\bwww\.[\w\-./?&=%#]+/gi, '');
  s = s.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '');
  const lines = s.split(/\n+/);
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const lower = line.toLowerCase();
    if (BLACKLIST_PHRASES.some(p => lower.includes(p))) continue;
    if (/(\btel\.?:?|\bcel\.?:?|\bwhatsapp\b|\bwsp\b|\bphone\b)/i.test(line) && /\d/.test(line)) continue;
    // Direcciones fisicas y datos de service/terceros: ML los toma como spam.
    if (ADDRESS_LABEL_RE.test(line)) continue;
    if (ADDRESS_STREET_START_RE.test(line)) continue;
    if (SERVICE_CONTEXT_RE.test(line)) continue;
    const dc = (line.replace(/[^0-9]/g, '').length);
    const wc = line.split(/\s+/).length;
    if (dc >= 7 && wc <= 4) continue;
    out.push(line);
  }
  return out.join('\n').trim();
}
export interface BuildDescInput { productName: string; cleanDesc: string; brand?: string | null; model?: string; gtin?: string; color?: string | null; ram?: string; internalMemory?: string | null; isDualSim?: boolean; warrantyMonths: number; warrantyType: 'seller' | 'manufacturer'; }
export function buildMlDescription(i: BuildDescInput): string {
  const sep = '----------------------------------------';
  const specsLines: string[] = [];
  if (i.brand) specsLines.push(`Marca: ${i.brand}`);
  if (i.model) specsLines.push(`Modelo: ${i.model}`);
  if (i.color) specsLines.push(`Color: ${i.color}`);
  if (i.internalMemory) specsLines.push(`Almacenamiento: ${i.internalMemory}`);
  if (i.ram) specsLines.push(`Memoria RAM: ${i.ram}`);
  if (i.isDualSim != null) specsLines.push(`Dual SIM: ${i.isDualSim ? 'Sí' : 'No'}`);
  if (i.gtin) specsLines.push(`Código de barras (GTIN): ${i.gtin}`);
  const warrantyLabel = i.warrantyType === 'manufacturer' ? 'Garantía de fábrica' : 'Garantía del vendedor';
  const parts: string[] = [];
  parts.push(i.productName.toUpperCase());
  parts.push('');
  parts.push(sep); parts.push('CARACTERÍSTICAS PRINCIPALES'); parts.push(sep);
  if (specsLines.length) parts.push(specsLines.join('\n'));
  if (i.cleanDesc) { parts.push(''); parts.push(sep); parts.push('DESCRIPCIÓN DETALLADA'); parts.push(sep); parts.push(i.cleanDesc); }
  parts.push(''); parts.push(sep); parts.push('GARANTÍA'); parts.push(sep);
  parts.push(`* ${warrantyLabel}: ${i.warrantyMonths} meses`);
  parts.push('* Producto nuevo, sin uso y sellado');
  parts.push('* Facturación con IVA disponible (RUT empresa o consumidor final)');
  parts.push(''); parts.push(sep); parts.push('ENVÍOS'); parts.push(sep);
  parts.push('* Envío por Mercado Envíos a todo Uruguay');
  parts.push('* Despacho desde Montevideo el mismo día de la confirmación de pago');
  parts.push('* Compra protegida por Mercado Libre y Mercado Pago');
  parts.push(''); parts.push(sep); parts.push('SOMOS RF STORE'); parts.push(sep);
  parts.push('* Tecnología con stock real, garantía y respaldo');
  parts.push('* Más de 10 años en el rubro informática en Uruguay');
  parts.push('* Atención personalizada en cada compra');
  return parts.join('\n').slice(0, 49000);
}
