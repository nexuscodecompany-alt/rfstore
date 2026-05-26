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
		onError: error => {
			console.log(error);
			toast.error('Ocurrió un error al eliminar el producto', {
				position: 'bottom-right',
			});
		},
	});

	return {
		mutate,
		isPending,
	};
};
