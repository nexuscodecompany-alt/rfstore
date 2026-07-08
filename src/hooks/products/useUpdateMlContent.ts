import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { updateMlContent, type UpdateMlContentResult } from '../../actions/ml';

// Traduce los errores crudos de ml-update-content a mensajes claros para el cliente.
const friendlyError = (r?: UpdateMlContentResult): string => {
	const e = r?.error;
	if (!e) return 'No se pudo actualizar en Mercado Libre';
	if (e === 'item_moderated')
		return `Mercado Libre tiene esta publicación bajo revisión (${r?.ml_status ?? 'moderada'}); no se puede editar hasta que ML la libere.`;
	if (e === 'no_active_mapping') return 'Este producto no tiene una publicación activa en Mercado Libre';
	if (e.startsWith('product_not_found')) return 'No se encontró el producto';
	return `Mercado Libre: ${e}`;
};

// Actualiza (manual, uno por uno) el título + descripción de la publicación ML del
// producto, tomando el contenido actual de RF Store (que se sincroniza de CDR).
export const useUpdateMlContent = () => {
	const queryClient = useQueryClient();

	const { mutate, isPending, variables } = useMutation({
		mutationFn: ({ productId, variantId }: { productId: string; variantId?: string }) =>
			updateMlContent(productId, variantId),
		onSuccess: (data) => {
			if (data?.ok) {
				queryClient.invalidateQueries({ queryKey: ['admin-products'] });
				queryClient.invalidateQueries({ queryKey: ['ml-published'] });
				queryClient.invalidateQueries({ queryKey: ['content-dirty-count'] });
				toast.success('Título y descripción actualizados en ML ✅', { position: 'bottom-right' });
			} else if (data?.title_updated && !data?.description_updated) {
				queryClient.invalidateQueries({ queryKey: ['admin-products'] });
				toast.error('Se actualizó el título pero ML rechazó la descripción. Reintentá.', {
					position: 'bottom-right',
					duration: 7000,
				});
			} else if (!data?.title_updated && data?.description_updated) {
				queryClient.invalidateQueries({ queryKey: ['admin-products'] });
				toast.error('Se actualizó la descripción pero ML no dejó cambiar el título (suele pasar si ya tuvo ventas).', {
					position: 'bottom-right',
					duration: 8000,
				});
			} else {
				toast.error(friendlyError(data), { position: 'bottom-right', duration: 7000 });
			}
		},
		onError: (err: Error) =>
			toast.error(err.message || 'No se pudo actualizar en ML', {
				position: 'bottom-right',
				duration: 6000,
			}),
	});

	return { updateContent: mutate, isUpdatingContent: isPending, updatingContentVars: variables };
};
