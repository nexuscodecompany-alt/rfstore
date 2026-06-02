// Vercel API route: /api/ml/oauth/callback
// ML redirige aca con ?code=...&state=...
// Reenvia el code a la Edge Function `ml-oauth-exchange` para canjearlo
// por tokens, y redirige al admin con status=connected | status=error.

export const config = { runtime: 'edge' };

const DASHBOARD_PATH = '/dashboard/mercadolibre';

export default async function handler(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state') ?? '';
	const oauthError = url.searchParams.get('error');

	const back = (params: Record<string, string>) => {
		const qs = new URLSearchParams(params).toString();
		return Response.redirect(`${url.origin}${DASHBOARD_PATH}?${qs}`, 302);
	};

	if (oauthError) {
		return back({ status: 'error', error: oauthError, state });
	}
	if (!code) {
		return back({ status: 'error', error: 'missing_code', state });
	}

	const supabaseUrl =
		(globalThis as any).process?.env?.VITE_PROJECT_URL_SUPABASE ??
		(globalThis as any).process?.env?.SUPABASE_URL;
	const anonKey =
		(globalThis as any).process?.env?.VITE_SUPABASE_API_KEY ??
		(globalThis as any).process?.env?.SUPABASE_ANON_KEY;

	if (!supabaseUrl || !anonKey) {
		return back({ status: 'error', error: 'env_missing', state });
	}

	const redirectUri =
		(globalThis as any).process?.env?.ML_REDIRECT_URI ?? `${url.origin}/api/ml/oauth/callback`;

	try {
		const resp = await fetch(`${supabaseUrl}/functions/v1/ml-oauth-exchange`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${anonKey}`,
				apikey: anonKey,
			},
			body: JSON.stringify({ code, redirect_uri: redirectUri }),
		});
		const data: any = await resp.json().catch(() => ({}));
		if (!resp.ok || !data?.ok) {
			return back({
				status: 'error',
				error: String(data?.error ?? 'exchange_failed'),
				state,
			});
		}
		return back({
			status: 'connected',
			nickname: String(data?.nickname ?? ''),
			state,
		});
	} catch (e: any) {
		return back({ status: 'error', error: e?.message ?? 'fetch_failed', state });
	}
}
