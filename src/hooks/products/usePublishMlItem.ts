import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { publishMlItem, type PublishResult, type MlMissingAttr, type MlAttrInput } from '../../actions/ml';

// Traduce los códigos de error crudos de la edge function ml-publish-item a mensajes
// claros para el cliente. (El detalle técnico igual queda logueado en ml_webhook_events.)
const friendlyMlError = (e?: string): string => {
	if (!e) return 'No se pudo publicar en Mercado Libre';
	if (e.startsWith('product_inactive')) return 'Activá el producto antes de publicarlo en ML';
	if (e.startsWith('stock_below_threshold')) return 'El producto no tiene stock suficiente para publicar en ML';
	if (e.startsWith('invalid_price_usd')) return 'El producto no tiene un costo válido para calcular el precio';
	if (e.startsWith('no_pictures')) return 'El producto no tiene imágenes para publicar';
	if (e.startsWith('picture_upload_failed')) return 'No se pudieron subir las imágenes a Mercado Libre';
	if (e === 'ml_publish_failed') return 'Mercado Libre rechazó la publicación (revisá los datos que pide la categoría)';
	if (e.startsWith('no_ml_credentials')) return 'No hay una cuenta de Mercado Libre conectada';
	return `Mercado Libre: ${e}`;
};

interface PublishVars {
	productId: string;
	variantId: string;
	extraAttributes?: MlAttrInput[];
}

interface UsePublishMlItemOpts {
	// ML rechazó porque faltan atributos obligatorios: el front muestra un form para cargarlos.
	onNeedAttributes?: (p: { productId: string; variantId: string; missing: MlMissingAttr[] }) => void;
	// Se publicó OK (para cerrar el form si estaba abierto).
	onPublished?: () => void;
}

// Publica UN producto en Mercado Libre (manual, uno por uno) a través de la edge function
// ml-publish-item. Si ML pide atributos que no pudimos completar solos, avisa vía
// onNeedAttributes para que el admin los cargue a mano y reintente con extraAttributes.
export const usePublishMlItem = (opts: UsePublishMlItemOpts = {}) => {
	const queryClient = useQueryClient();

	const { mutate, isPending, variables } = useMutation({
		mutationFn: ({ productId, variantId, extraAttributes }: PublishVars) =>
			publishMlItem(productId, variantId, { extra_attributes: extraAttributes }) as Promise<PublishResult>,
		onSuccess: (data, vars) => {
			if (data?.ok) {
				queryClient.invalidateQueries({ queryKey: ['admin-products'] });
				queryClient.invalidateQueries({ queryKey: ['ml-published'] });
				toast.success('Publicado en Mercado Libre ✅', { position: 'bottom-right' });
				opts.onPublished?.();
				return;
			}
			// ML pide atributos obligatorios que faltan -> abrimos el form manual.
			if (Array.isArray(data?.missing_attributes) && data.missing_attributes.length > 0) {
				opts.onNeedAttributes?.({
					productId: vars.productId,
					variantId: vars.variantId,
					missing: data.missing_attributes,
				});
				return;
			}
			toast.error(friendlyMlError(data?.error), { position: 'bottom-right', duration: 6000 });
		},
		onError: (err: Error) =>
			toast.error(err.message || 'No se pudo publicar en ML', {
				position: 'bottom-right',
				duration: 6000,
			}),
	});

	return { publish: mutate, isPublishing: isPending, publishingVars: variables };
};
