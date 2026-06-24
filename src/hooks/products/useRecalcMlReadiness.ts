import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { recalcMlReadiness, recalcMlReadinessIds } from '../../actions/ml';

// Recalcula el "% listo para ML" real (pregunta a ML categoría + atributos) y lo guarda.
// Manual: por producto (productId) o por lote (productIds, ej. la página visible).
export const useRecalcMlReadiness = () => {
	const queryClient = useQueryClient();

	const { mutate, isPending, variables } = useMutation({
		mutationFn: (vars: { productId?: string; productIds?: string[] }) =>
			vars.productIds && vars.productIds.length > 0
				? recalcMlReadinessIds(vars.productIds)
				: recalcMlReadiness(vars.productId as string),
		onSuccess: (_data, vars) => {
			queryClient.invalidateQueries({ queryKey: ['admin-products'] });
			toast.success(
				vars.productIds ? '% actualizado en la página' : '% actualizado',
				{ position: 'bottom-right' }
			);
		},
		onError: (err: Error) =>
			toast.error(err.message || 'No se pudo recalcular el %', {
				position: 'bottom-right',
			}),
	});

	return { recalc: mutate, isRecalculating: isPending, recalcVars: variables };
};
