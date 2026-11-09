// deno-lint-ignore-file no-explicit-any
// Placetopay (Getnet Uruguay) — WebCheckout.
// Docs: https://docs.placetopay.dev/checkout
//
// Lo usan placetopay-create-session, -webhook, -status, -reconcile y -refund.
// Credenciales en los secrets de las edge functions (NUNCA en app_settings, que
// es de lectura pública): PTP_BASE_URL, PTP_LOGIN, PTP_SECRET_KEY.
//
// Regla de oro: el estado de un pago se decide SIEMPRE consultando la sesión a
// Placetopay (syncSession). El aviso (webhook) sólo dispara esa consulta.

const BASE_URL = (Deno.env.get('PTP_BASE_URL') ?? '').replace(/\/+$/, '');
const LOGIN = Deno.env.get('PTP_LOGIN') ?? '';
const SECRET_KEY = Deno.env.get('PTP_SECRET_KEY') ?? '';

export const ptpConfigured = () => BASE_URL !== '' && LOGIN !== '' && SECRET_KEY !== '';

/* ------------------------------------------------------------------------ */
/*  Autenticación                                                            */
/* ------------------------------------------------------------------------ */

const toB64 = (bytes: Uint8Array) => {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s);
};

const sha256 = async (text: string): Promise<Uint8Array> =>
	new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

const toHex = (bytes: Uint8Array) => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');

/** ISO 8601 sin milisegundos y con zona explícita (como pide la doc). */
export const isoNoMs = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, '+00:00');

/**
 * tranKey = Base64( SHA-256( nonce + seed + secretKey ) ) — el SHA en binario,
 * con el nonce CRUDO; lo que viaja en "nonce" es Base64(nonce). Vale 5 minutos.
 */
export async function ptpAuth() {
	const raw = toHex(crypto.getRandomValues(new Uint8Array(12)));
	const seed = isoNoMs(new Date());
	const tranKey = toB64(await sha256(raw + seed + SECRET_KEY));
	return { login: LOGIN, tranKey, nonce: btoa(raw), seed };
}

/* ------------------------------------------------------------------------ */
/*  API                                                                      */
/* ------------------------------------------------------------------------ */

export class PtpError extends Error {
	constructor(message: string, public httpStatus: number, public body: any) {
		super(message);
	}
}

