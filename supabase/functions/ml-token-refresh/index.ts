// deno-lint-ignore-file no-explicit-any
// Edge Function: ml-token-refresh
// Cron / on-demand. Refresca cualquier credencial ML cuyo access_token
// expire en menos de 15min. Idempotente: si todavia no expira, no hace nada.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ML_CLIENT_ID = Deno.env.get('ML_CLIENT_ID')!;
const ML_CLIENT_SECRET = Deno.env.get('ML_CLIENT_SECRET')!;
const ML_TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
	auth: { persistSession: false, autoRefreshToken: false },
});

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { ...corsHeaders, 'Content-Type': 'application/json' },
	});

async function refreshOne(cred: any) {
	const resp = await fetch(ML_TOKEN_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			Accept: 'application/json',
		},
		body: new URLSearchParams({
			grant_type: 'refresh_token',
			client_id: ML_CLIENT_ID,
			client_secret: ML_CLIENT_SECRET,
			refresh_token: cred.refresh_token,
		}).toString(),
	});

	const data: any = await resp.json().catch(() => ({}));
	if (!resp.ok) {
		throw new Error(`refresh_failed (${resp.status}): ${JSON.stringify(data)}`);
	}

	const { access_token, refresh_token, expires_in } = data;
	const expiresAt = new Date(Date.now() + (Number(expires_in) - 30) * 1000).toISOString();

	const { error } = await supabase
		.from('ml_credentials')
		.update({
			access_token,
			refresh_token: refresh_token ?? cred.refresh_token,
			expires_at: expiresAt,
		})
		.eq('id', cred.id);

	if (error) throw new Error(`db_update: ${error.message}`);
}

Deno.serve(async req => {
	if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

	// Buscamos creds que expiran en < 15min
	const cutoff = new Date(Date.now() + 15 * 60 * 1000).toISOString();
	const { data: creds, error } = await supabase
		.from('ml_credentials')
		.select('id, ml_user_id, refresh_token, expires_at')
		.lt('expires_at', cutoff);

	if (error) return json({ ok: false, error: error.message }, 500);

	const results: any[] = [];
	for (const c of creds ?? []) {
		try {
			await refreshOne(c);
			results.push({ ml_user_id: c.ml_user_id, ok: true });
		} catch (e: any) {
			results.push({ ml_user_id: c.ml_user_id, ok: false, error: e.message });
		}
	}

	return json({ ok: true, refreshed: results.length, results });
});
