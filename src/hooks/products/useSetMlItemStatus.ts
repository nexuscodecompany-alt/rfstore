import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { setMlItemStatus, type MlItemActivateResult } from '../../actions/ml';

// Traduce la respuesta cruda a un mensaje que se entienda en el panel.
const friendlyError = (r?: MlItemActivateResult): string => {
	const e = r?.error;
	if (!e) return 'No se pudo cambiar el estado en Mercado Libre';
	if (e === 'item_moderated')
		return `Mercado Libre tiene la publicación en revisión (${
			r?.sub_status?.join(', ') || r?.ml_status
		}). Activarla no sirve hasta que ML la libere: entrá a la publicación en ML y corregí lo que te pide.`;
	if (e === 'no_stock')
		return 'El producto está en 0 en RF Store. Cargale stock antes de activar la publicación.';
	if (e === 'no_active_mapping')
		return 'Este producto no tiene una publicación vinculada en Mercado Libre';
	if (e === 'not_applied')
		return `Mercado Libre aceptó el pedido pero dejó la publicación en "${r?.ml_status}". Suele pasar cuando la tiene en revisión.`;
	return `Mercado Libre: ${e}`;
};

// Activa / pausa a mano la publicación de ML de un producto (botón del panel).
export const useSetMlItemStatus = () => {
	const queryClient = useQueryClient();

	const { mutate, isPending, variables } = useMutation({
		mutationFn: ({
			productId,
			action,
			variantId,
		}: {
			productId: string;
			action: 'activate' | 'pause';
			variantId?: string;
		}) => setMlItemStatus(productId, action, variantId),
		onSuccess: (data, vars) => {
			if (data?.ok) {
				queryClient.invalidateQueries({ queryKey: ['admin-products'] });
				queryClient.invalidateQueries({ queryKey: ['ml-published'] });
				toast.success(
					vars.action === 'pause'
						? 'Publicación pausada en ML'
						: `Publicación activa en ML con ${data.available_quantity ?? data.stock} unidades ✅`,
					{ position: 'bottom-right', duration: 6000 }
				);
			} else {
				toast.error(friendlyError(data), {
					position: 'bottom-right',
					duration: 9000,
				});
			}
		},
		onError: (err: Error) =>
			toast.error(err.message || 'No se pudo cambiar el estado en ML', {
				position: 'bottom-right',
				duration: 6000,
			}),
	});

	return {
		setMlStatus: mutate,
		isSettingMlStatus: isPending,
		mlStatusVars: variables,
	};
};
