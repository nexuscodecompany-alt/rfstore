import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
	getHomeConfig,
	updateHomeConfig,
	getCategoryThumbnails,
	DEFAULT_HOME_CONFIG,
	type HomeConfig,
} from '../../actions/homeConfig';

/** Lectura pública de la config de la home (usada por el header y la home). */
export const useHomeConfig = () => {
	const { data, isLoading, isError } = useQuery({
		queryKey: ['home-config'],
		queryFn: getHomeConfig,
		staleTime: 1000 * 60, // 1 min
	});

	return {
		config: data ?? DEFAULT_HOME_CONFIG,
		isLoading,
		isError,
	};
};

/** Imagen representativa (de un producto) por cada categoría. */
export const useCategoryThumbnails = (categoryIds: string[]) => {
	const key = [...categoryIds].sort().join(',');
	return useQuery({
		queryKey: ['category-thumbnails', key],
		queryFn: () => getCategoryThumbnails(categoryIds),
		enabled: categoryIds.length > 0,
		staleTime: 1000 * 60 * 5,
	});
};

/** Mutación para guardar la config desde el admin. */
export const useUpdateHomeConfig = () => {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (patch: Partial<HomeConfig>) => updateHomeConfig(patch),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['home-config'] });
			toast.success('Home actualizada', { position: 'bottom-right' });
		},
		onError: (e: unknown) =>
			toast.error((e as Error).message || 'No se pudo guardar', {
				position: 'bottom-right',
			}),
	});
};
