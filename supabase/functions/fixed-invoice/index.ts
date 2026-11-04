// deno-lint-ignore-file no-explicit-any
// fixed-invoice v1 (2026-11-04) — facturación electrónica con Fixed, desde el panel.
// Guía: docs/fixed-integracion.md · Lógica: ../_shared/fixed.ts
//
// Sólo administradores. Body { action, ... }:
//   config                     → prueba la conexión: empresa, locales y numeración (CAE)
//   preview  { order_id }      → borrador de la factura (lo que se va a mandar) + facturas de la orden
//   emit     { order_id, receptor } → emite la venta (e-Ticket o e-Factura)
//   retry    { invoice_id }    → reenvía un intento que quedó sin respuesta (misma clave)
//   refresh  { invoice_id }    → consulta el estado en DGI (y pide el PDF si faltaba)
//   credit_note { invoice_id, motivo } → anula con nota de crédito por el total
//   ml_upload { invoice_id }   → (re)sube el PDF a la venta de Mercado Libre

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';
import {
	alertAdmin,
	buildDraft,
	buildVentaJson,
	fixedCall,
	fixedConfigured,
	fixedEnvironment,
	explainFixed,
	loadInvoiceConfig,
	onlyDigits,
	refreshInvoice,
	removeInvoiceFromMl,
	sendAttempt,
	uploadInvoiceToMl,
	todayUY,
	validateDraft,
	type Receptor,
} from '../_shared/fixed.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
	auth: { persistSession: false, autoRefreshToken: false },
});

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const CANCEL_STATES = ['cancelado', 'rechazado', 'expirado', 'cancelled'];
const LIVE = ['enviando', 'emitida', 'aceptada'];

async function adminUserId(req: Request): Promise<string | null> {
	const asUser = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
		global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
		auth: { persistSession: false },
	});
	const { data: u } = await asUser.auth.getUser();
	if (!u?.user) return null;
	const { data: role } = await admin.from('user_roles').select('role').eq('user_id', u.user.id).eq('role', 'admin').maybeSingle();
	return role ? u.user.id : null;
}

/** Facturas de un grupo de órdenes (incluye las del pack de ML). */
async function invoicesFor(orderIds: number[]) {
	const { data } = await admin
		.from('invoices')
		.select('*')
		.overlaps('order_ids', orderIds)
		.order('created_at', { ascending: false });
	return data ?? [];
}

/** ¿La orden se puede facturar? (cobrada y no cancelada). */
async function invoiceableProblem(orderIds: number[]): Promise<string | null> {
	const { data } = await admin.from('orders').select('id, status, payment_status').in('id', orderIds);
	for (const o of data ?? []) {
		if (CANCEL_STATES.includes(String(o.status ?? '').toLowerCase())) return `La orden #${o.id} está cancelada.`;
		if (o.payment_status !== 'paid') return `La orden #${o.id} todavía no está cobrada.`;
	}
	return null;
}

/** El receptor que mandó el panel, limpio (nunca se confía en tipos del cliente). */
function sanitizeReceptor(r: any, fallback: Receptor): Receptor {
	if (!r || typeof r !== 'object') return fallback;
	const s = (v: unknown) => String(v ?? '').trim();
	const tipo = r.tipo === 'rut' || r.tipo === 'ci' ? r.tipo : 'final';
	return {
		tipo,
		documento: onlyDigits(r.documento),
		razonSocial: s(r.razonSocial),
		nombreComercial: s(r.nombreComercial),
		domicilio: s(r.domicilio),
		localidad: s(r.localidad),
		departamento: s(r.departamento),
		domicilioEntrega: s(r.domicilioEntrega),
		email: s(r.email),
		telefono: s(r.telefono),
	};
}

