// deno-lint-ignore-file no-explicit-any
// placetopay-webhook v1 (2026-10-29)
//
// Aviso de Placetopay cuando una sesión termina. Se despliega con
// --no-verify-jwt (Placetopay no manda token de Supabase).
//
// 1) Se valida la firma con la SecretKey (si no coincide, se descarta).
// 2) Igual NO se confía en lo que dice el aviso: se re-consulta la sesión a
//    Placetopay y se aplica ese estado (syncSession, idempotente).
// Placetopay manda el aviso UNA sola vez y no reintenta; si esto falla, la
// revisión cada 10 minutos (placetopay-reconcile) lo levanta igual.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';
import { ptpValidSignature, syncSession } from '../_shared/placetopay.ts';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
	auth: { persistSession: false, autoRefreshToken: false },
});

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async req => {
	if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
	if (req.method === 'GET') return json({ status: 'ok' });

	const body: any = await req.json().catch(() => null);
	const requestId = Number(body?.requestId) || 0;

	// Pagos recurrentes (no los usamos) vienen sin requestId.
	if (!requestId) {
		console.warn('[placetopay-webhook] aviso sin requestId:', JSON.stringify(body).slice(0, 300));
		return json({ status: 'ignored' });
	}
	if (!(await ptpValidSignature(body))) {
		console.warn(`[placetopay-webhook] firma inválida, requestId=${requestId} ref=${body?.reference}`);
		return json({ status: 'invalid signature' }, 400);
	}

	// Se responde YA (Placetopay pide responder lo antes posible y no reintenta)
	// y la consulta + actualización sigue en segundo plano. Si falla, la sesión
	// sigue PENDING en nuestra tabla y la revisión periódica la vuelve a ver.
	const work = syncSession(supabase, requestId)
		.then(r => console.log(`[placetopay-webhook] requestId=${requestId} ref=${body?.reference} aviso=${body?.status?.status} ->`, JSON.stringify(r)))
		.catch(e => console.error(`[placetopay-webhook] requestId=${requestId}:`, e instanceof Error ? e.message : e));
	const rt = (globalThis as any).EdgeRuntime;
	if (rt?.waitUntil) rt.waitUntil(work);
	else await work;
	return json({ status: 'ok' });
});
