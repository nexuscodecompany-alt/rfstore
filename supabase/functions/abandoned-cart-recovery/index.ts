// deno-lint-ignore-file no-explicit-any
// abandoned-cart-recovery v1
//
// Le escribe a quien llegó al pago y no completó. Un mail por recordatorio, con
// un cupón PERSONAL y de un solo uso que vale SÓLO pagando por transferencia.
//
// Decisiones que importan:
//   - El mail NO dice de cuánto es el descuento. Se entera al entrar por el
//     enlace. Eso es lo que hace que el clic valga algo y evita que el número
//     circule por WhatsApp.
//   - Arranca APAGADO (app_settings.abandoned_cart_config.enabled = false). Sin
//     eso, cualquier deploy mandaría mails sin que nadie lo decidiera.
//   - Nunca le escribe a alguien que puede estar pagando AHORA: se excluye a
//     quien tenga una orden creada en los últimos minutos.
//
// Body opcional:
//   { dry_run: true }        -> calcula candidatos y NO manda nada (para probar)
//   { force: true }          -> ignora enabled y horario (para una prueba manual)
//   { only_lead_id }         -> procesa un solo lead
//   { preview: true, to }    -> manda los DOS avisos de ejemplo a una dirección,
//                               sin tocar leads ni cupones (para revisar el copy
//                               o medir en qué pestaña de Gmail caen)
//
// Env: RESEND_API_KEY, FROM_EMAIL, SITE_URL, SUPABASE_*
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'pedidos@rfstore.uy';
// Remitente: la marca, igual que el resto de los mails de la tienda.
// Probado: un remitente con nombre de persona ("Facundo de RF Store") NO cambia
// la pestaña en la que cae el mail, así que no vale la pena resignar la marca.
const FROM_NAME = Deno.env.get('ABANDONED_FROM_NAME') ?? 'RF Store';
// Las respuestas van a una casilla que alguien LEE: si el cliente contesta y no
// le responden, se pierde el efecto (y una respuesta es la señal más fuerte
// para que Gmail mande el remitente a la bandeja principal).
const REPLY_TO = Deno.env.get('ABANDONED_REPLY_TO') ?? 'ventas@rfstore.uy';
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://rfstore.uy';

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
	auth: { persistSession: false, autoRefreshToken: false },
});

interface Config {
	enabled: boolean;
	delay_minutes: number;
	second_delay_hours: number;
	max_reminders: number;
	min_total_usd: number;
	/**
	 * Antigüedad máxima del carrito. Escribirle a alguien por algo que dejó hace
	 * una semana no recupera nada y queda raro.
	 */
	max_age_hours: number;
	/**
	 * FECHA DE CORTE (ISO). Sólo se le escribe a carritos abandonados DESPUÉS de
	 * este momento. Se setea al encender la campaña para que el primer disparo no
	 * salga contra todos los carritos históricos: esa gente abandonó hace días o
	 * semanas y recibir el mail ahora no tiene sentido.
	 */
	start_from: string | null;
	quiet_hours: [number, number];
	max_per_run: number;
	exclude_emails: string[];
	coupon: { percent: number; valid_hours: number; payment_methods: string[] };
	/**
	 * SEGUNDO CANDADO. Mientras esté en true, el motor sólo le escribe a las
	 * direcciones de test_recipients y saltea a TODOS los clientes reales.
	 * Es lo que permite probar la campaña en producción sin riesgo de que un
	 * comprador reciba un mail de prueba. Se apaga a mano cuando el dueño valida
	 * el circuito completo.
	 */
	test_mode: boolean;
	test_recipients: string[];
}

const DEFAULTS: Config = {
	enabled: false,
	delay_minutes: 30,
	second_delay_hours: 24,
	max_reminders: 2,
	min_total_usd: 30,
	max_age_hours: 72,
	start_from: null,
	quiet_hours: [22, 9],
	max_per_run: 50,
	exclude_emails: [],
	coupon: { percent: 5, valid_hours: 48, payment_methods: ['transfer'] },
	// Arranca en modo prueba: aunque alguien encienda la campaña por error, no
	// le llega nada a un cliente real.
	test_mode: true,
	test_recipients: [],
};

