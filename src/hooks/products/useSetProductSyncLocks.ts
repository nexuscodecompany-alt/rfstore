import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { setProductSyncLocks, type CdrSyncLocks } from '../../actions';

// Candados de sync de CDR por producto, elegidos de a uno desde el modal:
// precio (costo), stock y contenido (nombre + descripción). Lo que queda
// destildado se sigue sincronizando normalmente.
export const useSetProductSyncLocks = () => {
	const queryClient = useQueryClient();

	const { mutate, mutateAsync, isPending, variables } = useMutation({
		mutationFn: ({ id, locks }: { id: string; locks: CdrSyncLocks }) =>
			setProductSyncLocks(id, locks),
		onSuccess: (_data, vars) => {
			queryClient.invalidateQueries({ queryKey: ['admin-products'] });
			queryClient.invalidateQueries({ queryKey: ['products'] });
			queryClient.invalidateQueries({ queryKey: ['product'] });

			const paused = (['price', 'content', 'stock'] as const).filter(
				k => vars.locks[k] === true
			).length;
			toast.success(
				paused === 0
					? 'Este producto vuelve a sincronizarse entero con CDR'
					: `Sync de CDR actualizada (${paused} ${
							paused === 1 ? 'dato pausado' : 'datos pausados'
					  })`,
				{ position: 'bottom-right' }
			);
		},
		onError: () =>
			toast.error('No se pudieron guardar los candados de sync', {
				position: 'bottom-right',
			}),
	});

	return {
		setSyncLocks: mutate,
		setSyncLocksAsync: mutateAsync,
		isSettingSyncLocks: isPending,
		syncLocksVars: variables,
	};
};
