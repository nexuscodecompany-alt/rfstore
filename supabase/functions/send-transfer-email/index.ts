// deno-lint-ignore-file no-explicit-any
// send-transfer-email v19
// Mails de los pagos manuales (transferencia / depósito / combinado):
//   kind='instructions'   -> datos para pagar al CLIENTE + aviso al ADMIN
//   kind='proof_uploaded' -> el cliente subió el comprobante -> sólo ADMIN
//
// v19 (2026-08-20):
//  - PAGO COMBINADO (payment_method='hybrid'): el monto a transferir es SÓLO la
//    parte que va por banco, no el total. Se avisa en los dos mails —cliente y
//    admin— que el pedido se procesa cuando estén acreditadas las dos partes.
//  - FACTURA CON RUT: si el cliente la pidió, los datos fiscales van en el mail
//    al admin (que es quien la emite) y confirmados en el del cliente.
//
// v18 (2026-08-11):
//  - DESGLOSE: subtotal + envío + descuento + total. Antes el mail listaba los
//    items y abajo un total; si había costo de envío los números no cerraban, y
//    si el envío era al interior (DAC) el total quedaba igual al subtotal y se
//    leía como "envío gratis" (pasó con la orden #210, Artigas).
//  - LÍNEA DE ENVÍO con la zona y quién lo paga. Interior = por DAC, lo abona el
//    cliente al retirar en la agencia, NO está incluido en el total.
//  - La cotización sale de la orden (fx_rate congelado al comprar). Sólo si la
//    orden no la tiene se pide en vivo. Antes el mail pedía la cotización del
//    momento y podía mostrar otro número que el que vio el cliente al comprar.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'pedidos@rfstore.uy';
const ADMIN_EMAIL = Deno.env.get('ADMIN_EMAIL') ?? '';
const SALES_EMAIL = 'ventas@rfstore.uy';
const SALES_WHATSAPP_LABEL = '094 116 299';
const SALES_WHATSAPP_LINK = '59894116299';
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://rfstore.uy';

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE, {
	auth: { persistSession: false, autoRefreshToken: false },
});

