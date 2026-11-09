import { useMutation, useQueryClient } from '@tanstack/react-query';
import { notifyOrderCancelled, updateOrderStatus } from '../../actions';
import toast from 'react-hot-toast';

export const useChangeStatusOrder = () => {
	const queryClient = useQueryClient();

	const { mutate, isPending } = useMutation({
		mutationFn: updateOrderStatus,
		onSuccess: (_data, vars) => {
			// Cancelado por el admin: se le avisa al cliente por mail (el servidor
			// decide si corresponde y no repite el aviso).
			if (['cancelado', 'rechazado', 'expirado', 'cancelled'].includes(vars.status.toLowerCase())) {
				notifyOrderCancelled(vars.id)
					.then(r => {
						if (r.sent) toast.success(`Pedido #${vars.id}: le avisamos al cliente (${r.to}).`, { position: 'bottom-right' });
					})
					.catch(e =>
						toast.error(`Pedido #${vars.id}: no se pudo avisar al cliente (${(e as Error).message}).`, { position: 'bottom-right' })
					);
			}
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
