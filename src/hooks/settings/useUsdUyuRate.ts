import { useQuery } from '@tanstack/react-query';

// Cotización dólar BROU venta vía dolarapi.com.
// El back también la consulta (con cache propio), esto es solo para mostrar
// el equivalente UYU en el checkout antes de redirigir a MercadoPago.
export interface UsdUyuRate {
	rate: number;
	source: string;
	fetched_at: string;
}

const fetchRate = async (): Promise<UsdUyuRate> => {
	const r = await fetch('https://api.dolarapi.com/v1/uruguay/oficial');
	if (!r.ok) throw new Error(`dolarapi HTTP ${r.status}`);
	const j = await r.json();
	const venta = Number(j.venta);
	if (!venta || venta <= 0) throw new Error('cotización inválida');
	return {
		rate: venta,
		source: 'BCU oficial (dolarapi.com)',
		fetched_at: new Date().toISOString(),
	};
};

export const useUsdUyuRate = () =>
	useQuery({
		queryKey: ['usd_uyu_rate'],
		queryFn: fetchRate,
		staleTime: 60 * 60 * 1000, // 1 hora
		retry: 1,
	});