function escapeHtml(s: string): string {
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/** Espejo de helpers/shippingSummary del front. Si cambia una, cambia la otra. */
function shippingSummary(zone: string | null, barrio: string | null, dept: string | null, costUsd: number) {
	const z = zone ?? null;
	const zoneLabel =
		z === 'montevideo' ? `Montevideo${barrio ? ` — ${barrio}` : ''}` :
		z === 'metropolitana' ? `Zona metropolitana (agencia)${barrio ? ` — ${barrio}` : ''}` :
		z === 'interior' ? `Interior${dept ? ` — ${dept}` : ''}` : '';
	if (z === 'interior') {
		return {
			zoneLabel,
			amountLabel: 'Lo abonás en la agencia',
			note: 'El envío al interior va por DAC y lo abonás al retirar en la agencia: NO está incluido en este total.',
			included: false,
		};
	}
	if (costUsd > 0) {
		return {
			zoneLabel,
			amountLabel: `USD ${costUsd.toFixed(2)}`,
			note: z === 'metropolitana' ? 'Llega por agencia a domicilio.' : '',
			included: true,
		};
	}
	return {
		zoneLabel,
		amountLabel: z ? 'Gratis' : 'A coordinar',
		note: z === 'montevideo' ? 'Envío bonificado por el monto de tu compra.' : '',
		included: true,
	};
}

interface TransferInfo {
	banco?: string;
	titular?: string;
	rut?: string;
	moneda?: string;
	cuenta?: string;
	cuenta_santander?: string;
	sucursal_santander?: string;
	cuenta_externa?: string;
}
interface DepositInfo {
	abitab?: string;
	redpagos?: string;
	instrucciones?: string;
}

interface ShippingCtx {
	zone: string | null;
	barrio: string | null;
	department: string | null;
	costUsd: number;
	discountUsd: number;
	couponCode: string | null;
}

/**
 * Pago combinado: una parte por MercadoPago y otra por transferencia. Cambia el
 * monto a transferir (no es el total) y hay que dejar MUY claro que el pedido no
 * se despacha hasta que entren las dos partes.
 */
interface HybridCtx {
	mpUsd: number;
	transferUsd: number;
}

/** Datos fiscales, cuando el cliente pidió factura con RUT. */
interface InvoiceCtx {
	rut: string;
	businessName: string;
	tradeName: string | null;
	address: string;
	city: string | null;
	state: string | null;
	email: string | null;
}

/** Filas (label, valor) del bloque de datos de pago según el método. */
function paymentRows(
	method: 'transfer' | 'deposit',
	transfer: TransferInfo,
	deposit: DepositInfo
): Array<[string, string]> {
	const rows: Array<[string, string]> = [];
	if (method === 'transfer') {
		// OJO: la clave `cuenta` quedó vacía en producción; el número real vive en
		// cuenta_santander / cuenta_externa. Si tomáramos sólo `cuenta`, el mail
		// salía con "Cuenta: —" y el cliente no podía pagar.
		const cuenta = transfer.cuenta || transfer.cuenta_santander || transfer.cuenta_externa;
		if (transfer.banco) rows.push(['Banco', transfer.banco]);
		if (cuenta) rows.push(['Cuenta', cuenta]);
		if (transfer.sucursal_santander) rows.push(['Sucursal', transfer.sucursal_santander]);
		if (transfer.cuenta_externa && transfer.cuenta_externa !== cuenta) {
			rows.push(['Desde otro banco', transfer.cuenta_externa]);
		}
		if (transfer.titular) rows.push(['Titular', transfer.titular]);
		if (transfer.rut) rows.push(['RUT', transfer.rut]);
		if (transfer.moneda) rows.push(['Moneda', transfer.moneda]);
	} else {
		if (deposit.abitab) rows.push(['Abitab', deposit.abitab]);
		if (deposit.redpagos) rows.push(['Redpagos', deposit.redpagos]);
	}
	return rows;
}

function renderEmail(opts: {
	orderId: number;
	method: 'transfer' | 'deposit';
	customerName: string;
	totalUsd: number;
	totalUyu: number | null;
	transfer: TransferInfo;
	deposit: DepositInfo;
	items: Array<{ name: string; quantity: number; price: number }>;
	shipping: ShippingCtx;
	hybrid: HybridCtx | null;
	invoice: InvoiceCtx | null;
}): { subject: string; html: string; text: string } {
	const { orderId, method, customerName, totalUsd, totalUyu, transfer, deposit, items, shipping, hybrid, invoice } = opts;
	const isDeposit = method === 'deposit';
	const subject = hybrid
		? `Pago combinado — Pedido #${orderId} — RF Store`
		: isDeposit
		? `Datos para tu depósito (Abitab / Redpagos) — Pedido #${orderId} — RF Store`
		: `Datos para tu transferencia — Pedido #${orderId} — RF Store`;
	const safeName = escapeHtml(customerName || 'Cliente');
	const totalUsdLabel = `USD ${totalUsd.toFixed(0)}`;
	const totalUyuLabel = totalUyu !== null
		? `≈ UYU ${totalUyu.toLocaleString('es-UY')} (al BROU)`
		: '';

	// En el pago combinado, el monto del bloque bancario es SÓLO la parte que va
	// por transferencia. Mostrar el total ahí haría que el cliente transfiera de más.
	const montoBancario = hybrid ? hybrid.transferUsd : totalUsd;
	const montoBancarioLabel = `USD ${montoBancario.toFixed(2)}`;
	const montoLine = !hybrid && totalUyu !== null
		? `${totalUsdLabel} <span style="color:#666;font-weight:400;">${totalUyuLabel}</span>`
		: montoBancarioLabel;

	const subtotal = items.reduce((acc, it) => acc + it.price * it.quantity, 0);
	const ship = shippingSummary(shipping.zone, shipping.barrio, shipping.department, shipping.costUsd);

	const itemsHtml = items
		.map(
			it => `<tr><td style="padding:8px 0;">${escapeHtml(it.name)} <span style="color:#888">x${it.quantity}</span></td><td style="padding:8px 0;text-align:right;font-weight:600;">USD ${(it.price * it.quantity).toFixed(0)}</td></tr>`
		)
		.join('');

	// Desglose: sin esto los items no sumaban el total y no se aclaraba el envío.
	const sumRow = (label: string, value: string, strong = false) =>
		`<tr><td style="padding:4px 0;color:${strong ? '#111' : '#666'};font-weight:${strong ? 700 : 400};">${escapeHtml(label)}</td><td style="padding:4px 0;text-align:right;color:${strong ? '#111' : '#444'};font-weight:${strong ? 700 : 600};">${escapeHtml(value)}</td></tr>`;
	const breakdownHtml = [
		sumRow('Subtotal productos', `USD ${subtotal.toFixed(0)}`),
		sumRow(`Envío${ship.zoneLabel ? ` (${ship.zoneLabel})` : ''}`, ship.amountLabel),
		shipping.discountUsd > 0
			? sumRow(`Descuento${shipping.couponCode ? ` (${shipping.couponCode})` : ''}`, `- USD ${shipping.discountUsd.toFixed(0)}`)
			: '',
		sumRow('Total del pedido', totalUsdLabel, true),
		hybrid ? sumRow('  · Con MercadoPago', `USD ${hybrid.mpUsd.toFixed(2)}`) : '',
		hybrid ? sumRow('  · Por transferencia', `USD ${hybrid.transferUsd.toFixed(2)}`) : '',
	].join('');
	const shipNoteHtml = ship.note
		? `<p style="margin:8px 0 0;color:#92400e;background:#fef3c7;border-radius:6px;padding:8px 10px;font-size:13px;line-height:1.5;">${escapeHtml(ship.note)}</p>`
		: '';

	// Aviso del pago combinado: es la parte que evita el malentendido de "ya pagué".
	const hybridNoticeHtml = hybrid
		? `<table width="100%" cellpadding="0" cellspacing="0" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;margin-bottom:24px;">
        <tr><td style="padding:14px 16px;color:#1e3a8a;font-size:13.5px;line-height:1.6;">
          <b>Tu pedido es con pago combinado.</b><br>
          Vas a abonar <b>USD ${hybrid.mpUsd.toFixed(2)}</b> con MercadoPago y
          <b>USD ${hybrid.transferUsd.toFixed(2)}</b> por transferencia bancaria.<br><br>
          <b>El pedido se procesa una vez acreditados los dos pagos.</b><br>
          Te lo reservamos por <b>24 horas</b>: si en ese plazo no entran las dos partes,
          la reserva se libera y el pedido queda sin efecto.
        </td></tr>
      </table>`
		: '';

	const invoiceHtml = invoice
		? `<h2 style="margin:24px 0 12px;font-size:14px;text-transform:uppercase;color:#111;letter-spacing:0.5px;">Factura</h2>
       <p style="margin:0 0 24px;color:#444;line-height:1.6;">Vamos a emitir la factura a nombre de <b>${escapeHtml(invoice.businessName)}</b> (RUT ${escapeHtml(invoice.rut)})${invoice.email ? ` y te la enviamos a <b>${escapeHtml(invoice.email)}</b>` : ''}.</p>`
		: '';

	const row = (label: string, value: string) =>
		`<tr><td style="padding:6px 12px;color:#666;">${escapeHtml(label)}</td><td style="padding:6px 12px;font-weight:600;color:#111;">${escapeHtml(value)}</td></tr>`;

	const rows = paymentRows(method, transfer, deposit);
	const dataRowsHtml =
		rows.map(([l, v]) => row(l, v)).join('') ||
		row('Datos', 'Te los pasamos por WhatsApp');

	const bloqueTitulo = hybrid
		? 'Datos para la parte que va por transferencia'
		: isDeposit
		? 'Dónde depositar'
		: 'Datos para transferir';
	const introAccion = hybrid
		? 'Te dejamos los datos para la <b>parte que abonás por transferencia</b>. La parte con tarjeta la pagás desde MercadoPago.'
		: isDeposit
		? 'Te dejamos los datos para que hagas el <b>depósito en Abitab o Redpagos</b>.'
		: 'Te dejamos los datos para que hagas la <b>transferencia bancaria</b>.';
	const instruccionesHtml =
		isDeposit && deposit.instrucciones
			? `<p style="margin:0 0 24px;color:#444;line-height:1.6;white-space:pre-line;">${escapeHtml(deposit.instrucciones)}</p>`
			: '';

	const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
      <tr><td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:600px;">
          <tr><td style="padding:24px 32px;background:#111;color:#fff;">
            <h1 style="margin:0;font-size:20px;">RF Store</h1>
          </td></tr>
          <tr><td style="padding:32px;">
            <p style="margin:0 0 8px;font-size:16px;">¡Gracias por tu compra, ${safeName}!</p>
            <p style="margin:0 0 24px;color:#555;line-height:1.5;">Recibimos tu pedido <b>#${orderId}</b>. ${introAccion} Una vez recibido el pago, vas a poder ver el estado actualizado en tu cuenta y te avisaremos por mail.</p>

            ${hybridNoticeHtml}

            <h2 style="margin:0 0 12px;font-size:14px;text-transform:uppercase;color:#111;letter-spacing:0.5px;">${bloqueTitulo}</h2>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:24px;">
              ${dataRowsHtml}
              <tr><td style="padding:6px 12px;color:#666;">Monto</td><td style="padding:6px 12px;font-weight:600;color:#111;">${montoLine}</td></tr>
              ${row('Concepto', `Pedido ${orderId}`)}
            </table>
            ${instruccionesHtml}

            <h2 style="margin:0 0 12px;font-size:14px;text-transform:uppercase;color:#111;letter-spacing:0.5px;">Detalle del pedido</h2>
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:8px;">
              ${itemsHtml}
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-top:1px solid #e5e7eb;padding-top:8px;margin-bottom:4px;font-size:14px;">
              ${breakdownHtml}
            </table>
            ${totalUyu !== null ? `<p style="margin:4px 0 0;text-align:right;color:#666;font-size:12px;">${escapeHtml(totalUyuLabel)}</p>` : ''}
            ${shipNoteHtml}
            ${invoiceHtml}

            <h2 style="margin:24px 0 12px;font-size:14px;text-transform:uppercase;color:#111;letter-spacing:0.5px;">Cómo nos hacés llegar el comprobante</h2>
            <p style="margin:0 0 8px;color:#444;line-height:1.6;">Elegí la opción que más te convenga:</p>
            <ul style="margin:0 0 16px;padding-left:18px;color:#444;line-height:1.7;">
              <li>Subiendo el archivo desde la página de tu pedido: <a href="${SITE_URL}/checkout/${orderId}/thank-you?status=pending" style="color:#0a7a4a;">ver mi pedido</a></li>
              <li>Por mail a <a href="mailto:${SALES_EMAIL}?subject=Comprobante Pedido %23${orderId}" style="color:#0a7a4a;">${SALES_EMAIL}</a></li>
              <li>Por WhatsApp al <a href="https://wa.me/${SALES_WHATSAPP_LINK}?text=Comprobante%20Pedido%20%23${orderId}" style="color:#0a7a4a;">${SALES_WHATSAPP_LABEL}</a></li>
            </ul>
            <p style="margin:0 0 24px;color:#444;line-height:1.6;">En cuanto verifiquemos el pago, despachamos tu pedido y te avisamos.</p>
          </td></tr>
          <tr><td style="padding:20px 32px;background:#f4f4f5;color:#666;font-size:12px;text-align:center;">RF Store — RUT 220006580014<br/>Si tenes dudas, respondé este mail.</td></tr>
        </table>
      </td></tr>
    </table></body></html>`;

	const totalTextLine = totalUyu !== null
		? `${totalUsdLabel} (≈ UYU ${totalUyu.toLocaleString('es-UY')} al BROU)`
		: totalUsdLabel;
	const rowsText = rows.map(([l, v]) => `${l}: ${v}`).join('\n');
	const hybridText = hybrid
		? `\nPAGO COMBINADO\nCon MercadoPago: USD ${hybrid.mpUsd.toFixed(2)}\nPor transferencia: USD ${hybrid.transferUsd.toFixed(2)}\nEl pedido se procesa una vez acreditados los dos pagos.\nTe lo reservamos por 24 horas.\n`
		: '';
	const invoiceText = invoice
		? `\nFactura a nombre de ${invoice.businessName} (RUT ${invoice.rut})${invoice.email ? ` — se envia a ${invoice.email}` : ''}\n`
		: '';
	const text = `Gracias por tu compra, ${customerName || 'Cliente'}!\n\nPedido #${orderId}\nSubtotal productos: USD ${subtotal.toFixed(0)}\nEnvio${ship.zoneLabel ? ` (${ship.zoneLabel})` : ''}: ${ship.amountLabel}\n${shipping.discountUsd > 0 ? `Descuento${shipping.couponCode ? ` (${shipping.couponCode})` : ''}: - USD ${shipping.discountUsd.toFixed(0)}\n` : ''}Total del pedido: ${totalTextLine}\n${hybridText}${ship.note ? `\n${ship.note}\n` : ''}\n${bloqueTitulo}:\n${rowsText}\nMonto: ${montoBancarioLabel}\nConcepto: Pedido ${orderId}\n${isDeposit && deposit.instrucciones ? `\n${deposit.instrucciones}\n` : ''}${invoiceText}\nDespues de pagar, mandanos el comprobante por:\n- Web: ${SITE_URL}/checkout/${orderId}/thank-you?status=pending\n- Mail: ${SALES_EMAIL}\n- WhatsApp: ${SALES_WHATSAPP_LABEL}`;

	return { subject, html, text };
}

/** Aviso al ADMIN de que el cliente subió el comprobante de pago. */
function renderProofEmail(opts: {
	orderId: number;
	method: 'transfer' | 'deposit';
	customerName: string;
	customerEmail: string;
	totalUsd: number;
}): { subject: string; html: string; text: string } {
	const { orderId, method, customerName, customerEmail, totalUsd } = opts;
	const metodo = method === 'deposit' ? 'Depósito (Abitab / Redpagos)' : 'Transferencia bancaria';
	const subject = `📎 Comprobante subido — Pedido #${orderId} — USD ${totalUsd.toFixed(0)}`;
	const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;"><tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:600px;">
        <tr><td style="padding:20px 28px;background:#0ea5e9;color:#fff;">
          <h1 style="margin:0;font-size:18px;">📎 Comprobante subido — Pedido #${orderId}</h1>
          <p style="margin:4px 0 0;opacity:0.95;font-size:13px;">${escapeHtml(metodo)} — USD ${totalUsd.toFixed(0)}</p>
        </td></tr>
        <tr><td style="padding:24px 28px;">
          <p style="margin:0 0 16px;color:#444;line-height:1.6;">${escapeHtml(customerName || 'El cliente')} (<a href="mailto:${escapeHtml(customerEmail)}" style="color:#0ea5e9;">${escapeHtml(customerEmail)}</a>) subió el comprobante de pago. Revisalo y aprobá el pago para que salga la confirmación al cliente.</p>
          <div style="text-align:center;">
            <a href="${SITE_URL}/dashboard/ordenes/${orderId}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:600;">Ver comprobante en el dashboard →</a>
          </div>
        </td></tr>
        <tr><td style="padding:14px 28px;background:#f4f4f5;color:#888;font-size:11px;text-align:center;">RF Store — Notificación automática</td></tr>
      </table>
    </td></tr></table></body></html>`;
	const text = `Comprobante subido — Pedido #${orderId} (${metodo}, USD ${totalUsd.toFixed(0)})\n\n${customerName || 'El cliente'} (${customerEmail}) subió el comprobante.\n\nVer pedido: ${SITE_URL}/dashboard/ordenes/${orderId}`;
	return { subject, html, text };
}

/** Aviso al ADMIN de que entró un pedido esperando pago manual. */
function renderAdminEmail(opts: {
	orderId: number;
	method: 'transfer' | 'deposit';
	customerName: string;
	customerEmail: string;
	totalUsd: number;
	totalUyu: number | null;
	items: Array<{ name: string; quantity: number; price: number }>;
	shipping: ShippingCtx;
	hybrid: HybridCtx | null;
	invoice: InvoiceCtx | null;
}): { subject: string; html: string; text: string } {
	const { orderId, method, customerName, customerEmail, totalUsd, totalUyu, items, shipping, hybrid, invoice } = opts;
	const metodo = hybrid
		? 'PAGO COMBINADO (MercadoPago + transferencia)'
		: method === 'deposit'
		? 'Depósito (Abitab / Redpagos)'
		: 'Transferencia bancaria';
	const totalLabel = `USD ${totalUsd.toFixed(0)}${totalUyu !== null ? ` (≈ UYU ${totalUyu.toLocaleString('es-UY')})` : ''}`;
	const ship = shippingSummary(shipping.zone, shipping.barrio, shipping.department, shipping.costUsd);
	const subject = hybrid
		? `⚠️ Pedido #${orderId} PAGO COMBINADO — no despachar hasta cobrar las 2 partes — USD ${totalUsd.toFixed(0)}`
		: `🕒 Pedido #${orderId} esperando pago — ${metodo} — USD ${totalUsd.toFixed(0)}`;
	const itemsHtml = items
		.map(
			it =>
				`<tr><td style="padding:6px 0;">${escapeHtml(it.name)} <span style="color:#888">x${it.quantity}</span></td><td style="padding:6px 0;text-align:right;font-weight:600;">USD ${(it.price * it.quantity).toFixed(0)}</td></tr>`
		)
		.join('');

	// Lo primero que tiene que ver el admin en un pedido combinado: que NO se
	// despacha con una sola de las dos partes cobrada.
	const hybridBlock = hybrid
		? `<table width="100%" cellpadding="0" cellspacing="0" style="background:#fef2f2;border:2px solid #fca5a5;border-radius:8px;margin-bottom:18px;">
        <tr><td style="padding:14px 16px;color:#7f1d1d;font-size:13.5px;line-height:1.6;">
          <b>ATENCIÓN: este pedido se paga en DOS partes.</b><br>
          • MercadoPago: <b>USD ${hybrid.mpUsd.toFixed(2)}</b><br>
          • Transferencia: <b>USD ${hybrid.transferUsd.toFixed(2)}</b><br><br>
          El pedido queda en <b>Pendiente</b> y NO se despacha hasta que estén acreditadas
          las dos. Cuando entre la transferencia, confirmala en el panel: si con eso se
          cubre el total, el pedido pasa solo a Concretado.<br><br>
          <b>Reserva por 24 h:</b> si no entran las dos partes en ese plazo, el sistema
          libera el stock y el pedido vence. Si el cliente ya pagó una parte, NO se libera
          solo: hay que resolverlo a mano.
        </td></tr>
      </table>`
		: '';

	const invoiceBlock = invoice
		? `<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:8px;margin:16px 0;">
        <tr><td style="padding:14px 16px;color:#4c1d95;font-size:13px;line-height:1.7;">
          <b>🧾 PIDE FACTURA CON RUT</b><br>
          RUT: <b>${escapeHtml(invoice.rut)}</b><br>
          Razón social: <b>${escapeHtml(invoice.businessName)}</b><br>
          ${invoice.tradeName ? `Nombre comercial: ${escapeHtml(invoice.tradeName)}<br>` : ''}
          Domicilio fiscal: ${escapeHtml(invoice.address)}<br>
          ${invoice.city || invoice.state ? `${escapeHtml([invoice.city, invoice.state].filter(Boolean).join(', '))}<br>` : ''}
          ${invoice.email ? `Enviar factura a: <b>${escapeHtml(invoice.email)}</b>` : ''}
        </td></tr>
      </table>`
		: '';

	const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;"><tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:600px;">
        <tr><td style="padding:20px 28px;background:${hybrid ? '#dc2626' : '#f59e0b'};color:#fff;">
          <h1 style="margin:0;font-size:18px;">${hybrid ? '⚠️' : '🕒'} Pedido #${orderId} ${hybrid ? '— pago combinado' : 'esperando pago'}</h1>
          <p style="margin:4px 0 0;opacity:0.95;font-size:13px;">${escapeHtml(metodo)} — ${totalLabel}</p>
        </td></tr>
        <tr><td style="padding:24px 28px;">
          ${hybridBlock}
          <p style="margin:0 0 4px;font-size:13px;color:#666;">Cliente</p>
          <p style="margin:0 0 16px;font-weight:600;color:#111;">${escapeHtml(customerName || 'Sin nombre')} — <a href="mailto:${escapeHtml(customerEmail)}" style="color:#0ea5e9;">${escapeHtml(customerEmail)}</a></p>
          <p style="margin:0 0 4px;font-size:13px;color:#666;">Envío</p>
          <p style="margin:0 0 16px;font-weight:600;color:#111;">${escapeHtml(ship.zoneLabel || 'Sin definir')} — ${escapeHtml(ship.amountLabel)}</p>
          ${invoiceBlock}
          <p style="margin:0 0 6px;font-size:13px;color:#666;">Items</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;">${itemsHtml}
            <tr><td colspan="2" style="border-top:1px solid #e5e7eb;padding-top:10px;text-align:right;font-size:15px;font-weight:700;">Total: ${totalLabel}</td></tr>
          </table>
          <p style="margin:16px 0 0;color:#555;font-size:13px;line-height:1.6;">Ya le mandamos al cliente los datos para pagar. Cuando llegue el comprobante, aprobá el pago en el panel.</p>
          <div style="margin-top:20px;text-align:center;">
            <a href="${SITE_URL}/dashboard/ordenes/${orderId}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:600;">Ver pedido en el dashboard →</a>
          </div>
        </td></tr>
        <tr><td style="padding:14px 28px;background:#f4f4f5;color:#888;font-size:11px;text-align:center;">RF Store — Notificación automática</td></tr>
      </table>
    </td></tr></table></body></html>`;
	const hybridText = hybrid
		? `\nATENCION: PAGO COMBINADO. MercadoPago USD ${hybrid.mpUsd.toFixed(2)} + Transferencia USD ${hybrid.transferUsd.toFixed(2)}.\nNO despachar hasta que esten acreditadas las dos partes.\n`
		: '';
	const invoiceText = invoice
		? `\nPIDE FACTURA CON RUT\nRUT: ${invoice.rut}\nRazon social: ${invoice.businessName}\nDomicilio: ${invoice.address}\n${invoice.email ? `Enviar a: ${invoice.email}\n` : ''}`
		: '';
	const text = `Pedido #${orderId} esperando pago (${metodo})\n${hybridText}\nCliente: ${customerName || 'Sin nombre'} (${customerEmail})\nEnvio: ${ship.zoneLabel || 'sin definir'} — ${ship.amountLabel}\nTotal: ${totalLabel}\n${invoiceText}\nItems:\n${items.map(it => `  - ${it.name} x${it.quantity} (USD ${(it.price * it.quantity).toFixed(0)})`).join('\n')}\n\nVer pedido: ${SITE_URL}/dashboard/ordenes/${orderId}`;
	return { subject, html, text };
}

async function sendViaResend(payload: {
	to: string;
	bcc?: string;
	subject: string;
	html: string;
	text: string;
}): Promise<{ id: string }> {
	if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY no configurado');
	const body: any = {
		from: `RF Store <${FROM_EMAIL}>`,
		to: [payload.to],
		subject: payload.subject,
		html: payload.html,
		text: payload.text,
	};
	if (payload.bcc) body.bcc = [payload.bcc];
	const r = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${RESEND_API_KEY}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body),
	});
	if (!r.ok) {
		const errText = await r.text();
		throw new Error(`Resend ${r.status}: ${errText.slice(0, 500)}`);
	}
	return await r.json();
}