function escapeHtml(s: string): string {
	return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
		.replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Código impredecible. Nada de VOLVE5: si el código se puede adivinar, el cupón
 * "personal" deja de serlo. Sin caracteres ambiguos (0/O, 1/I) porque la gente
 * los transcribe a mano.
 */
function generarCodigo(): string {
	const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	let s = '';
	const buf = new Uint8Array(8);
	crypto.getRandomValues(buf);
	for (const b of buf) s += abc[b % abc.length];
	return `VOLVE-${s}`;
}

/** Hora local de Uruguay (UTC-3), para respetar el horario de silencio. */
function horaUY(): number {
	const d = new Date();
	return (d.getUTCHours() + 24 - 3) % 24;
}

function enSilencio(cfg: Config): boolean {
	const [desde, hasta] = cfg.quiet_hours ?? [22, 9];
	const h = horaUY();
	// Ventana que cruza la medianoche (22 → 9).
	return desde > hasta ? h >= desde || h < hasta : h >= desde && h < hasta;
}

async function getConfig(): Promise<Config> {
	const { data } = await supabase.from('app_settings').select('value')
		.eq('key', 'abandoned_cart_config').maybeSingle();
	const v = (data?.value ?? {}) as Partial<Config>;
	return { ...DEFAULTS, ...v, coupon: { ...DEFAULTS.coupon, ...(v.coupon ?? {}) } };
}

/**
 * Vencimiento del cupón en criollo y en hora de Uruguay: "mañana a las 19:30",
 * "hoy a las 22:00". Se usa SÓLO en el segundo aviso.
 */
function vencimientoLegible(iso: string): string {
	const TZ = 'America/Montevideo';
	const vence = new Date(iso);
	const hora = vence.toLocaleTimeString('es-UY', {
		timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
	});
	// "Hoy" y "mañana" se deciden comparando el DÍA en Uruguay, no en UTC: a las
	// 22 h de acá ya es otro día en UTC y el mail diría el día equivocado.
	const diaDe = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ });
	const hoy = diaDe(new Date());
	const manana = diaDe(new Date(Date.now() + 86_400_000));
	const diaVence = diaDe(vence);

	if (diaVence === hoy) return `hoy a las ${hora}`;
	if (diaVence === manana) return `mañana a las ${hora}`;
	const fecha = vence.toLocaleDateString('es-UY', {
		timeZone: TZ, day: 'numeric', month: 'long',
	});
	return `el ${fecha} a las ${hora}`;
}

