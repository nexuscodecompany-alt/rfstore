import {
	useMutation,
	useQuery,
	useQueryClient,
} from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
	createManualSale,
	createSaleConcept,
	deleteManualSale,
	deleteSaleConcept,
	getManualSales,
	getSaleConcepts,
	type ManualSaleInput,
} from '../../actions';

/* ------------------------------ Conceptos ------------------------------ */
export const useSaleConcepts = () =>
	useQuery({ queryKey: ['sale_concepts'], queryFn: getSaleConcepts });

export const useCreateSaleConcept = () => {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ name, color }: { name: string; color?: string | null }) =>
			createSaleConcept(name, color),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['sale_concepts'] });
			toast.success('Concepto creado');
		},
		onError: (e: Error) => toast.error(e.message),
	});
};

export const useDeleteSaleConcept = () => {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => deleteSaleConcept(id),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['sale_concepts'] });
			toast.success('Concepto eliminado');
		},
		onError: (e: Error) => toast.error(e.message),
	});
};

/* ---------------------------- Ventas manuales ---------------------------- */
export const useManualSales = (conceptId?: string | null) =>
	useQuery({
		queryKey: ['manual_sales', conceptId ?? 'all'],
		queryFn: () => getManualSales(conceptId),
	});

export const useCreateManualSale = () => {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: ManualSaleInput) => createManualSale(input),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['manual_sales'] });
			qc.invalidateQueries({ queryKey: ['orders', 'admin'] });
			qc.invalidateQueries({ queryKey: ['dashboard-metrics'] });
			// El stock pudo cambiar (ventas con producto vinculado).
			qc.invalidateQueries({ queryKey: ['admin-products'] });
			qc.invalidateQueries({ queryKey: ['products'] });
			toast.success('Venta registrada');
		},
		onError: (e: Error) => toast.error(e.message),
	});
};

export const useDeleteManualSale = () => {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (id: number) => deleteManualSale(id),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['manual_sales'] });
			qc.invalidateQueries({ queryKey: ['orders', 'admin'] });
			qc.invalidateQueries({ queryKey: ['dashboard-metrics'] });
			// El stock pudo cambiar (ventas con producto vinculado).
			qc.invalidateQueries({ queryKey: ['admin-products'] });
			qc.invalidateQueries({ queryKey: ['products'] });
			toast.success('Venta eliminada');
		},
		onError: (e: Error) => toast.error(e.message),
	});
};
