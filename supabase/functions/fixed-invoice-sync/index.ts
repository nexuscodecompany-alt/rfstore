// deno-lint-ignore-file no-explicit-any
// fixed-invoice-sync v1 (2026-11-04) — seguimiento de las facturas de Fixed.
//
// DGI responde en diferido: cada 10 minutos (pg_cron → fixed_invoice_sync_tick,
// que sólo llama si hay algo pendiente) se hace esto:
//  - "emitida": se consulta el estado en DGI (/ventaConsulta) hasta que sea
//    aceptada o rechazada. Si faltaba el PDF se pide con /imprimirCFE.
//  - "enviando": un envío que se quedó sin respuesta se reenvía con el MISMO JSON
//    y la MISMA clave (Fixed devuelve el resultado original, no factura dos veces).
// Un rechazo de DGI o un envío trabado le llega por mail al admin.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';
import { alertAdmin, fixedConfigured, refreshInvoice, sendAttempt, uploadInvoiceToMl } from '../_shared/fixed.ts';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
	auth: { persistSession: false, autoRefreshToken: false },
});

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// Avisar una sola vez cuando un envío lleva este número de intentos sin respuesta.
const STUCK_ATTEMPTS = 6;

Deno.serve(async req => {
	if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
	try {
		if (!fixedConfigured()) return json({ ok: false, error: 'Fixed no está configurado' });
		const since = new Date(Date.now() - 15 * 24 * 3600_000).toISOString();
		const recent = new Date(Date.now() - 3 * 60_000).toISOString();
		const { data: rows, error } = await supabase
			.from('invoices')
			.select('id, order_id, kind, status, attempts, comprobante, updated_at')
			.in('status', ['enviando', 'emitida'])
			.gt('created_at', since)
			// Lo que se acaba de tocar desde el panel se deja para la próxima vuelta.
			.lt('updated_at', recent)
			.order('created_at', { ascending: true })
			.limit(40);
		if (error) throw new Error(error.message);

		const results: any[] = [];
		for (const r of rows ?? []) {
			try {
				if (r.status === 'enviando') {
					const inv = await sendAttempt(supabase, r.id);
					if (inv.status === 'enviando' && inv.attempts === STUCK_ATTEMPTS) {
						await alertAdmin(
							'Fixed: una factura no tiene respuesta',
							`La factura de la orden #${r.order_id} lleva ${inv.attempts} intentos sin respuesta de Fixed. Se sigue reintentando sin riesgo de duplicarla; si no se resuelve, revisala en Fixed.`
						);
					}
					results.push({ id: r.id, status: inv.status });
				} else {
					let inv = await refreshInvoice(supabase, r.id);
					// Venta de ML que todavía no se subió (p. ej. el PDF llegó recién).
					if (!inv.ml_fiscal_document_id && !inv.ml_upload_error) inv = await uploadInvoiceToMl(supabase, r.id);
					if (inv.status === 'rechazada') {
						await alertAdmin(
							`Fixed: DGI rechazó ${inv.comprobante ?? 'una factura'}`,
							`Orden #${r.order_id}. Motivo: ${inv.motivo_rechazo_dgi || 'sin detalle'}. ` +
								(r.kind === 'nota_credito'
									? 'Era la nota de crédito: la factura original NO quedó anulada ante DGI, revisalo en Fixed.'
									: 'Se puede volver a facturar desde la orden.')
						);
					}
					results.push({ id: r.id, status: inv.status });
				}
			} catch (e) {
				results.push({ id: r.id, error: e instanceof Error ? e.message : String(e) });
			}
		}
		console.log(`[fixed-invoice-sync] ${results.length}:`, JSON.stringify(results).slice(0, 2000));
		return json({ ok: true, checked: results.length, results });
	} catch (e) {
		return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
	}
});
