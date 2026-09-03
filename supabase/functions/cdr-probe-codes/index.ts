// Edge Function: cdr-probe-codes - READ ONLY.
// Devuelve la lista de codigos que CDR manda con habilitado=0.
// Truco: una fecha futura hace que el WS devuelva SOLO los deshabilitados
// (los ignora el filtro de fecha). No escribe nada.
const SOAP_URL = 'https://www.cdrmedios.com/ws/productos/service.php?class=SublimewsProductosUsuariosCompleto';
const CDR_EMAIL = Deno.env.get('CDR_EMAIL')!;
const CDR_TOKEN = Deno.env.get('CDR_TOKEN')!;

function esc(s: string) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;'); }

Deno.serve(async () => {
  const d = new Date(Date.now() + 48 * 3600_000);
  const fecha = d.toISOString().slice(0, 19).replace('T', ' ');
  const args = Object.entries({ email: CDR_EMAIL, token: CDR_TOKEN, fecha, formato: 'json' })
    .map(([k, v]) => `<${k} xsi:type="xsd:string">${esc(String(v))}</${k}>`).join('');
  const envelope = `<?xml version="1.0" encoding="UTF-8"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/"><SOAP-ENV:Body><productos_con_galeria>${args}</productos_con_galeria></SOAP-ENV:Body></SOAP-ENV:Envelope>`;

  const resp = await fetch(SOAP_URL, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '"productos_con_galeria"' }, body: envelope });
  const xml = await resp.text();
  const m = xml.match(/<(?:[a-zA-Z0-9_:]+:)?(?:[a-zA-Z0-9_]*[Rr]eturn|return)\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_:]+:)?(?:[a-zA-Z0-9_]*[Rr]eturn|return)>/);
  if (!m) return new Response(JSON.stringify({ error: 'sin tag' }), { status: 500 });
  const raw = m[1].replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&').trim();
  const prods = JSON.parse(raw);
  if (!Array.isArray(prods)) return new Response(JSON.stringify({ error_ws: prods }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  const desh = prods.filter((p: any) => Number(p?.habilitado ?? 0) <= 0);
  return new Response(JSON.stringify({
    fecha_futura_usada: fecha,
    total_devueltos: prods.length,
    deshabilitados: desh.length,
    habilitados_colados: prods.length - desh.length,
    codigos: desh.map((p: any) => p.codigo),
    con_stock_declarado: desh.filter((p: any) => Number(p?.stock ?? 0) > 0).map((p: any) => ({ codigo: p.codigo, stock: p.stock })),
  }, null, 2), { headers: { 'Content-Type': 'application/json' } });
});
