import { useQuery } from '@tanstack/react-query';

// Cotización USD→UYU (BCU oficial) servida por nuestra edge function.
// Usar la edge function evita problemas de DNS/bloqueo de dolarapi.com en
// algunas redes del cliente (ISP, antivirus, firewall corporativo).
export interface UsdUyuRate {
	rate: number;
	source: string;
	fetched_at: string;
	stale?: boolean;
}

const SUPABASE_URL = import.meta.env.VITE_PROJECT_URL_SUPABASE;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_API_KEY;

const fetchRate = async (): Promise<UsdUyuRate> => {
	const r = await fetch(`${SUPABASE_URL}/functions/v1/get-fx-rate`, {
		headers: { apikey: SUPABASE_ANON },
	});
	if (!r.ok) throw new Error(`get-fx-rate HTTP ${r.status}`);
	const j = await r.json();
	if (!j.rate || j.rate <= 0) throw new Error('cotización inválida');
	return j as UsdUyuRate;
};

export const useUsdUyuRate = () =>
	useQuery({
		queryKey: ['usd_uyu_rate'],
		queryFn: fetchRate,
		staleTime: 60 * 60 * 1000, // 1 hora
		retry: 1,
	});
