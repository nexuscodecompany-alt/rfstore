import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { buildProductsCsv, getProductsReport } from '../../actions/product';

// Descarga del catálogo completo en CSV (botón "Descargar CSV" del listado de productos).
// El armado del archivo es local: la RPC sólo devuelve los datos.
export const useExportProducts = () => {
	const { mutate, isPending } = useMutation({
		mutationFn: async () => {
			const rows = await getProductsReport();
			if (!rows.length) throw new Error('No hay productos para exportar');

			const csv = buildProductsCsv(rows);
			// El blob se declara UTF-8 para que Excel respete el BOM y no rompa los acentos.
			const url = URL.createObjectURL(
				new Blob([csv], { type: 'text/csv;charset=utf-8;' })
			);
			const hoy = new Date().toISOString().slice(0, 10);

			const link = document.createElement('a');
			link.href = url;
			link.download = `rfstore-productos-${hoy}.csv`;
			document.body.appendChild(link);
			link.click();
			link.remove();
			// Sin esto el navegador se queda con el archivo en memoria hasta recargar.
			URL.revokeObjectURL(url);

			return rows.length;
		},
		onSuccess: total => toast.success(`${total} productos exportados`),
		onError: (e: Error) =>
			toast.error(
				e.message === 'solo_admin'
					? 'Necesitás permisos de administrador'
					: `No se pudo exportar: ${e.message}`
			),
	});

	return { exportCsv: mutate, isExporting: isPending };
};
