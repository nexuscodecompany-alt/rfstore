import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { setProductStockLocked } from '../../actions';

// Prende / apaga el candado de STOCK: cuando está prendido, el sync de CDR no pisa
// el stock de las variantes de ese producto (RF tiene mercadería propia aunque CDR
// esté en 0 o el producto haya salido del feed). El precio se sigue sincronizando.
export const useSetProductStockLocked = () => {
	const queryClient = useQueryClient();

	const { mutate, isPending, variables } = useMutation({
		mutationFn: ({ id, locked }: { id: string; locked: boolean }) =>
			setProductStockLocked(id, locked),
		onSuccess: (_data, vars) => {
			queryClient.invalidateQueries({ queryKey: ['admin-products'] });
			queryClient.invalidateQueries({ queryKey: ['products'] });
			toast.success(
				vars.locked
					? 'Stock manual: CDR ya no lo va a pisar'
					: 'Stock automático: vuelve a mandar CDR',
				{ position: 'bottom-right' }
			);
		},
		onError: () =>
			toast.error('No se pudo cambiar el candado de stock', {
				position: 'bottom-right',
			}),
	});

	return {
		setStockLocked: mutate,
		isSettingStockLock: isPending,
		stockLockVars: variables,
	};
};