function renderMail(opts: {
	nombre: string;
	items: { name: string; quantity: number; image?: string }[];
	link: string;
	segundoAviso: boolean;
	/** Cuándo vence el cupón de ESTE envío (ISO). */
	venceISO: string;
}): { subject: string; html: string; text: string } {
	const { nombre, items, link, segundoAviso, venceISO } = opts;
	const primerNombre = nombre ? nombre.trim().split(' ')[0] : '';
	const saludo = primerNombre ? `Hola ${primerNombre},` : 'Hola,';

	// QUÉ DECIDE si el mail cae en Principal o en Promociones (probado con envíos
	// reales el 2026-08-20, cambiando una variable por vez):
	//
	//   remitente "Facundo de RF Store" vs "RF Store"   -> las dos a PRINCIPAL
	//   cuerpo sobrio vs cuerpo con emojis y botón      -> las dos a PRINCIPAL
	//   asunto "Te dejamos un cupón para tu X"          -> PROMOCIONES
	//   asunto "Quedó pendiente tu pedido de X"         -> PRINCIPAL
	//   asunto "Te guardamos tu pedido hasta mañana..." -> PROMOCIONES
	//
	// O sea: el remitente y el diseño del cuerpo no pesan, pero NO alcanza con
	// sacarle la palabra "cupón" al asunto. Lo que funciona es el patrón
	// "Quedó/Sigue pendiente tu pedido de X": un aviso sobre algo que el cliente
	// dejó a medias, no una oferta. Cualquier asunto que ANUNCIE algo que damos
	// ("te dejamos", "te guardamos") se lee como promoción.
	//
	// Por las dudas, la PRIMERA LÍNEA del cuerpo también arranca transaccional:
	// es el texto de vista previa que Gmail muestra al lado del asunto.
	//
	// Si se cambia un asunto, hay que volver a probarlo con el modo ab_test.
	const principal = items[0]?.name ?? '';
	const corto = principal.length > 42 ? principal.slice(0, 42).trim() + '…' : principal;
	const subject = segundoAviso
		? corto
			? `Sigue pendiente tu pedido de ${corto}`
			: `Sigue pendiente tu pedido en RF Store`
		: corto
		? `Quedó pendiente tu pedido de ${corto}`
		: `Quedó pendiente tu pedido en RF Store`;

	const lista = items.slice(0, 4).map(i =>
		`${escapeHtml(i.name)}${i.quantity > 1 ? ` (${i.quantity})` : ''}`
	);
	const resto = items.length > 4 ? `y ${items.length - 4} más` : '';

	const filasHtml = lista.map(n =>
		`<tr><td style="padding:3px 0;color:#111;font-size:16px;line-height:1.45;font-weight:600;">${n}</td></tr>`
	).join('');

	// Tono conversacional, tipo WhatsApp: saludo, motivo, regalo, urgencia, link.
	// Es la estructura que pidió el dueño (referencia: los avisos de Tripwip).
	//
	// La URGENCIA se construye distinto en cada aviso, a propósito:
	//   1.º -> vaga ("antes de que expire"): mete presión sin dar una fecha que
	//          le permita al cliente postergarlo hasta el último momento.
	//   2.º -> concreta ("vence mañana a las 19:30"): ya postergó una vez, así que
	//          lo que mueve es saber exactamente cuánto tiempo le queda.
	const vence = vencimientoLegible(venceISO);
	// La PRIMERA frase arranca transaccional en los dos avisos: es lo que Gmail
	// muestra como vista previa. Recién después aparece el descuento.
	const cuerpo1 = segundoAviso
		? 'Te escribimos de nuevo porque tu compra quedó sin confirmar. Te seguimos guardando el descuento que te dejamos. 🎁'
		: 'Notamos que no finalizaste tu compra. Queremos que te lo lleves, así que te dejamos un cupón de descuento exclusivo para vos. 🎁';
	const cuerpo2 = segundoAviso
		? `Tu descuento vence ${vence}. ⏳`
		: '¡Ingresá YA para aprovecharlo antes de que expire! ⏳';

	const html = `<!doctype html><html lang="es"><body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111;">
	<table width="100%" cellpadding="0" cellspacing="0" style="padding:28px 16px;"><tr><td align="center">
		<table width="440" cellpadding="0" cellspacing="0" style="max-width:440px;text-align:left;">

			<tr><td style="font-size:17px;line-height:1.5;color:#111;font-weight:700;padding-bottom:14px;">
				¡Hola${primerNombre ? ' ' + escapeHtml(primerNombre) : ''}! 👋
			</td></tr>

			<tr><td style="font-size:16px;line-height:1.55;color:#222;padding-bottom:16px;">
				${cuerpo1}
			</td></tr>

			<tr><td style="padding-bottom:16px;">
				<table width="100%" cellpadding="0" cellspacing="0">${filasHtml}</table>
				${resto ? `<div style="color:#777;font-size:14px;padding-top:2px;">${resto}</div>` : ''}
			</td></tr>

			<tr><td style="font-size:16px;line-height:1.55;color:#222;font-weight:600;padding-bottom:20px;">
				${cuerpo2}
			</td></tr>

			<tr><td style="padding-bottom:14px;">
				<a href="${escapeHtml(link)}" style="display:inline-block;background:#111;color:#ffffff;text-decoration:none;padding:14px 30px;border-radius:6px;font-size:16px;font-weight:700;">Ver mi cupón</a>
			</td></tr>

			<tr><td style="font-size:13px;line-height:1.5;color:#777;padding-bottom:16px;">
				<a href="${escapeHtml(link)}" style="color:#0b5cad;">${escapeHtml(link)}</a>
			</td></tr>

			<tr><td style="font-size:13px;line-height:1.55;color:#666;padding-bottom:14px;">
				Válido pagando por transferencia bancaria. Un solo uso, en tu cuenta.
			</td></tr>

			<tr><td style="font-size:12px;line-height:1.55;color:#999;border-top:1px solid #ececec;padding-top:12px;">
				RF Store · Montevideo · Respondé este mail si no querés recibir más avisos.
			</td></tr>
		</table>
	</td></tr></table></body></html>`;

	// Texto plano: lo tienen los mails reales y casi ningún envío de marketing.
	const text = [
		`¡Hola${primerNombre ? ' ' + primerNombre : ''}! 👋`,
		'',
		cuerpo1,
		'',
		...lista.map(n => n.replace(/&[a-z]+;/g, '')),
		resto,
		'',
		cuerpo2,
		link,
		'',
		'Válido pagando por transferencia bancaria. Un solo uso, en tu cuenta.',
		'',
		'RF Store · Montevideo',
	].filter(Boolean).join('\n');

	return { subject, html, text };
}

