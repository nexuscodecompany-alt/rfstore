import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { setProductSyncPaused } from '../../actions';

// Pausa / reanuda TODO el sync de CDR de un producto (contenido + precio + stock).
// Mientras está pausado el producto es 100% manual: CDR no le toca nada.
export const useSetProductSyncPaused = () => {
	const queryClient = useQueryClient();

	const { mutate, isPending, variables } = useMutation({
		mutationFn: ({ id, paused }: { id: string; paused: boolean }) =>
			setProductSyncPaused(id, paused),
		onSuccess: (_data, vars) => {
			queryClient.invalidateQueries({ queryKey: ['admin-products'] });
			queryClient.invalidateQueries({ queryKey: ['products'] });
			toast.success(
				vars.paused
					? 'Sync de CDR pausada: el producto quedó manual'
					: 'Sync de CDR reanudada: CDR vuelve a mandar',
				{ position: 'bottom-right' }
			);
		},
		onError: () =>
			toast.error('No se pudo cambiar el sync de CDR', {
				position: 'bottom-right',
			}),
	});

	return {
		setSyncPaused: mutate,
		isSettingSyncPause: isPending,
		syncPauseVars: variables,
	};
};