async function ptpPost(path: string, body: Record<string, unknown>): Promise<any> {
	if (!ptpConfigured()) throw new PtpError('Placetopay no está configurado (faltan secrets PTP_*)', 0, null);
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), 25_000);
	try {
		const r = await fetch(`${BASE_URL}${path}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify({ auth: await ptpAuth(), ...body }),
			signal: ctrl.signal,
		});
		const text = await r.text();
		let json: any = null;
		try { json = JSON.parse(text); } catch { /* respuesta no JSON */ }
		if (!r.ok || !json) {
			const msg = json?.status?.message ?? text.slice(0, 300);
			throw new PtpError(`Placetopay ${path} ${r.status}: ${msg}`, r.status, json ?? text.slice(0, 500));
		}
		return json;
	} finally {
		clearTimeout(timer);
	}
}

export interface CreateSessionInput {
	reference: string;
	description: string;
	currency: string;
	total: number;
	expiration: string;
	returnUrl: string;
	ipAddress: string;
	userAgent: string;
	buyer?: Record<string, unknown>;
	/** Productos (se muestran en la página de pago si Placetopay los muestra). */
	items?: Array<{ sku: string; name: string; category: 'physical'; qty: number; price: number }>;
}

export async function ptpCreateSession(i: CreateSessionInput): Promise<{ requestId: number; processUrl: string }> {
	const json = await ptpPost('/api/session', {
		locale: 'es_UY',
		buyer: i.buyer,
		payment: {
			reference: i.reference,
			description: i.description,
			amount: { currency: i.currency, total: i.total },
			allowPartial: false,
			...(i.items && i.items.length ? { items: i.items } : {}),
		},
		expiration: i.expiration,
		returnUrl: i.returnUrl,
		cancelUrl: i.returnUrl,
		ipAddress: i.ipAddress,
		userAgent: i.userAgent,
	});
	if (json?.status?.status !== 'OK' || !json.requestId || !json.processUrl) {
		throw new PtpError(`Placetopay no creó la sesión: ${json?.status?.message ?? 'sin detalle'}`, 200, json);
	}
	return { requestId: Number(json.requestId), processUrl: String(json.processUrl) };
}

export const ptpGetSession = (requestId: number) => ptpPost(`/api/session/${requestId}`, {});

/** Reembolso total de una transacción aprobada. */
export const ptpReverse = (internalReference: number) =>
	ptpPost('/api/transaction', { internalReference, action: 'reverse' });

/* ------------------------------------------------------------------------ */
/*  Firma del aviso (webhook)                                                */
/* ------------------------------------------------------------------------ */

/**
 * firma = SHA-256(requestId + status.status + status.date + secretKey), con
 * prefijo "sha256:". Sin prefijo es el formato viejo (SHA-1), que la doc todavía
 * contempla mientras el sitio no tenga activado SHA-256.
 */
export async function ptpValidSignature(n: any): Promise<boolean> {
	const sig = String(n?.signature ?? '');
	const data = `${n?.requestId ?? ''}${n?.status?.status ?? ''}${n?.status?.date ?? ''}${SECRET_KEY}`;
	if (!sig || !SECRET_KEY) return false;
	let expected: string;
	let received: string;
	if (sig.startsWith('sha256:')) {
		received = sig.slice(7).toLowerCase();
		expected = toHex(await sha256(data));
	} else {
		received = sig.toLowerCase();
		expected = toHex(new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(data))));
	}
	if (received.length !== expected.length) return false;
	let diff = 0;
	for (let k = 0; k < expected.length; k++) diff |= expected.charCodeAt(k) ^ received.charCodeAt(k);
	return diff === 0;
}

/* ------------------------------------------------------------------------ */
/*  Aplicar el estado de la sesión a la orden                                */
/* ------------------------------------------------------------------------ */

// Estados finales SIN pago: la orden se cae.
const FINAL_UNPAID = new Set(['REJECTED', 'PARTIAL_EXPIRED']);

const field = (p: any, key: string) =>
	(p?.processorFields ?? []).find((f: any) => f?.keyword === key)?.value ?? null;

export interface SyncResult {
	order_id: number | null;
	session_status: string;
	order_changed?: boolean;
	note?: string;
}

/**
 * Consulta la sesión a Placetopay, guarda lo que devuelve y aplica el resultado
 * a la orden. Idempotente: se puede llamar las veces que haga falta.
 */
export async function syncSession(supabase: any, requestId: number): Promise<SyncResult> {
	const { data: row } = await supabase
		.from('placetopay_sessions')
		.select('id, order_id, currency, amount, status, amount_mismatch')
		.eq('request_id', requestId)
		.maybeSingle();
	if (!row) return { order_id: null, session_status: 'UNKNOWN', note: 'sesión que no es nuestra' };

	const info = await ptpGetSession(requestId);
	const st = String(info?.status?.status ?? 'PENDING');
	const payments: any[] = Array.isArray(info?.payment) ? info.payment : [];
	// Una transacción aprobada y después reembolsada (desde el panel o con el
	// botón) ya no cuenta como pago.
	const approved = payments.find(p => p?.status?.status === 'APPROVED' && p?.refunded !== true) ?? null;
	const refundedApproved = payments.some(p => p?.status?.status === 'APPROVED' && p?.refunded === true);
	const shown = approved ?? payments[payments.length - 1] ?? null;

	// ¿Cobró exactamente lo que pedimos? (moneda y monto)
	const from = approved?.amount?.from ?? null;
	const paidCurrency = from?.currency ?? null;
	const paidAmount = from?.total != null ? Number(from.total) : null;
	const mismatch = !!approved && (paidCurrency !== row.currency || paidAmount === null || Math.abs(paidAmount - Number(row.amount)) > 0.01);

	await supabase.from('placetopay_sessions').update({
		status: st,
		reason: info?.status?.reason != null ? String(info.status.reason) : null,
		message: info?.status?.message ?? null,
		status_date: info?.status?.date ?? null,
		internal_reference: shown?.internalReference != null ? Number(shown.internalReference) : null,
		authorization_code: shown?.authorization ?? null,
		receipt: shown?.receipt != null ? String(shown.receipt) : null,
		franchise: shown?.franchise ?? null,
		payment_method_name: shown?.paymentMethodName ?? null,
		issuer_name: shown?.issuerName ?? null,
		last_digits: field(shown, 'lastDigits'),
		paid_amount: approved ? paidAmount : null,
		paid_currency: approved ? paidCurrency : null,
		amount_mismatch: mismatch,
		raw: info,
		...(refundedApproved && !approved ? { refunded: true } : {}),
		last_checked_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
	})
		.eq('id', row.id)
		// Una consulta lenta que vuelve con PENDING no pisa un estado final que
		// ya guardó otra (aviso y página de gracias pueden cruzarse).
		.in('status', st === 'PENDING' ? ['PENDING'] : ['PENDING', st]);

	const orderId = Number(row.order_id);

	if (st === 'APPROVED' && approved) {
		if (mismatch) {
			// No se da por paga una orden con un cobro distinto: lo mira una persona.
			// (Se avisa una sola vez, no en cada consulta.)
			if (!row.amount_mismatch) await alertAdmin(
				`Pedido #${orderId}: Placetopay cobró un monto distinto`,
				`Se pidió ${row.currency} ${row.amount} y la transacción aprobada es de ${paidCurrency} ${paidAmount} (sesión ${requestId}). La orden NO se marcó pagada: revisala en el panel de Getnet.`,
			);
			return { order_id: orderId, session_status: st, order_changed: false, note: 'amount_mismatch' };
		}
		const { data: res, error } = await supabase.rpc('ptp_mark_order_paid', { p_order_id: orderId });
		if (error) throw new Error(`ptp_mark_order_paid: ${error.message}`);
		if (res?.changed) {
			const faltantes = res?.faltantes ?? [];
			if (Array.isArray(faltantes) && faltantes.length > 0) {
				await alertAdmin(
					`Pedido #${orderId}: cobrado sin stock suficiente`,
					`El pago con tarjeta (Getnet) entró pero faltó stock: ${faltantes.map((f: any) => `${f.producto ?? f.codigo} (pidió ${f.pedido}, había ${f.habia})`).join('; ')}. Hay que conseguirlo, ofrecer reemplazo o devolver esa parte.`,
				);
			}
			if (res?.late) {
				await alertAdmin(
					`Pedido #${orderId}: pago con tarjeta aprobado tarde`,
					`El pedido estaba "${res.previous_status}" y Getnet aprobó el pago después. Ya quedó Concretado y se descontó el stock; revisalo.`,
				);
			}
			await sendConfirmationMail(orderId);
		}
		return { order_id: orderId, session_status: st, order_changed: !!res?.changed };
	}

	if (st === 'APPROVED') {
		// Sesión aprobada sin transacción aprobada vigente: o se reembolsó, o es
		// un caso raro. No se rechaza la orden (podría haber plata): se avisa.
		if (!refundedApproved) {
			await alertAdmin(
				`Pedido #${orderId}: sesión de Getnet aprobada sin pago`,
				`La sesión ${requestId} figura APPROVED pero no tiene una transacción aprobada. No se tocó la orden; revisala en el panel de Getnet.`,
			);
		}
		return { order_id: orderId, session_status: st, order_changed: false, note: refundedApproved ? 'refunded' : 'approved_without_payment' };
	}

	if (FINAL_UNPAID.has(st)) {
		// Rechazada / vencida sin pago: la orden se cae (si sigue pendiente).
		const { data: released } = await supabase.rpc('release_order_stock', { p_order_id: orderId, p_new_status: 'rechazado' });
		return { order_id: orderId, session_status: st, order_changed: released === true };
	}

	return { order_id: orderId, session_status: st, order_changed: false };
}

