import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateOrderStatus } from '../../actions';
import toast from 'react-hot-toast';

export const useChangeStatusOrder = () => {
	const queryClient = useQueryClient();

	const { mutate, isPending } = useMutation({
		mutationFn: updateOrderStatus,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['orders', 'admin'] });
			// Cancelar/reactivar mueve stock y cambia las métricas.
			queryClient.invalidateQueries({ queryKey: ['order', 'admin'] });
			queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });
			queryClient.invalidateQueries({ queryKey: ['admin-products'] });
			queryClient.invalidateQueries({ queryKey: ['products'] });
		},
		onError: error => {
			console.log(error);
			toast.error('No se pudo actualizar el estado de la orden', {
				position: 'bottom-right',
			});
		},
	});

	return {
		mutate,
		isPending,
	};
};
