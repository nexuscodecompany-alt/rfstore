// deno-lint-ignore-file no-explicit-any
// password-reset v1 (2026-10-29)
//
// Recuperar contraseña con un código de 6 dígitos por mail (Resend).
//
//   { action: 'request', email }                       -> manda el código
//   { action: 'reset', email, code, new_password }     -> verifica y cambia la contraseña
//
// Seguridad:
//  - El código se guarda como HMAC-SHA256 (clave = service role), nunca en claro.
//  - Vence a los 15 minutos, 5 intentos, un solo uso; pedir otro anula los anteriores.
//  - Límites: 1 pedido por minuto y 3 por hora por mail; 10 por hora por IP.
//  - No revela si el mail existe: la respuesta de 'request' es siempre la misma,
//    y los pedidos de mails inexistentes también cuentan para los límites.
//  - Recibir el código prueba que el mail es suyo: se marca como confirmado.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'ventas@send.rfstore.uy';

const CODE_MINUTES = 15;
const MAX_ATTEMPTS = 5;
const MIN_PASSWORD = 8;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const normEmail = (e: unknown) => String(e ?? '').trim().toLowerCase();
const validEmail = (e: string) => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

async function hmac(text: string): Promise<string> {
	const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SERVICE_ROLE), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
	return [...sig].map(b => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let d = 0;
	for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return d === 0;
}

/** 6 dígitos uniformes (sin sesgo de módulo). */
function newCode(): string {
	const buf = new Uint32Array(1);
	const limit = Math.floor(0xffffffff / 1_000_000) * 1_000_000;
	do crypto.getRandomValues(buf); while (buf[0] >= limit);
	return String(buf[0] % 1_000_000).padStart(6, '0');
}

async function countSince(column: 'email' | 'ip', value: string, minutes: number): Promise<number> {
	const { count } = await admin
		.from('password_reset_codes')
		.select('id', { count: 'exact', head: true })
		.eq(column, value)
		.gt('created_at', new Date(Date.now() - minutes * 60_000).toISOString());
	return count ?? 0;
}

async function sendCodeMail(to: string, code: string): Promise<void> {
	if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY no configurado');
	const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;"><tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;max-width:520px;">
<tr><td align="center" style="padding:24px 28px 6px;"><img src="https://www.rfstore.uy/img/img-docs/logoblancorf.jpg" width="46" height="46" alt="RF Store" style="display:block;border:0;"></td></tr>
<tr><td style="padding:12px 32px 28px;text-align:center;">
<p style="margin:0 0 8px;font-size:18px;font-weight:600;color:#111;">Tu código para cambiar la contraseña</p>
<p style="margin:0 0 20px;color:#555;line-height:1.5;">Ingresalo en la página de RF Store. Vence en ${CODE_MINUTES} minutos.</p>
<p style="margin:0 0 20px;font-size:34px;font-weight:700;letter-spacing:8px;color:#111;font-family:monospace;">${code}</p>
<p style="margin:0;color:#888;font-size:12px;line-height:1.5;">Si no pediste cambiar tu contraseña, ignorá este mail: tu cuenta sigue igual. Nunca te vamos a pedir este código por teléfono ni WhatsApp.</p>
</td></tr></table></td></tr></table></body></html>`;
	const text = `Tu código para cambiar la contraseña de RF Store: ${code}\nVence en ${CODE_MINUTES} minutos.\nSi no lo pediste, ignorá este mail.`;
	const r = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ from: `RF Store <${FROM_EMAIL}>`, to: [to], subject: `${code} es tu código de RF Store`, html, text }),
	});
	if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 300)}`);
}

