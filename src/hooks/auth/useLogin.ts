import { useMutation, useQueryClient } from '@tanstack/react-query';
import { signIn } from '../../actions';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

// redirectTo: a dónde volver después de entrar (ej. el checkout).
export const useLogin = (redirectTo = '/') => {
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const { mutate, isPending } = useMutation({
		mutationFn: signIn,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['user'] });
			navigate(redirectTo);
		},
		onError: err => {
			toast.error(err.message, {
				position: 'bottom-right',
			});
		},
	});

	return {
		mutate,
		isPending,
	};
};
