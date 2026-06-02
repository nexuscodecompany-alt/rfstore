// deno-lint-ignore-file no-explicit-any
// Edge Function: ml-oauth-exchange
// Intercambia el `code` recibido en el callback OAuth de Mercado Libre
// por access_token + refresh_token, y guarda en `ml_credentials`.
//
// Llamado por la Vercel API route /api/ml/oauth/callback.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ML_CLIENT_ID = Deno.env.get('ML_CLIENT_ID')!;
const ML_CLIENT_SECRET = Deno.env.get('ML_CLIENT_SECRET')!;

const ML_TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';
const ML_ME_URL = 'https://api.mercadolibre.com/users/me';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
	auth: { persistSession: false, autoRefreshToken: false },
});

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { ...corsHeaders, 'Content-Type': 'application/json' },
	});

Deno.serve(async req => {
	if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
	if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

	let body: { code?: string; redirect_uri?: string } = {};
	try {
		body = await req.json();
	} catch {
		return json({ ok: false, error: 'invalid_json' }, 400);
	}

	const { code, redirect_uri } = body;
	if (!code || !redirect_uri) {
		return json({ ok: false, error: 'missing_code_or_redirect_uri' }, 400);
	}

	// 1. Exchange code -> tokens
	const tokenResp = await fetch(ML_TOKEN_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			Accept: 'application/json',
		},
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			client_id: ML_CLIENT_ID,
			client_secret: ML_CLIENT_SECRET,
			code,
			redirect_uri,
		}).toString(),
	});

	const tokens: any = await tokenResp.json().catch(() => ({}));
	if (!tokenResp.ok) {
		return json({ ok: false, error: 'token_exchange_failed', detail: tokens }, 400);
	}

	const { access_token, refresh_token, expires_in, scope, token_type, user_id } = tokens;
	if (!access_token || !refresh_token || !user_id) {
		return json({ ok: false, error: 'invalid_token_response', detail: tokens }, 400);
	}

	// 2. Fetch nickname (no fatal si falla)
	let nickname: string | null = null;
	try {
		const meResp = await fetch(ML_ME_URL, { headers: { Authorization: `Bearer ${access_token}` } });
		if (meResp.ok) {
			const me: any = await meResp.json();
			nickname = me?.nickname ?? null;
		}
	} catch {
		// nada
	}

	// Restamos 30s a expires_in para tener margen al refrescar
	const expiresAt = new Date(Date.now() + (Number(expires_in) - 30) * 1000).toISOString();

	const { error } = await supabase
		.from('ml_credentials')
		.upsert(
			{
				ml_user_id: user_id,
				ml_nickname: nickname,
				access_token,
				refresh_token,
				token_type: token_type ?? 'bearer',
				scope: scope ?? null,
				expires_at: expiresAt,
			},
			{ onConflict: 'ml_user_id' }
		);

	if (error) {
		return json({ ok: false, error: 'db_save_failed', detail: error.message }, 500);
	}

	return json({ ok: true, ml_user_id: user_id, nickname });
});
