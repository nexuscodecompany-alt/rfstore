import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { setProductActive } from '../../actions';

// Activa / inactiva un producto y refresca el listado del admin y la tienda.
export const useSetProductActive = () => {
	const queryClient = useQueryClient();

	const { mutate, isPending } = useMutation({
		mutationFn: ({ id, active }: { id: string; active: boolean }) =>
			setProductActive(id, active),
		onSuccess: (_data, vars) => {
			queryClient.invalidateQueries({ queryKey: ['admin-products'] });
			queryClient.invalidateQueries({ queryKey: ['products'] });
			toast.success(
				vars.active ? 'Producto activado' : 'Producto inactivado',
				{ position: 'bottom-right' }
			);
		},
		onError: () =>
			toast.error('No se pudo cambiar el estado del producto', {
				position: 'bottom-right',
			}),
	});

	return { mutate, isPending };
};
