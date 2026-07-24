import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
	createSpecialCategory,
	deleteSpecialCategory,
	getActiveSpecialCategories,
	getSpecialCategories,
	getSpecialCategoryBySlug,
	getSpecialCategoryProductIds,
	setSpecialCategoryProducts,
	updateSpecialCategory,
} from '../../actions/specialCategories';

/** Todas las especiales (activas e inactivas). Panel de admin. */
export const useSpecialCategoriesAdmin = () => {
	const { data = [], isLoading } = useQuery({
		queryKey: ['special-categories', 'admin'],
		queryFn: getSpecialCategories,
	});
	return { specialCategories: data, isLoading };
};

/** Sólo las activas. Pills de la tienda. */
export const useActiveSpecialCategories = () => {
	const { data = [], isLoading } = useQuery({
		queryKey: ['special-categories', 'active'],
		queryFn: getActiveSpecialCategories,
		staleTime: 1000 * 60,
	});
	return { specialCategories: data, isLoading };
};

/** Ids de productos de una especial (para el picker del panel). */
export const useSpecialCategoryProductIds = (specialCategoryId?: string) => {
	const { data = [], isLoading } = useQuery({
		queryKey: ['special-category-products', specialCategoryId],
		queryFn: () => getSpecialCategoryProductIds(specialCategoryId!),
		enabled: !!specialCategoryId,
	});
	return { productIds: data, isLoading };
};

/**
 * Resuelve `?special=<slug>` en la tienda. Devuelve null mientras carga o si el
 * slug no existe / está apagado (la tienda ignora el filtro en ese caso).
 */
export const useSpecialCategoryBySlug = (slug: string) => {
	const { data, isLoading } = useQuery({
		queryKey: ['special-category-by-slug', slug],
		queryFn: () => getSpecialCategoryBySlug(slug),
		enabled: !!slug.trim(),
		staleTime: 1000 * 60,
	});
	return {
		specialCategory: data?.category ?? null,
		productIds: data?.productIds ?? null,
		isLoading: !!slug.trim() && isLoading,
	};
};

/* ----------------------------- MUTACIONES ---------------------------- */

const useInvalidateSpecials = () => {
	const qc = useQueryClient();
	return () => {
		qc.invalidateQueries({ queryKey: ['special-categories'] });
		qc.invalidateQueries({ queryKey: ['special-category-products'] });
		qc.invalidateQueries({ queryKey: ['special-category-by-slug'] });
	};
};

const onErr = (e: unknown) =>
	toast.error((e as Error).message || 'No se pudo guardar', {
		position: 'bottom-right',
	});

export const useSpecialCategoryMutations = () => {
	const invalidate = useInvalidateSpecials();

	const create = useMutation({
		mutationFn: createSpecialCategory,
		onSuccess: () => {
			invalidate();
			toast.success('Categoría especial creada', { position: 'bottom-right' });
		},
		onError: onErr,
	});

	const update = useMutation({
		mutationFn: updateSpecialCategory,
		onSuccess: invalidate,
		onError: onErr,
	});

	const remove = useMutation({
		mutationFn: deleteSpecialCategory,
		onSuccess: () => {
			invalidate();
			toast.success('Categoría especial eliminada', { position: 'bottom-right' });
		},
		onError: onErr,
	});

	const setProducts = useMutation({
		mutationFn: ({ id, productIds }: { id: string; productIds: string[] }) =>
			setSpecialCategoryProducts(id, productIds),
		onSuccess: invalidate,
		onError: onErr,
	});

	return { create, update, remove, setProducts };
};