/* ------------------------------------------------------------------------ */
/*  Avisos                                                                   */
/* ------------------------------------------------------------------------ */

async function sendConfirmationMail(orderId: number): Promise<void> {
	const url = Deno.env.get('SUPABASE_URL')!;
	const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
	try {
		const r = await fetch(`${url}/functions/v1/send-order-confirmation`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, apikey: key },
			body: JSON.stringify({ order_id: orderId }),
		});
		if (!r.ok) console.warn(`[placetopay] send-order-confirmation ${r.status}: ${(await r.text()).slice(0, 300)}`);
	} catch (e) {
		console.warn('[placetopay] sendConfirmationMail:', e);
	}
}

export async function alertAdmin(subject: string, text: string): Promise<void> {
	console.error(`[placetopay] ${subject} — ${text}`);
	const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
	const ADMIN_EMAIL = Deno.env.get('ADMIN_EMAIL') ?? 'ventas@rfstore.uy';
	const FROM = Deno.env.get('RESEND_FROM') ?? 'RF Store <ventas@send.rfstore.uy>';
	if (!RESEND_API_KEY) return;
	const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
	try {
		await fetch('https://api.resend.com/emails', {
			method: 'POST',
			headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				from: FROM,
				to: [ADMIN_EMAIL],
				subject,
				html: `<div style="font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;max-width:560px">
					<img src="https://www.rfstore.uy/img/img-docs/logoblancorf.jpg" width="46" height="46" alt="RF Store" style="display:block;border:0;margin:0 0 18px">
					<p style="background:#fef2f2;border-left:4px solid #dc2626;padding:12px 14px;margin:0">${esc(text)}</p>
				</div>`,
			}),
		});
	} catch (e) {
		console.warn('[placetopay] alertAdmin:', e);
	}
}
