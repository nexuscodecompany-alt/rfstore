import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateProduct } from '../../actions';
import { ProductInput } from '../../interfaces';
import toast from 'react-hot-toast';
import { useLocation, useNavigate } from 'react-router-dom';

export const useUpdateProduct = (productId: string) => {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const location = useLocation();
	// El listado nos pasa su URL con los filtros puestos (state.from). Al guardar
	// volvemos ahí y no al listado pelado: antes el admin editaba la categoría de
	// un producto y volvía a la lista sin filtros, sin página y sin orden.
	const backTo =
		(location.state as { from?: string } | null)?.from ?? '/dashboard/productos';

	const { mutate, isPending } = useMutation({
		mutationFn: async (data: ProductInput) =>
			updateProduct(productId, data),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['products'] });
			queryClient.invalidateQueries({ queryKey: ['admin-products'] });
			queryClient.invalidateQueries({ queryKey: ['product'] });
			toast.success('Producto actualizado', {
				position: 'bottom-right',
			});
			navigate(backTo);
		},
		onError: error => {
			console.log(error);
			toast.error('Ocurrió un error al actualizar el producto', {
				position: 'bottom-right',
			});
		},
	});

	return {
		mutate,
		isPending,
	};
};
