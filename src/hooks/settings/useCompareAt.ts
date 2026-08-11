import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
	getCompareAtConfig,
	updateCompareAtConfig,
} from '../../actions/pricing';
import { DEFAULT_COMPARE_AT } from '../../helpers';

/**
 * Configuración del precio "antes / ahora" de la vidriera.
 * Es sólo presentación: no toca el precio que se cobra ni el de Mercado Libre.
 */
export const useCompareAtConfig = () => {
	const { data } = useQuery({
		queryKey: ['compare_at_config'],
		queryFn: getCompareAtConfig,
		staleTime: 5 * 60_000,
	});
	return data ?? DEFAULT_COMPARE_AT;
};

export const useUpdateCompareAtConfig = () => {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: updateCompareAtConfig,
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['compare_at_config'] });
			toast.success('Precio "antes" actualizado', { position: 'bottom-right' });
		},
		onError: (e: Error) => toast.error(e.message, { position: 'bottom-right' }),
	});
};