Deno.serve(async req => {
	if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
	try {
		const userId = await adminUserId(req);
		if (!userId) return json({ error: 'Sólo administradores' }, 403);
		const body = await req.json().catch(() => ({}));
		const action = String(body?.action ?? '');
		const cfg = await loadInvoiceConfig(admin);

		// ---------------------------------------------------------------- config
		if (action === 'config') {
			if (!fixedConfigured()) return json({ ok: false, configured: false, error: 'Faltan los secrets de Fixed en Supabase' });
			const [cred, locales, cae] = await Promise.all([
				fixedCall('/validarCredenciales'),
				fixedCall('/localesListado'),
				// Todos los CAE (no sólo los vigentes): si no hay ninguno usable, el panel
				// muestra por qué (vencido, agotado, deshabilitado) en vez de "ninguno".
				fixedCall('/consultaCAE', { soloDisponibles: false }),
			]);
			// Fechas de Fixed en dd/mm/aaaa → aaaa-mm-dd para poder compararlas.
			const toIso = (d: unknown) => {
				const m = String(d ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
				return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
			};
			const today = toIso(todayUY());
			return json({
				ok: cred.ok,
				configured: true,
				environment: fixedEnvironment(),
				error: cred.ok ? null : explainFixed(cred.code, cred.description),
				empresa: cred.ok ? { rut: cred.data?.rut, nombre: cred.data?.nombreEmpresa } : null,
				locales: (locales.data?.locales ?? []).map((l: any) => ({ id: l.id, nombre: l.nombre || l.nombreComercial, direccion: l.direccion })),
				cae: (cae.data?.caes ?? []).map((c: any) => {
					const vence = toIso(c.fechaVencimiento);
					const motivo = c.disponible === false ? 'deshabilitado'
						: Number(c.numerosDisponibles) <= 0 ? 'agotado'
						: vence && vence < today ? 'vencido'
						: null;
					return {
						tipo: c.tcfe, serie: c.serie, disponibles: c.numerosDisponibles, vence: c.fechaVencimiento,
						desde: c.desdeNumero, hasta: c.hastaNumero, vigente: !motivo, motivo,
					};
				}),
				cae_error: cae.ok ? null : `${cae.code || `HTTP ${cae.httpStatus}`}: ${explainFixed(cae.code, cae.description)}`,
				cae_raw: cae.ok ? null : { httpStatus: cae.httpStatus, codigoError: cae.code, descripcion: cae.description },
			});
		}

		// --------------------------------------------------------------- preview
		if (action === 'preview') {
			const orderId = Number(body?.order_id) || 0;
			if (!orderId) return json({ error: 'Falta la orden' }, 400);
			const draft = await buildDraft(admin, orderId, cfg);
			const invoices = await invoicesFor(draft.order_ids);
			return json({
				ok: true,
				enabled: cfg.enabled && fixedConfigured(),
				environment: fixedConfigured() ? fixedEnvironment() : null,
				draft,
				problems: validateDraft(draft),
				not_invoiceable: await invoiceableProblem(draft.order_ids),
				invoices,
			});
		}

		// ------------------------------------------------------------------ emit
		if (action === 'emit') {
			if (!cfg.enabled) return json({ error: 'La facturación está apagada (Configuración → Facturación).' }, 400);
			if (!fixedConfigured()) return json({ error: 'Fixed no está configurado' }, 500);
			const orderId = Number(body?.order_id) || 0;
			if (!orderId) return json({ error: 'Falta la orden' }, 400);

			const draft = await buildDraft(admin, orderId, cfg);
			draft.receptor = sanitizeReceptor(body?.receptor, draft.receptor);
			const notOk = await invoiceableProblem(draft.order_ids);
			if (notOk) return json({ error: notOk }, 400);
			const problems = validateDraft(draft);
			if (problems.length) return json({ error: problems.join(' '), problems }, 400);

			const live = (await invoicesFor(draft.order_ids)).filter(i => i.kind === 'venta' && LIVE.includes(i.status));
			if (live.length) return json({ error: `Esta orden ya tiene factura (${live[0].comprobante ?? 'en proceso'}).` }, 409);

			const key = crypto.randomUUID();
			const request = buildVentaJson(draft, cfg, key);
			const { data: row, error } = await admin
				.from('invoices')
				.insert({
					order_id: orderId,
					order_ids: draft.order_ids,
					kind: 'venta',
					environment: fixedEnvironment(),
					status: 'enviando',
					idempotency_key: key,
					request_json: request,
					moneda: draft.moneda,
					total: request.totalAPagar,
					cotizacion: draft.cotizacion,
					created_by: userId,
				})
				.select('id')
				.single();
			// Índice único: otro admin la está facturando en este momento.
			if (error) return json({ error: error.code === '23505' ? 'Esta orden ya se está facturando.' : error.message }, 409);

			let inv = await sendAttempt(admin, row.id);
			if (inv.status === 'error' && ['E04', 'E05'].includes(inv.last_error_code)) {
				await alertAdmin(`Fixed: no se puede facturar (${inv.last_error_code})`, `${inv.last_error_desc}. Orden #${orderId}.`);
			}
			// Venta de Mercado Libre: la factura se sube a la venta (sólo en producción).
			if (inv.status === 'emitida') inv = await uploadInvoiceToMl(admin, row.id);
			return json({ ok: inv.status !== 'error', invoice: inv });
		}

		// ----------------------------------------------------------------- retry
		if (action === 'retry') {
			const id = Number(body?.invoice_id) || 0;
			const { data: inv } = await admin.from('invoices').select('id, status').eq('id', id).maybeSingle();
			if (!inv) return json({ error: 'Factura no encontrada' }, 404);
			if (inv.status !== 'enviando') return json({ error: 'Sólo se reintenta un envío que quedó sin respuesta.' }, 400);
			return json({ ok: true, invoice: await sendAttempt(admin, id) });
		}

		// --------------------------------------------------------------- refresh
		if (action === 'refresh') {
			const id = Number(body?.invoice_id) || 0;
			return json({ ok: true, invoice: await refreshInvoice(admin, id) });
		}

		// ----------------------------------------------------------- credit_note
		if (action === 'credit_note') {
			if (!fixedConfigured()) return json({ error: 'Fixed no está configurado' }, 500);
			const id = Number(body?.invoice_id) || 0;
			const motivo = String(body?.motivo ?? '').trim();
			const { data: sale } = await admin.from('invoices').select('*').eq('id', id).maybeSingle();
			if (!sale || sale.kind !== 'venta') return json({ error: 'Factura no encontrada' }, 404);
			if (!['emitida', 'aceptada'].includes(sale.status) || !sale.id_cfe)
				return json({ error: sale.status === 'rechazada' ? 'DGI rechazó esta factura: no hace falta anularla.' : 'Esta factura no se puede anular.' }, 400);
			const { data: prevNc } = await admin.from('invoices').select('id, status').eq('parent_invoice_id', id).eq('kind', 'nota_credito').in('status', LIVE);
			if (prevNc?.length) return json({ error: 'Esta factura ya tiene una nota de crédito.' }, 409);

			const key = crypto.randomUUID();
			const adenda = `Anula ${sale.comprobante ?? 'factura'}${motivo ? `. ${motivo}` : ''}`.slice(0, 500);
			// Sin `cotizacion`: Fixed usa la de la venta original y la nota la anula exacta.
			const request = { idCFE: sale.id_cfe, fecha: todayUY(), ordenCompra: String(sale.order_id), adenda, totalADevolver: Number(sale.total), idempotencyKey: key };
			const { data: row, error } = await admin
				.from('invoices')
				.insert({
					order_id: sale.order_id,
					order_ids: sale.order_ids,
					kind: 'nota_credito',
					parent_invoice_id: sale.id,
					environment: sale.environment,
					status: 'enviando',
					idempotency_key: key,
					request_json: request,
					moneda: sale.moneda,
					total: sale.total,
					cotizacion: sale.cotizacion,
					note: motivo || null,
					created_by: userId,
				})
				.select('id')
				.single();
			if (error) return json({ error: error.message }, 500);

			const nc = await sendAttempt(admin, row.id);
			// Emitida la nota, la venta queda anulada (y la orden se puede refacturar).
			if (nc.status === 'emitida') {
				await admin.from('invoices').update({ status: 'anulada', updated_at: new Date().toISOString() }).eq('id', sale.id);
				// Y deja de figurar en la venta de Mercado Libre.
				await removeInvoiceFromMl(admin, sale.id);
			}
			return json({ ok: nc.status !== 'error', invoice: nc });
		}

		// ------------------------------------------------------------- ml_upload
		if (action === 'ml_upload') {
			const id = Number(body?.invoice_id) || 0;
			await admin.from('invoices').update({ ml_upload_error: null }).eq('id', id);
			return json({ ok: true, invoice: await uploadInvoiceToMl(admin, id) });
		}

		return json({ error: 'Acción desconocida' }, 400);
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : String(e) }, 500);
	}
});
