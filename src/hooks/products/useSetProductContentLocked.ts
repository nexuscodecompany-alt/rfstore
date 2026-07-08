import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { setProductContentLocked } from '../../actions';

// Prende / apaga el candado de contenido: cuando está prendido, el sync de CDR no pisa
// nombre/descripción/features de ese producto (protege ediciones manuales del admin).
export const useSetProductContentLocked = () => {
	const queryClient = useQueryClient();

	const { mutate, isPending, variables } = useMutation({
		mutationFn: ({ id, locked }: { id: string; locked: boolean }) =>
			setProductContentLocked(id, locked),
		onSuccess: (_data, vars) => {
			queryClient.invalidateQueries({ queryKey: ['admin-products'] });
			toast.success(
				vars.locked
					? 'Contenido bloqueado: CDR no lo va a pisar'
					: 'Contenido desbloqueado: CDR puede actualizarlo',
				{ position: 'bottom-right' }
			);
		},
		onError: () =>
			toast.error('No se pudo cambiar el candado de contenido', {
				position: 'bottom-right',
			}),
	});

	return { setContentLocked: mutate, isSettingLock: isPending, lockVars: variables };
};