async function enviarResend(to: string, subject: string, html: string, text: string): Promise<{ id?: string; error?: string }> {
	if (!RESEND_API_KEY) return { error: 'RESEND_API_KEY no configurada' };
	try {
		const r = await fetch('https://api.resend.com/emails', {
			method: 'POST',
			headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				// Nombre de PERSONA, no de marca: "RF Store" a secas lee como envío
				// masivo; un remitente con nombre propio, como escribe un vendedor,
				// pesa a favor de la bandeja principal.
				from: `${FROM_NAME} <${FROM_EMAIL}>`,
				to: [to],
				subject,
				html,
				// El texto plano acompaña al HTML (multipart). Los envíos de marketing
				// suelen ir sólo en HTML: mandar las dos partes es señal de mail real.
				text,
				// Una respuesta del destinatario es la señal MÁS fuerte que existe para
				// que Gmail mande a Principal todo lo que venga después de este remitente.
				reply_to: REPLY_TO,
				headers: {
					// Marca el mail como no-masivo. Sin esto, algunos clientes lo tratan
					// como bulk por defecto.
					'X-Entity-Ref-ID': crypto.randomUUID(),
				},
			}),
		});
		const t = await r.text();
		if (!r.ok) return { error: `resend ${r.status}: ${t.slice(0, 200)}` };
		try { return { id: JSON.parse(t).id }; } catch { return {}; }
	} catch (e) {
		return { error: e instanceof Error ? e.message : String(e) };
	}
}


