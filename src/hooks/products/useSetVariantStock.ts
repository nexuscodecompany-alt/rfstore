import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { setVariantStock } from '../../actions';

// Edita el stock de una variante a mano. Si el producto está publicado en Mercado
// Libre, el trigger de la base encola el cambio y la publicación se actualiza sola
// (y se reactiva si ML la había pausado por falta de stock).
export const useSetVariantStock = () => {
	const queryClient = useQueryClient();

	const { mutate, isPending, variables } = useMutation({
		mutationFn: ({ variantId, stock }: { variantId: string; stock: number }) =>
			setVariantStock(variantId, stock),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['admin-products'] });
			queryClient.invalidateQueries({ queryKey: ['products'] });
			toast.success('Stock actualizado', { position: 'bottom-right' });
		},
		onError: () =>
			toast.error('No se pudo actualizar el stock', {
				position: 'bottom-right',
			}),
	});

	return {
		setStock: mutate,
		isSettingStock: isPending,
		stockVars: variables,
	};
};
