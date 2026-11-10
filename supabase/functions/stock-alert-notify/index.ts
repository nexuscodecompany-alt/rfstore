// deno-lint-ignore-file no-explicit-any
// Edge Function: stock-alert-notify (v1)
// Aviso de stock bajo en CDR. El admin prende "Avisarme cuando CDR tenga poco stock"
// en un producto (products.stock_alert_enabled + stock_alert_threshold, default 10).
// El trigger variants_cdr_stock_alert deja una fila en stock_alert_events la vez que
// el stock de CDR cruza por debajo del umbral (se rearma al volver a >= umbral), y el
// cron stock-alert-notify (stock_alert_tick, cada 10 min) llama acá sólo si hay pendientes.
// Junta todos los pendientes en UN mail. body.dry_run => devuelve los datos sin enviar.
// Destinatario: app_settings.stock_alert_notify_email -> admin_notify_email -> ADMIN_EMAIL.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const LOGO_ROW =
	`<tr><td align="center" style="padding:24px 28px 6px;background:#ffffff;"><img src="https://www.rfstore.uy/img/img-docs/logoblancorf.jpg" width="46" height="46" alt="RF Store" style="display:block;border:0;outline:none;text-decoration:none;"></td></tr>`;

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'pedidos@rfstore.uy';
const ADMIN_EMAIL_ENV = Deno.env.get('ADMIN_EMAIL') ?? '';
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://rfstore.uy';
const MAX_ATTEMPTS = 5;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function resolveRecipient(): Promise<string> {
  const { data } = await supabase.from('app_settings').select('key, value')
    .in('key', ['stock_alert_notify_email', 'admin_notify_email']);
  const get = (k: string) => {
    const v = (data ?? []).find((r: any) => r.key === k)?.value;
    return typeof v === 'string' ? v.trim() : '';
  };
  return get('stock_alert_notify_email') || get('admin_notify_email') || ADMIN_EMAIL_ENV || 'nexuscode.company@gmail.com';
}

interface Row { code: string; name: string; slug: string; before: number | null; now: number; threshold: number }

