import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { setProductStockAlert } from '../../actions';

// Prende / apaga el aviso por mail de stock bajo en CDR para un producto.
export const useSetProductStockAlert = () => {
	const queryClient = useQueryClient();

	const { mutate, isPending } = useMutation({
		mutationFn: ({
			id,
			enabled,
			threshold,
		}: {
			id: string;
			enabled: boolean;
			threshold: number;
		}) => setProductStockAlert(id, enabled, threshold),
		onSuccess: (_data, vars) => {
			queryClient.invalidateQueries({ queryKey: ['product'] });
			queryClient.invalidateQueries({ queryKey: ['admin-products'] });
			toast.success(
				vars.enabled
					? `Aviso activado: te llega un mail cuando CDR tenga menos de ${vars.threshold}`
					: 'Aviso de stock desactivado',
				{ position: 'bottom-right' }
			);
		},
		onError: () =>
			toast.error('No se pudo guardar el aviso de stock', {
				position: 'bottom-right',
			}),
	});

	return { setStockAlert: mutate, isSettingStockAlert: isPending };
};