Deno.serve(async req => {
	if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
	if (req.method !== 'POST') return json({ error: 'método no permitido' }, 405);

	try {
		const body = await req.json().catch(() => ({}));
		const action = String(body?.action ?? '');
		const email = normEmail(body?.email);
		if (!validEmail(email)) return json({ error: 'Ingresá un mail válido' }, 400);
		const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';

		/* ------------------------------ pedir código ------------------------------ */
		if (action === 'request') {
			if ((await countSince('email', email, 1)) >= 1) {
				return json({ error: 'Ya te mandamos un código. Esperá un minuto antes de pedir otro.' }, 429);
			}
			if ((await countSince('email', email, 60)) >= 3 || (await countSince('ip', ip, 60)) >= 10) {
				return json({ error: 'Pediste demasiados códigos. Probá de nuevo en una hora.' }, 429);
			}

			const { data: userId } = await admin.rpc('auth_user_id_by_email', { p_email: email });
			const expiresAt = new Date(Date.now() + CODE_MINUTES * 60_000).toISOString();

			if (!userId) {
				// Mail inexistente: se registra igual (cuenta para los límites) y se
				// responde lo mismo que si existiera.
				await admin.from('password_reset_codes').insert({ email, ip, expires_at: expiresAt, used_at: new Date().toISOString() });
				return json({ ok: true });
			}

			// Un código nuevo anula los anteriores.
			await admin.from('password_reset_codes').update({ used_at: new Date().toISOString() }).eq('email', email).is('used_at', null);

			const code = newCode();
			const { error: insErr } = await admin.from('password_reset_codes').insert({
				email, user_id: userId, code_hash: await hmac(`${email}:${code}`), ip, expires_at: expiresAt,
			});
			if (insErr) throw new Error(insErr.message);

			await sendCodeMail(email, code);
			return json({ ok: true });
		}

		/* --------------------------- verificar y cambiar --------------------------- */
		if (action === 'reset') {
			const code = String(body?.code ?? '').replace(/\D/g, '');
			const pass = String(body?.new_password ?? '');
			if (code.length !== 6) return json({ error: 'El código tiene 6 dígitos' }, 400);
			if (pass.length < MIN_PASSWORD) return json({ error: `La contraseña tiene que tener al menos ${MIN_PASSWORD} caracteres` }, 400);
			if (pass.length > 72) return json({ error: 'La contraseña es demasiado larga (máximo 72 caracteres)' }, 400);

			const { data: row } = await admin
				.from('password_reset_codes')
				.select('id, user_id, code_hash, attempts, expires_at')
				.eq('email', email)
				.is('used_at', null)
				.not('code_hash', 'is', null)
				.order('created_at', { ascending: false })
				.limit(1)
				.maybeSingle();

			if (!row || new Date(row.expires_at).getTime() < Date.now()) {
				return json({ error: 'El código venció o no es válido. Pedí uno nuevo.' }, 400);
			}
			if (row.attempts >= MAX_ATTEMPTS) {
				return json({ error: 'Demasiados intentos. Pedí un código nuevo.' }, 400);
			}

			// El intento se cuenta ANTES de comparar (dos intentos simultáneos no
			// pueden saltearse el límite).
			const { data: bumped } = await admin
				.from('password_reset_codes')
				.update({ attempts: row.attempts + 1 })
				.eq('id', row.id)
				.eq('attempts', row.attempts)
				.is('used_at', null)
				.select('id')
				.maybeSingle();
			if (!bumped) return json({ error: 'Probá de nuevo en unos segundos.' }, 409);

			if (!safeEqual(await hmac(`${email}:${code}`), String(row.code_hash))) {
				const left = MAX_ATTEMPTS - (row.attempts + 1);
				return json({ error: left > 0 ? `Código incorrecto. Te quedan ${left} intento${left === 1 ? '' : 's'}.` : 'Código incorrecto. Pedí un código nuevo.' }, 400);
			}

			// Se marca usado antes de cambiar la contraseña: un solo uso aunque haya
			// dos pedidos al mismo tiempo.
			const { data: claimed } = await admin
				.from('password_reset_codes')
				.update({ used_at: new Date().toISOString() })
				.eq('id', row.id)
				.is('used_at', null)
				.select('id')
				.maybeSingle();
			if (!claimed) return json({ error: 'El código ya se usó. Pedí uno nuevo.' }, 400);

			const { error: upErr } = await admin.auth.admin.updateUserById(String(row.user_id), {
				password: pass,
				email_confirm: true,
			});
			if (upErr) {
				// La contraseña no cambió: se libera el código para que pueda reintentar.
				await admin.from('password_reset_codes').update({ used_at: null }).eq('id', row.id);
				const weak = /password/i.test(upErr.message);
				return json({ error: weak ? 'Esa contraseña no es válida. Probá con una más segura.' : 'No pudimos cambiar la contraseña. Probá de nuevo.' }, 400);
			}
			return json({ ok: true });
		}

		return json({ error: 'acción inválida' }, 400);
	} catch (e) {
		console.error('[password-reset]', e instanceof Error ? e.message : e);
		return json({ error: 'No pudimos procesar el pedido. Probá de nuevo en unos minutos.' }, 500);
	}
});
