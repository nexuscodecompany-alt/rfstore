// deno-lint-ignore-file no-explicit-any
// Edge Function: cdr-daily-digest (v1)
// UN solo mail por dia (6 AM Montevideo, via cron cdr_daily_digest_tick) al dueno con:
//   - Productos NUEVOS de CDR de las ultimas 24h (source=cdr, created_at).
//   - Productos cuyo CONTENIDO (nombre/descripcion) cambio en las ultimas 24h
//     (cdr_content_changed_at), marcando cuales estan en ML.
// Reemplaza los digests "por corrida" del sync (que quedan apagados por cdr_digest_daily=true).
// Si no hay novedades, NO manda mail. body.dry_run => devuelve los datos sin enviar.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'pedidos@rfstore.uy';
const ADMIN_EMAIL_ENV = Deno.env.get('ADMIN_EMAIL') ?? '';
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://rfstore.uy';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function resolveAdminEmail(): Promise<string> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'admin_notify_email').maybeSingle();
  const fromSetting = typeof data?.value === 'string' ? data.value : '';
  return fromSetting || ADMIN_EMAIL_ENV || 'nexuscode.company@gmail.com';
}

interface NewRow { code: string; name: string }
interface ChangedRow { code: string; name: string; in_ml: boolean; locked: boolean }