Deno.serve(async req => {
	if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

	const body = await req.json().catch(() => ({} as any));
	const dryRun = body?.dry_run === true;
	const force = body?.force === true;

	const json = (o: unknown, status = 200) =>
		new Response(JSON.stringify(o, null, 1), {
			status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		});

	try {
		const cfg = await getConfig();

		// --- VISTA PREVIA (no toca leads ni cupones) ---
		// Manda los DOS avisos reales, tal cual los va a recibir un cliente, a la
		// dirección que se le pida. Sirve para que el admin los revise y para
		// medir en qué pestaña caen si se cambia el copy.
		//   { preview: true, to: "mail@..." }
		if (body?.preview === true || body?.ab_test === true) {
			const destino = String(body?.to ?? '').trim().toLowerCase();
			if (!/^.+@.+\..+$/.test(destino)) {
				return json({ ok: false, error: 'Falta un destino válido en "to"' }, 400);
			}
			const link = `${SITE_URL}/carrito/recuperar/00000000-0000-0000-0000-000000000000`;
			// Date.now() y no `ahora`: esa constante se declara más abajo, después
			// de este bloque.
			const vence = new Date(Date.now() + cfg.coupon.valid_hours * 3_600_000).toISOString();
			const ejemplo = [
				{ name: 'Notebook Lenovo IdeaPad 15,6" i5 16GB', quantity: 1 },
				{ name: 'Mouse Genius NX-7000SE Inalámbrico', quantity: 1 },
			];
			const salida: any[] = [];
			for (const segundo of [false, true]) {
				const { subject, html, text } = renderMail({
					nombre: 'Facundo',
					items: ejemplo,
					link,
					segundoAviso: segundo,
					venceISO: vence,
				});
				const r = await fetch('https://api.resend.com/emails', {
					method: 'POST',
					headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
					body: JSON.stringify({
						from: `${FROM_NAME} <${FROM_EMAIL}>`,
						to: [destino],
						subject,
						html,
						text,
						reply_to: REPLY_TO,
						headers: { 'X-Entity-Ref-ID': crypto.randomUUID() },
					}),
				});
				const t = await r.text();
				salida.push({ aviso: segundo ? 2 : 1, subject, ok: r.ok, resp: t.slice(0, 160) });
			}
			return json({ ok: true, preview: true, enviados_a: destino, mails: salida });
		}

		if (!cfg.enabled && !force) return json({ ok: true, skipped: 'campaña apagada' });
		if (enSilencio(cfg) && !force) return json({ ok: true, skipped: `horario de silencio (${horaUY()}h UY)` });

		const ahora = Date.now();
		const corte1 = new Date(ahora - cfg.delay_minutes * 60_000).toISOString();
		const corte2 = new Date(ahora - cfg.second_delay_hours * 3_600_000).toISOString();
		// Quien creó una orden hace poco puede estar pagando en este momento.
		// Escribirle sería regalarle un descuento sobre una venta que ya tenemos.
		const ventanaPagando = new Date(ahora - 20 * 60_000).toISOString();

		// Antigüedad máxima: no se persigue un carrito de hace días.
		const corteViejo = new Date(ahora - cfg.max_age_hours * 3_600_000).toISOString();

		let q = supabase.from('checkout_leads')
			.select('id, user_id, customer_id, email, full_name, cart, items_count, total_usd, recover_token, last_reminder_no, abandoned_at, updated_at, status, created_at')
			.eq('status', 'started')
			.gt('items_count', 0)
			.gte('total_usd', cfg.min_total_usd)
			.not('email', 'is', null)
			.gte('created_at', corteViejo)
			.order('updated_at', { ascending: true })
			.limit(cfg.max_per_run);
		// Fecha de corte: al encender la campaña, los carritos que ya estaban
		// abandonados NO reciben nada. Sólo los que se abandonen de ahí en adelante.
		if (cfg.start_from) q = q.gte('created_at', cfg.start_from);
		if (body?.only_lead_id) q = q.eq('id', body.only_lead_id);

		const { data: leads, error: leadsErr } = await q;
		if (leadsErr) throw new Error(`leads: ${leadsErr.message}`);

		const resultados: any[] = [];

		for (const lead of leads ?? []) {
			const ref = lead.abandoned_at ?? lead.updated_at;
			const proximo = Number(lead.last_reminder_no ?? 0) + 1;

			if (proximo > cfg.max_reminders) { resultados.push({ lead: lead.id, skip: 'tope de recordatorios' }); continue; }
			const corte = proximo === 1 ? corte1 : corte2;
			if (!(ref < corte)) { resultados.push({ lead: lead.id, skip: 'todavía no cumple la espera' }); continue; }

			const email = String(lead.email ?? '').trim().toLowerCase();
			if (!/^.+@.+\..+$/.test(email)) { resultados.push({ lead: lead.id, skip: 'email inválido' }); continue; }
			if ((cfg.exclude_emails ?? []).map(e => e.toLowerCase()).includes(email)) {
				resultados.push({ lead: lead.id, skip: 'email excluido' }); continue;
			}

			// SEGUNDO CANDADO: en modo prueba sólo salen mails a la lista blanca.
			// Un cliente real nunca recibe nada mientras esto esté prendido, ni
			// siquiera con force:true.
			if (cfg.test_mode) {
				const permitidos = (cfg.test_recipients ?? []).map(e => e.trim().toLowerCase());
				if (!permitidos.includes(email)) {
					resultados.push({ lead: lead.id, skip: 'modo prueba: destinatario no está en la lista blanca' });
					continue;
				}
			}

			// ¿Ya compró, o está pagando ahora mismo?
			if (lead.customer_id) {
				const { data: ordenes } = await supabase.from('orders')
					.select('id, payment_status, created_at')
					.eq('customer_id', lead.customer_id)
					.gte('created_at', ventanaPagando)
					.limit(1);
				if ((ordenes ?? []).length > 0) {
					resultados.push({ lead: lead.id, skip: 'tiene una orden reciente (puede estar pagando)' });
					continue;
				}
			}

			// Idempotencia: ¿ya se le mandó este recordatorio?
			const { data: previo } = await supabase.from('abandoned_cart_sends')
				.select('id').eq('lead_id', lead.id).eq('reminder_no', proximo).maybeSingle();
			if (previo) { resultados.push({ lead: lead.id, skip: 'ya enviado' }); continue; }

			const items = (lead.cart ?? []) as any[];
			const link = `${SITE_URL}/carrito/recuperar/${lead.recover_token}`;

			if (dryRun) {
				resultados.push({ lead: lead.id, email, reminder_no: proximo, total: lead.total_usd, would_send: true });
				continue;
			}

			// --- Cupón personal, de un uso, sólo transferencia ---
			// Antes de emitir uno nuevo se dan de baja los anteriores de este mismo
			// lead. Si no, el cliente termina con dos códigos vivos y el segundo mail
			// le promete un vencimiento que no es el del código que quizá use (el del
			// primer mail, que vence antes).
			const { data: previos } = await supabase
				.from('abandoned_cart_sends')
				.select('coupon_id')
				.eq('lead_id', lead.id)
				.not('coupon_id', 'is', null);
			const idsPrevios = (previos ?? [])
				.map((p: any) => p.coupon_id)
				.filter(Boolean);
			if (idsPrevios.length > 0) {
				// Sólo los que siguen sin usar: si ya lo usó, la orden existe y el
				// used_count tiene que quedar como está.
				await supabase
					.from('coupons')
					.update({ active: false })
					.in('id', idsPrevios)
					.eq('used_count', 0);
			}

			const code = generarCodigo();
			const expira = new Date(ahora + cfg.coupon.valid_hours * 3_600_000).toISOString();
			const { data: cupon, error: cupErr } = await supabase.from('coupons').insert({
				code,
				type: 'percent',
				value: cfg.coupon.percent,
				scope: 'all',
				active: true,
				max_uses: 1,
				expires_at: expira,
				payment_methods: cfg.coupon.payment_methods,
				customer_id: lead.customer_id,   // ← atado a la cuenta
			}).select('id, code').single();
			if (cupErr || !cupon) {
				resultados.push({ lead: lead.id, error: `cupón: ${cupErr?.message}` });
				continue;
			}

			const { subject, html, text } = renderMail({
				nombre: lead.full_name ?? '',
				items: items.map(i => ({ name: i.name ?? 'Producto', quantity: Number(i.quantity) || 1, image: i.image })),
				link,
				segundoAviso: proximo > 1,
				venceISO: expira,
			});

			const envio = await enviarResend(email, subject, html, text);

			await supabase.from('abandoned_cart_sends').insert({
				lead_id: lead.id,
				customer_id: lead.customer_id,
				email,
				reminder_no: proximo,
				coupon_id: cupon.id,
				coupon_code: cupon.code,
				cart: lead.cart ?? [],
				total_usd: lead.total_usd ?? 0,
				status: envio.error ? 'failed' : 'sent',
				error: envio.error ?? null,
				resend_id: envio.id ?? null,
			});

			// Si el mail no salió, el cupón no sirve para nada: se desactiva para
			// no dejar códigos vivos sueltos por la base.
			if (envio.error) {
				await supabase.from('coupons').update({ active: false }).eq('id', cupon.id);
			} else {
				await supabase.from('checkout_leads')
					.update({ last_reminder_no: proximo, updated_at: new Date().toISOString() })
					.eq('id', lead.id);
			}

			resultados.push({ lead: lead.id, email, reminder_no: proximo, ok: !envio.error, error: envio.error });
		}

		return json({
			ok: true,
			dry_run: dryRun,
			config: {
				enabled: cfg.enabled,
				test_mode: cfg.test_mode,
				test_recipients: cfg.test_recipients,
				delay_minutes: cfg.delay_minutes,
				percent: cfg.coupon.percent,
			},
			evaluados: (leads ?? []).length,
			enviados: resultados.filter(r => r.ok).length,
			resultados,
		});
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return json({ ok: false, error: msg }, 500);
	}
});
