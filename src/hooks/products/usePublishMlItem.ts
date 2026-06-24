import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { publishMlItem, type PublishResult } from '../../actions/ml';

// Traduce los códigos de error crudos de la edge function ml-publish-item a mensajes
// claros para el cliente. (El detalle técnico igual queda logueado en ml_webhook_events.)
const friendlyMlError = (e?: string): string => {
	if (!e) return 'No se pudo publicar en Mercado Libre';
	if (e.startsWith('product_inactive')) return 'Activá el producto antes de publicarlo en ML';
	if (e.startsWith('stock_below_threshold')) return 'El producto no tiene stock suficiente para publicar en ML';
	if (e.startsWith('invalid_price_usd')) return 'El producto no tiene un costo válido para calcular el precio';
	if (e.startsWith('no_pictures')) return 'El producto no tiene imágenes para publicar';
	if (e.startsWith('picture_upload_failed')) return 'No se pudieron subir las imágenes a Mercado Libre';
	if (e === 'ml_publish_failed') return 'Mercado Libre rechazó la publicación (revisá título, categoría o el estado de tu cuenta ML)';
	if (e.startsWith('no_ml_credentials')) return 'No hay una cuenta de Mercado Libre conectada';
	return `Mercado Libre: ${e}`;
};

// Publica UN producto en Mercado Libre (manual, uno por uno) a través de la edge
// function ml-publish-item. Refresca el listado del admin para que la fila pase a
// "En Mercado Libre". El motivo real de ML (si rechaza) se muestra en el toast.
export const usePublishMlItem = () => {
	const queryClient = useQueryClient();

	const { mutate, isPending, variables } = useMutation({
		mutationFn: ({ productId, variantId }: { productId: string; variantId: string }) =>
			publishMlItem(productId, variantId) as Promise<PublishResult>,
		onSuccess: (data) => {
			if (data?.ok) {
				queryClient.invalidateQueries({ queryKey: ['admin-products'] });
				queryClient.invalidateQueries({ queryKey: ['ml-published'] });
				toast.success('Publicado en Mercado Libre ✅', { position: 'bottom-right' });
			} else if (
				data?.error === 'missing_required_attributes' &&
				Array.isArray(data.missing_attributes) &&
				data.missing_attributes.length > 0
			) {
				const names = data.missing_attributes.map((a) => a.name).join(', ');
				toast.error(
					`Mercado Libre pide estos datos de la categoría: ${names}. Agregalos en el nombre o la descripción del producto y reintentá.`,
					{ position: 'bottom-right', duration: 9000 }
				);
			} else {
				toast.error(friendlyMlError(data?.error), {
					position: 'bottom-right',
					duration: 6000,
				});
			}
		},
		onError: (err: Error) =>
			toast.error(err.message || 'No se pudo publicar en ML', {
				position: 'bottom-right',
				duration: 6000,
			}),
	});

	return { publish: mutate, isPublishing: isPending, publishingVars: variables };
};