function buildHtml(when: string, nuevos: NewRow[], cambios: ChangedRow[]): string {
  const th = 'text-align:left;padding:8px 12px;background:#f9fafb;border-bottom:1px solid #e5e7eb;font-size:12px;text-transform:uppercase;color:#666;';
  const tdCode = 'padding:6px 12px;font-family:monospace;color:#555;border-bottom:1px solid #eee;';
  const td = 'padding:6px 12px;border-bottom:1px solid #eee;';
  const badge = (c: ChangedRow) => {
    const parts: string[] = [];
    if (c.locked) parts.push('<span style="display:inline-block;background:#fef3c7;color:#92400e;border-radius:6px;padding:1px 8px;font-size:11px;">candado</span>');
    if (c.in_ml) parts.push('<span style="display:inline-block;background:#dbeafe;color:#1e40af;border-radius:6px;padding:1px 8px;font-size:11px;">en ML</span>');
    return parts.join(' ') || '<span style="color:#16a34a;font-size:11px;">solo web</span>';
  };
  const nuevosBlock = nuevos.length === 0 ? '' : `
    <p style="margin:24px 0 8px;font-size:15px;font-weight:700;color:#111;">🆕 ${nuevos.length} producto${nuevos.length === 1 ? '' : 's'} nuevo${nuevos.length === 1 ? '' : 's'} de CDR</p>
    <p style="margin:0 0 12px;color:#555;font-size:13px;">Entran inactivos y sin categoría/marca: asignáles y activálos.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:8px;">
      <tr><th style="${th}">Código</th><th style="${th}">Nombre</th></tr>
      ${nuevos.map(n => `<tr><td style="${tdCode}">${esc(n.code)}</td><td style="${td}">${esc(n.name)}</td></tr>`).join('')}
    </table>`;
  const cambiosBlock = cambios.length === 0 ? '' : `
    <p style="margin:28px 0 8px;font-size:15px;font-weight:700;color:#111;">✏️ ${cambios.length} producto${cambios.length === 1 ? '' : 's'} con cambios de nombre/descripción en CDR</p>
    <p style="margin:0 0 12px;color:#555;font-size:13px;">En la web ya quedaron actualizados. Los marcados <b>en ML</b> podés actualizarlos con el botón "Actualizar en ML".</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:8px;">
      <tr><th style="${th}">Código</th><th style="${th}">Nombre (nuevo)</th><th style="${th}">Dónde</th></tr>
      ${cambios.map(c => `<tr><td style="${tdCode}">${esc(c.code)}</td><td style="${td}">${esc(c.name)}</td><td style="${td}">${badge(c)}</td></tr>`).join('')}
    </table>`;
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;"><tr><td align="center">
      <table width="640" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:640px;">
        <tr><td style="padding:24px 32px;background:#111;color:#fff;"><h1 style="margin:0;font-size:20px;">RF Store — Resumen diario</h1></td></tr>
        <tr><td style="padding:24px 32px;">
          <p style="margin:0 0 4px;color:#555;">${esc(when)}</p>
          ${nuevosBlock}
          ${cambiosBlock}
          <a href="${SITE_URL}/dashboard/productos" style="display:inline-block;margin-top:16px;background:#111;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;">Ver en el panel</a>
        </td></tr>
        <tr><td style="padding:20px 32px;background:#f4f4f5;color:#666;font-size:12px;text-align:center;">RF Store — resumen automático diario de catálogo CDR</td></tr>
      </table>
    </td></tr></table></body></html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const body: { dry_run?: boolean; hours?: number } = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const hours = Number(body.hours) > 0 ? Number(body.hours) : 24;
  const sinceIso = new Date(Date.now() - hours * 3600 * 1000).toISOString();

  try {
    const { data: nuevosRaw } = await supabase.from('products')
      .select('external_code, name, created_at')
      .eq('source', 'cdr').gte('created_at', sinceIso)
      .order('created_at', { ascending: false }).limit(500);
    const nuevos: NewRow[] = (nuevosRaw ?? []).map((r: any) => ({ code: r.external_code ?? '', name: r.name ?? '' }));

    const { data: cambiosRaw } = await supabase.from('products')
      .select('external_code, name, is_in_ml, content_locked, cdr_content_changed_at')
      .gte('cdr_content_changed_at', sinceIso)
      .order('cdr_content_changed_at', { ascending: false }).limit(500);
    const cambios: ChangedRow[] = (cambiosRaw ?? []).map((r: any) => ({ code: r.external_code ?? '', name: r.name ?? '', in_ml: !!r.is_in_ml, locked: !!r.content_locked }));

    if (nuevos.length === 0 && cambios.length === 0) {
      return json({ ok: true, sent: false, reason: 'sin_novedades', nuevos: 0, cambios: 0 });
    }

    const when = new Date().toLocaleString('es-UY', { timeZone: 'America/Montevideo' });
    if (body.dry_run) {
      return json({ ok: true, sent: false, dry_run: true, nuevos: nuevos.length, cambios: cambios.length, nuevosList: nuevos.slice(0, 20), cambiosList: cambios.slice(0, 20) });
    }
    if (!RESEND_API_KEY) return json({ ok: false, error: 'no_resend_key', nuevos: nuevos.length, cambios: cambios.length }, 500);

    const to = await resolveAdminEmail();
    const nMl = cambios.filter(c => c.in_ml).length;
    const subjectBits: string[] = [];
    if (nuevos.length) subjectBits.push(`${nuevos.length} nuevo${nuevos.length === 1 ? '' : 's'}`);
    if (cambios.length) subjectBits.push(`${cambios.length} con cambios`);
    const subject = `RF Store — Resumen diario: ${subjectBits.join(' y ')}`;
    const html = buildHtml(when, nuevos, cambios);
    const text = `RF Store — Resumen diario (${when})\n\n` +
      (nuevos.length ? `NUEVOS (${nuevos.length}):\n` + nuevos.map(n => `- [${n.code}] ${n.name}`).join('\n') + '\n\n' : '') +
      (cambios.length ? `CON CAMBIOS (${cambios.length}${nMl ? `, ${nMl} en ML` : ''}):\n` + cambios.map(c => `- [${c.code}] ${c.name}${c.in_ml ? ' (en ML)' : ''}${c.locked ? ' (candado)' : ''}`).join('\n') + '\n\n' : '') +
      `Ver en el panel: ${SITE_URL}/dashboard/productos`;

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `RF Store <${FROM_EMAIL}>`, to: [to], subject, html, text }),
    });
    if (!r.ok) {
      const errTxt = (await r.text()).slice(0, 300);
      return json({ ok: false, error: 'resend_error', status: r.status, detail: errTxt, nuevos: nuevos.length, cambios: cambios.length }, 500);
    }
    return json({ ok: true, sent: true, to, nuevos: nuevos.length, cambios: cambios.length, ml_en_cambios: nMl });
  } catch (e: any) {
    return json({ ok: false, error: e?.message ?? 'unknown' }, 500);
  }
});