function buildHtml(when: string, rows: Row[]): string {
  const th = 'text-align:left;padding:8px 12px;background:#f9fafb;border-bottom:1px solid #e5e7eb;font-size:12px;text-transform:uppercase;color:#666;';
  const tdCode = 'padding:6px 12px;font-family:monospace;color:#555;border-bottom:1px solid #eee;';
  const td = 'padding:6px 12px;border-bottom:1px solid #eee;';
  const stockCell = (r: Row) => r.now === 0
    ? '<b style="color:#b91c1c;">0 — sin stock</b>'
    : `<b style="color:#b45309;">${r.now}</b>${r.before != null ? ` <span style="color:#888;font-size:12px;">(antes ${r.before})</span>` : ''}`;
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;"><tr><td align="center">
      <table width="640" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:640px;">${LOGO_ROW}
        <tr><td style="padding:24px 32px;background:#111;color:#fff;"><h1 style="margin:0;font-size:20px;">RF Store — Stock bajo en CDR</h1></td></tr>
        <tr><td style="padding:24px 32px;">
          <p style="margin:0 0 4px;color:#555;">${esc(when)}</p>
          <p style="margin:16px 0 12px;color:#333;font-size:14px;">Estos productos que marcaste para seguir bajaron del mínimo en CDR. Si se están vendiendo, puede ser momento de comprar stock.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:8px;">
            <tr><th style="${th}">Código</th><th style="${th}">Producto</th><th style="${th}">Stock CDR</th><th style="${th}">Aviso bajo</th></tr>
            ${rows.map(r => `<tr><td style="${tdCode}">${esc(r.code)}</td><td style="${td}"><a href="${SITE_URL}/dashboard/productos/editar/${encodeURIComponent(r.slug)}" style="color:#111;">${esc(r.name)}</a></td><td style="${td}">${stockCell(r)}</td><td style="${td}">${r.threshold}</td></tr>`).join('')}
          </table>
          <a href="${SITE_URL}/dashboard/productos" style="display:inline-block;margin-top:16px;background:#111;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;">Ver en el panel</a>
        </td></tr>
        <tr><td style="padding:20px 32px;background:#f4f4f5;color:#666;font-size:12px;text-align:center;">Se avisa una vez por producto cuando baja del mínimo; vuelve a avisar si CDR repone y después baja de nuevo. Se apaga desde el producto en el panel.</td></tr>
      </table>
    </td></tr></table></body></html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const body: { dry_run?: boolean } = req.method === 'POST' ? await req.json().catch(() => ({})) : {};

  try {
    const { data: events, error } = await supabase.from('stock_alert_events')
      .select('id, cdr_stock_before, cdr_stock, threshold, attempts, product:products(name, slug, external_code, stock_alert_enabled)')
      .is('sent_at', null).lt('attempts', MAX_ATTEMPTS)
      .order('created_at', { ascending: true }).limit(200);
    if (error) return json({ ok: false, error: error.message }, 500);
    if (!events?.length) return json({ ok: true, sent: false, reason: 'sin_pendientes' });

    // Si el admin apagó el aviso entre el cruce y el envío, no se manda (y se da por cerrado).
    const live = events.filter((e: any) => e.product?.stock_alert_enabled);
    const dropped = events.filter((e: any) => !e.product?.stock_alert_enabled).map((e: any) => e.id);

    // Un producto que cruzó dos veces antes del envío va una sola vez, con el último dato.
    const byProduct = new Map<string, Row>();
    for (const e of live as any[]) {
      byProduct.set(e.product.slug, {
        code: e.product.external_code ?? '', name: e.product.name ?? '', slug: e.product.slug ?? '',
        before: byProduct.get(e.product.slug)?.before ?? e.cdr_stock_before, now: e.cdr_stock, threshold: e.threshold,
      });
    }
    const rows = [...byProduct.values()];
    const when = new Date().toLocaleString('es-UY', { timeZone: 'America/Montevideo' });

    if (body.dry_run) return json({ ok: true, dry_run: true, rows, dropped: dropped.length });

    const nowIso = new Date().toISOString();
    if (dropped.length) {
      await supabase.from('stock_alert_events').update({ sent_at: nowIso, last_error: 'aviso_apagado' }).in('id', dropped);
    }
    if (!rows.length) return json({ ok: true, sent: false, reason: 'avisos_apagados', dropped: dropped.length });
    if (!RESEND_API_KEY) return json({ ok: false, error: 'no_resend_key' }, 500);

    const to = await resolveRecipient();
    const subject = rows.length === 1
      ? `Stock bajo en CDR: ${rows[0].name} (quedan ${rows[0].now})`
      : `Stock bajo en CDR: ${rows.length} productos`;
    const text = `RF Store — Stock bajo en CDR (${when})\n\n` +
      rows.map(r => `- [${r.code}] ${r.name}: quedan ${r.now}${r.before != null ? ` (antes ${r.before})` : ''}`).join('\n') +
      `\n\nVer en el panel: ${SITE_URL}/dashboard/productos`;

    const ids = live.map((e: any) => e.id);
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `RF Store <${FROM_EMAIL}>`, to: [to], subject, html: buildHtml(when, rows), text }),
    });
    if (!r.ok) {
      const errTxt = (await r.text()).slice(0, 300);
      for (const e of live as any[]) {
        await supabase.from('stock_alert_events').update({ attempts: e.attempts + 1, last_error: `resend ${r.status}: ${errTxt}` }).eq('id', e.id);
      }
      return json({ ok: false, error: 'resend_error', status: r.status, detail: errTxt }, 500);
    }
    await supabase.from('stock_alert_events').update({ sent_at: nowIso, last_error: null }).in('id', ids);
    return json({ ok: true, sent: true, to, productos: rows.length });
  } catch (e: any) {
    return json({ ok: false, error: e?.message ?? 'unknown' }, 500);
  }
});
