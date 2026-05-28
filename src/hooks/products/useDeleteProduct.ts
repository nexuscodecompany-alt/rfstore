import { useMutation, useQueryClient } from '@tanstack/react-query';
import { deleteProduct } from '../../actions';
import toast from 'react-hot-toast';

export const useDeleteProduct = () => {
	const queryClient = useQueryClient();

	const { mutate, isPending } = useMutation({
		mutationFn: deleteProduct,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['products'] });
			queryClient.invalidateQueries({ queryKey: ['admin-products'] });
			toast.success('Producto eliminado correctamente', {
				position: 'bottom-right',
			});
		},
		onError: (error: Error) => {
			console.error(error);
			toast.error(`No se pudo eliminar: ${error.message}`, {
				position: 'bottom-right',
			});
		},
	});

	return {
		mutate,
		isPending,
	};
};
