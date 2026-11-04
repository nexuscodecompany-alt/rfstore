import { useQuery } from '@tanstack/react-query';
import { getSession } from '../../actions';

export const useUser = () => {
	const { data, isLoading } = useQuery({
		queryKey: ['user'],
		queryFn: getSession,
		retry: false,
		refetchOnWindowFocus: true,
	});

	// Compra como invitado: el checkout abre una sesión ANÓNIMA de Supabase
	// (signInAnonymously) para que el pedido tenga dueño. Para el resto del sitio
	// eso NO es estar logueado: `session` sólo trae cuentas reales y
	// `guestSession` la del invitado.
	const raw = data?.session ?? null;
	const isGuest = !!raw?.user?.is_anonymous;

	return {
		session: isGuest ? null : raw,
		guestSession: isGuest ? raw : null,
		isLoading,
	};
};