Deno.serve(async req => {
	if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

	const authHeader = req.headers.get('Authorization') ?? '';
	const supabaseUser = createClient(SUPABASE_URL, ANON, {
		global: { headers: { Authorization: authHeader } },
		auth: { persistSession: false, autoRefreshToken: false },
	});

	try {
		const body = await req.json().catch(() => ({}));
		const orderId = Number(body.order_id);
		// 'instructions' (default) = datos para pagar al cliente + aviso al admin.
		// 'proof_uploaded'         = el cliente subió el comprobante -> sólo admin.
		const kind: 'instructions' | 'proof_uploaded' =
			body.kind === 'proof_uploaded' ? 'proof_uploaded' : 'instructions';
		if (!orderId) {
			return new Response(JSON.stringify({ error: 'order_id requerido' }), {
				status: 400,
				headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			});
		}

		const isServiceRoleCall = authHeader === `Bearer ${SERVICE_ROLE}`;
		let customer: { id: string; full_name: string | null; email: string | null } | null = null;
		let userEmail: string | null = null;
		let isAdminCall = isServiceRoleCall;

		if (isServiceRoleCall) {
			const { data: ord } = await supabaseAdmin
				.from('orders')
				.select('customer_id')
				.eq('id', orderId)
				.single();
			if (!ord) {
				return new Response(JSON.stringify({ error: 'orden no encontrada' }), {
					status: 404,
					headers: { ...corsHeaders, 'Content-Type': 'application/json' },
				});
			}
			const { data: c } = await supabaseAdmin
				.from('customers')
				.select('id, full_name, email')
				.eq('id', ord.customer_id)
				.single();
			customer = c as any;
		} else {
			const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
			if (userErr || !userData.user) {
				return new Response(JSON.stringify({ error: 'no autenticado' }), {
					status: 401,
					headers: { ...corsHeaders, 'Content-Type': 'application/json' },
				});
			}
			userEmail = userData.user.email ?? null;
			// Un admin logueado puede reenviar el mail de CUALQUIER orden desde el
			// panel; el resto sólo de las propias.
			const { data: role } = await supabaseAdmin
				.from('user_roles')
				.select('role')
				.eq('user_id', userData.user.id)
				.eq('role', 'admin')
				.maybeSingle();
			isAdminCall = !!role;
			const { data: c } = await supabaseAdmin
				.from('customers')
				.select('id, full_name, email')
				.eq('user_id', userData.user.id)
				.single();
			customer = c as any;
		}

		let orderQ = supabaseAdmin
			.from('orders')
			.select('id, total_amount, payment_method, customer_id, shipping_zone, shipping_barrio, shipping_department, shipping_cost_usd, discount_usd, coupon_code, fx_rate, total_original, payment_split, invoice_requested, invoice_rut, invoice_business_name, invoice_trade_name, invoice_address, invoice_city, invoice_state, invoice_email')
			.eq('id', orderId);
		if (!isAdminCall) {
			if (!customer) {
				return new Response(JSON.stringify({ error: 'cliente no encontrado' }), {
					status: 400,
					headers: { ...corsHeaders, 'Content-Type': 'application/json' },
				});
			}
			orderQ = orderQ.eq('customer_id', customer.id);
		}
		const { data: order, error: orderErr } = await orderQ.single();
		if (orderErr || !order) {
			return new Response(JSON.stringify({ error: 'orden no encontrada' }), {
				status: 404,
				headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			});
		}

		// El admin puede pedir el mail de una orden de otro cliente: en ese caso el
		// destinatario es el cliente DE LA ORDEN, no quien apretó el botón.
		if (isAdminCall && (!customer || customer.id !== order.customer_id)) {
			const { data: c } = await supabaseAdmin
				.from('customers')
				.select('id, full_name, email')
				.eq('id', order.customer_id)
				.single();
			customer = (c as any) ?? customer;
			userEmail = null;
		}
		if (!customer) {
			return new Response(JSON.stringify({ error: 'cliente no encontrado' }), {
				status: 400,
				headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			});
		}

		// Los métodos que necesitan que el cliente reciba dónde pagar: los dos
		// manuales y el combinado (que tiene una parte por transferencia).
		// MercadoPago puro no: ahí el cobro se hace en la pasarela.
		const rawMethod = order.payment_method as string | null;
		if (rawMethod !== 'transfer' && rawMethod !== 'deposit' && rawMethod !== 'hybrid') {
			return new Response(
				JSON.stringify({ error: 'la orden no es por transferencia, depósito ni pago combinado' }),
				{ status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
			);
		}
		// En el combinado, los datos que se muestran son los BANCARIOS.
		const method: 'transfer' | 'deposit' = rawMethod === 'deposit' ? 'deposit' : 'transfer';
		const hybrid: HybridCtx | null =
			rawMethod === 'hybrid'
				? {
						mpUsd: Number((order.payment_split as any)?.mercadopago) || 0,
						transferUsd: Number((order.payment_split as any)?.transfer) || 0,
				  }
				: null;

		const invoice: InvoiceCtx | null = order.invoice_requested
			? {
					rut: String(order.invoice_rut ?? ''),
					businessName: String(order.invoice_business_name ?? ''),
					tradeName: (order.invoice_trade_name as string | null) ?? null,
					address: String(order.invoice_address ?? ''),
					city: (order.invoice_city as string | null) ?? null,
					state: (order.invoice_state as string | null) ?? null,
					email: (order.invoice_email as string | null) ?? null,
			  }
			: null;

		// Comprobante subido: sólo avisamos al admin. Al cliente no le mandamos
		// nada (ya vio la confirmación en pantalla al subirlo).
		if (kind === 'proof_uploaded') {
			if (!ADMIN_EMAIL) {
				return new Response(
					JSON.stringify({ ok: true, skipped: 'ADMIN_EMAIL no seteado' }),
					{ status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
				);
			}
			const proofMail = renderProofEmail({
				orderId: order.id,
				method,
				customerName: customer.full_name || '',
				customerEmail: customer.email || '',
				totalUsd: Number(order.total_amount),
			});
			const proofRes = await sendViaResend({ to: ADMIN_EMAIL, ...proofMail });
			return new Response(
				JSON.stringify({ ok: true, kind, message_id: proofRes.id, sent_to: ADMIN_EMAIL }),
				{ status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
			);
		}

		const { data: itemsRaw } = await supabaseAdmin
			.from('order_items')
			.select('quantity, price, variants(products(name))')
			.eq('order_id', orderId);
		const items = (itemsRaw ?? []).map((it: any) => ({
			name: it.variants?.products?.name ?? 'Producto',
			quantity: it.quantity,
			price: Number(it.price),
		}));

		const { data: settings } = await supabaseAdmin
			.from('app_settings')
			.select('key, value')
			.in('key', ['payment_transfer_info', 'payment_deposit_info']);
		const settingsMap = new Map((settings ?? []).map((s: any) => [s.key, s.value]));
		const transfer = (settingsMap.get('payment_transfer_info') as TransferInfo) ?? {};
		const deposit = (settingsMap.get('payment_deposit_info') as DepositInfo) ?? {};

		const toEmail = customer.email || userEmail;
		if (!toEmail) {
			return new Response(JSON.stringify({ error: 'cliente sin email' }), {
				status: 400,
				headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			});
		}

		// Cotización: la CONGELADA en la orden (la que vio el cliente al comprar).
		// Sólo si la orden no la tiene (órdenes viejas) se pide en vivo.
		let totalUyu: number | null =
			order.total_original !== null && order.total_original !== undefined
				? Math.round(Number(order.total_original))
				: order.fx_rate
				? Math.round(Number(order.total_amount) * Number(order.fx_rate))
				: null;
		if (totalUyu === null) {
			try {
				const fxRes = await fetch(`${SUPABASE_URL}/functions/v1/get-fx-rate`, {
					headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
				});
				if (fxRes.ok) {
					const fx = await fxRes.json();
					if (fx?.rate > 0) {
						totalUyu = Math.round(Number(order.total_amount) * Number(fx.rate));
					}
				}
			} catch (fxErr) {
				console.warn('fx fetch failed:', fxErr);
			}
		}

		const shipping: ShippingCtx = {
			zone: (order.shipping_zone as string | null) ?? null,
			barrio: (order.shipping_barrio as string | null) ?? null,
			department: (order.shipping_department as string | null) ?? null,
			costUsd: Number(order.shipping_cost_usd ?? 0) || 0,
			discountUsd: Number(order.discount_usd ?? 0) || 0,
			couponCode: (order.coupon_code as string | null) ?? null,
		};

		const { subject, html, text } = renderEmail({
			orderId: order.id,
			method,
			customerName: customer.full_name || '',
			totalUsd: Number(order.total_amount),
			totalUyu,
			transfer,
			deposit,
			items,
			shipping,
			hybrid,
			invoice,
		});

		const result = await sendViaResend({ to: toEmail, subject, html, text });

		// Aviso al admin (mail propio, no BCC). Si falla, NO rompemos: el cliente ya
		// recibió sus datos de pago, que es lo crítico.
		let adminMessageId: string | null = null;
		let adminError: string | null = null;
		if (ADMIN_EMAIL) {
			try {
				const adminMail = renderAdminEmail({
					orderId: order.id,
					method,
					customerName: customer.full_name || '',
					customerEmail: toEmail,
					totalUsd: Number(order.total_amount),
					totalUyu,
					items,
					shipping,
					hybrid,
					invoice,
				});
				const adminRes = await sendViaResend({ to: ADMIN_EMAIL, ...adminMail });
				adminMessageId = adminRes.id;
			} catch (e) {
				adminError = e instanceof Error ? e.message : String(e);
				console.warn('[send-transfer-email] admin mail failed:', adminError);
			}
		}

		return new Response(
			JSON.stringify({
				ok: true,
				kind,
				message_id: result.id,
				sent_to: toEmail,
				method: rawMethod,
				hybrid: hybrid !== null,
				admin: ADMIN_EMAIL
					? { message_id: adminMessageId, sent_to: ADMIN_EMAIL, error: adminError }
					: { skipped: 'ADMIN_EMAIL no seteado' },
			}),
			{ status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
		);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return new Response(JSON.stringify({ error: msg }), {
			status: 500,
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		});
	}
});
