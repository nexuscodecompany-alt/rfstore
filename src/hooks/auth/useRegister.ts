import { useMutation, useQueryClient } from '@tanstack/react-query';
import { signUp } from '../../actions';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

// redirectTo: a dónde volver después de registrarse (ej. el checkout).
export const useRegister = (redirectTo = '/') => {
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const { mutate, isPending } = useMutation({
		mutationFn: signUp,
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
