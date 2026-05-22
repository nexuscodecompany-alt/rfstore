import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
	assignCdrProductTaxonomy,
	getAppSettings,
	getBrands,
	getCategories,
	getUnclassifiedCdrProducts,
	triggerCdrSync,
	updateAppSetting,
	type SyncReport,
} from '../../actions';
import toast from 'react-hot-toast';

export const DashboardCdrSyncPage = () => {
	const queryClient = useQueryClient();
	const [lastReport, setLastReport] = useState<SyncReport | null>(null);
	const [globalMarkup, setGlobalMarkup] = useState<number>(20);

	const { data: settings } = useQuery({
		queryKey: ['app_settings'],
		queryFn: getAppSettings,
	});

	const { data: brands = [] } = useQuery({ queryKey: ['brands'], queryFn: getBrands });
	const { data: categories = [] } = useQuery({
		queryKey: ['categories'],
		queryFn: getCategories,
	});

	const { data: unclassified = [], isLoading: loadingUnclassified } = useQuery({
		queryKey: ['cdr_unclassified'],
		queryFn: getUnclassifiedCdrProducts,
	});

	useEffect(() => {
		if (settings) {
			const m = settings.get('cdr_markup_percent_global');
			if (m != null) setGlobalMarkup(Number(m));
		}
	}, [settings]);

	const { mutate: doSync, isPending: syncing } = useMutation({
		mutationFn: (full: boolean) => triggerCdrSync(full),
		onSuccess: (report: SyncReport) => {
			setLastReport(report);
			if (report.ok) toast.success(`Sync OK: ${report.inserted} nuevos, ${report.updated} actualizados`);
			else toast.error(`Sync con errores (${report.errors.length})`);
			queryClient.invalidateQueries({ queryKey: ['cdr_unclassified'] });
			queryClient.invalidateQueries({ queryKey: ['products'] });
		},
		onError: (e: Error) => toast.error(`Falló sync: ${e.message}`),
	});

	const { mutate: saveMarkup, isPending: savingMarkup } = useMutation({
		mutationFn: () => updateAppSetting('cdr_markup_percent_global', globalMarkup),
		onSuccess: () => toast.success('Márgen global guardado'),
		onError: (e: Error) => toast.error(e.message),
	});

	const { mutate: assign } = useMutation({
		mutationFn: ({
			id,
			brand_id,
			category_id,
		}: {
			id: string;
			brand_id?: string;
			category_id?: string;
		}) => assignCdrProductTaxonomy(id, { brand_id, category_id }),
		onSuccess: () => {
			toast.success('Asignado');
			queryClient.invalidateQueries({ queryKey: ['cdr_unclassified'] });
		},
		onError: (e: Error) => toast.error(e.message),
	});

	return (
		<div className='flex flex-col gap-8'>
			<h1 className='text-xl font-bold'>Integración CDR</h1>

			<section className='p-5 bg-amber-50 border border-amber-300 rounded-lg space-y-3'>
				<h2 className='font-semibold'>Habilitación de pagos online</h2>
				<p className='text-sm text-gray-700'>
					Mientras esté apagado, los productos CDR aparecen en el catálogo pero el
					checkout se hace por WhatsApp (cotización). Encendelo cuando hayas terminado
					de configurar márgenes, categorías y datos de pago.
				</p>
				<label className='flex items-center gap-3 cursor-pointer'>
					<input
						type='checkbox'
						checked={settings?.get('payments_enabled') === true}
						onChange={async e => {
							await updateAppSetting('payments_enabled', e.target.checked);
							toast.success(
								e.target.checked
									? 'Pagos online ACTIVADOS'
									: 'Pagos online desactivados'
							);
							queryClient.invalidateQueries({ queryKey: ['app_settings'] });
							queryClient.invalidateQueries({ queryKey: ['feature_flag', 'payments_enabled'] });
						}}
					/>
					<span className='font-medium'>Activar pagos online (MercadoPago / transferencia / depósito)</span>
				</label>
			</section>

			<section className='p-5 bg-white border border-gray-200 rounded-lg space-y-4'>
				<h2 className='font-semibold'>Sincronización</h2>
				<p className='text-sm text-gray-600'>
					Última fecha de sync: {String(settings?.get('cdr_last_full_sync') ?? '—')}
				</p>
				<div className='flex gap-3 flex-wrap'>
					<button
						className='px-4 py-2 bg-stone-800 text-white rounded-md disabled:opacity-50'
						disabled={syncing}
						onClick={() => doSync(false)}
					>
						{syncing ? 'Sincronizando…' : 'Sync incremental'}
					</button>
					<button
						className='px-4 py-2 border border-stone-800 rounded-md disabled:opacity-50'
						disabled={syncing}
						onClick={() => doSync(true)}
					>
						Sync completo (desde 2015)
					</button>
				</div>
				{lastReport && (
					<pre className='text-xs bg-gray-50 p-3 rounded overflow-auto'>
						{JSON.stringify(lastReport, null, 2)}
					</pre>
				)}
			</section>

			<section className='p-5 bg-white border border-gray-200 rounded-lg space-y-3'>
				<h2 className='font-semibold'>Márgen global (%)</h2>
				<p className='text-sm text-gray-600'>
					Se aplica al precio USD del WS. Cada producto puede tener su propio márgen
					override.
				</p>
				<div className='flex gap-2 items-center'>
					<input
						type='number'
						className='border rounded px-3 py-2 w-32'
						value={globalMarkup}
						onChange={e => setGlobalMarkup(Number(e.target.value))}
					/>
					<button
						className='px-4 py-2 bg-stone-800 text-white rounded-md disabled:opacity-50'
						disabled={savingMarkup}
						onClick={() => saveMarkup()}
					>
						Guardar
					</button>
				</div>
			</section>

			<section className='p-5 bg-white border border-gray-200 rounded-lg space-y-3'>
				<h2 className='font-semibold'>
					Productos CDR sin clasificar ({unclassified.length})
				</h2>
				{loadingUnclassified ? (
					<p>Cargando…</p>
				) : unclassified.length === 0 ? (
					<p className='text-sm text-gray-500'>
						No hay productos pendientes de clasificación.
					</p>
				) : (
					<div className='overflow-auto'>
						<table className='min-w-full text-sm'>
							<thead className='bg-gray-50 text-left'>
								<tr>
									<th className='p-2'>Imagen</th>
									<th className='p-2'>Código</th>
									<th className='p-2'>Nombre</th>
									<th className='p-2'>Precio USD</th>
									<th className='p-2'>Marca</th>
									<th className='p-2'>Categoría</th>
								</tr>
							</thead>
							<tbody>
								{unclassified.map(p => (
									<tr key={p.id} className='border-t'>
										<td className='p-2'>
											{p.images?.[0] && (
												<img
													src={p.images[0]}
													alt={p.name}
													className='w-12 h-12 object-cover rounded'
												/>
											)}
										</td>
										<td className='p-2 font-mono text-xs'>{p.external_code}</td>
										<td className='p-2'>{p.name}</td>
										<td className='p-2'>${p.price_usd}</td>
										<td className='p-2'>
											<select
												className='border rounded px-2 py-1 text-xs'
												value={p.brand_id ?? ''}
												onChange={e =>
													assign({ id: p.id, brand_id: e.target.value })
												}
											>
												{brands.map(b => (
													<option key={b.id} value={b.id}>
														{b.name}
													</option>
												))}
											</select>
										</td>
										<td className='p-2'>
											<select
												className='border rounded px-2 py-1 text-xs'
												value={p.category_id ?? ''}
												onChange={e =>
													assign({
														id: p.id,
														category_id: e.target.value,
													})
												}
											>
												{categories.map(c => (
													<option key={c.id} value={c.id}>
														{c.name}
													</option>
												))}
											</select>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>
		</div>
	);
};
