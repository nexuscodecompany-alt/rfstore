import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
	buildMlAuthUrl,
	disconnectMl,
	getMlCredential,
	getMlSettings,
	getMlStats,
	updateMlSetting,
	getPublishablePending,
	getMlPublishedItems,
	publishMlItem,
	getQueueStats,
	enqueuePublishBatch,
	triggerPublishQueueNow,
	type DryRunResult,
	type PublishResult,
	type PublishablePendingRow,
	type MlPublishedItem,
} from '../../actions/ml';

const formatDate = (iso: string): string => {
	try {
		return new Date(iso).toLocaleString('es-UY');
	} catch {
		return iso;
	}
};

export const DashboardMercadoLibrePage = () => {
	const queryClient = useQueryClient();
	const [searchParams, setSearchParams] = useSearchParams();

	const status = searchParams.get('status');
	const error = searchParams.get('error');
	const nickname = searchParams.get('nickname');

	const { data: credential, isLoading: loadingCred } = useQuery({
		queryKey: ['ml_credential'],
		queryFn: getMlCredential,
	});

	const { data: settings } = useQuery({
		queryKey: ['ml_settings'],
		queryFn: getMlSettings,
	});

	const { data: stats } = useQuery({
		queryKey: ['ml_stats'],
		queryFn: getMlStats,
		enabled: !!credential,
	});

	const [markup, setMarkup] = useState<number>(30);
	const [threshold, setThreshold] = useState<number>(3);
	const [warrantyMonths, setWarrantyMonths] = useState<number>(6);

	useEffect(() => {
		if (settings) {
			setMarkup(settings.markup_percent);
			setThreshold(settings.stock_threshold);
			setWarrantyMonths(settings.warranty_months_default);
		}
	}, [settings]);

	// Toast del retorno OAuth y limpiar query
	useEffect(() => {
		if (status === 'connected') {
			toast.success(`Cuenta ML conectada${nickname ? `: ${nickname}` : ''}`);
			queryClient.invalidateQueries({ queryKey: ['ml_credential'] });
			setSearchParams({}, { replace: true });
		} else if (status === 'error') {
			toast.error(`Falló la conexión con ML: ${error ?? 'desconocido'}`);
			setSearchParams({}, { replace: true });
		}
	}, [status, error, nickname, queryClient, setSearchParams]);

	const { mutate: connect } = useMutation({
		mutationFn: buildMlAuthUrl,
		onSuccess: (url: string) => {
			window.location.href = url;
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const { mutate: disconnect, isPending: disconnecting } = useMutation({
		mutationFn: disconnectMl,
		onSuccess: () => {
			toast.success('Cuenta ML desconectada');
			queryClient.invalidateQueries({ queryKey: ['ml_credential'] });
			queryClient.invalidateQueries({ queryKey: ['ml_stats'] });
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const { mutate: saveSettings, isPending: saving } = useMutation({
		mutationFn: async () => {
			await updateMlSetting('markup_percent', markup);
			await updateMlSetting('stock_threshold', threshold);
			await updateMlSetting('warranty_months_default', warrantyMonths);
		},
		onSuccess: () => {
			toast.success('Configuración guardada');
			queryClient.invalidateQueries({ queryKey: ['ml_settings'] });
		},
		onError: (e: Error) => toast.error(e.message),
	});

	return (
		<div className='flex flex-col gap-8'>
			<h1 className='text-xl font-bold'>Integración Mercado Libre</h1>

			{/* --- CONEXIÓN --- */}
			<section className='p-5 bg-white border border-gray-200 rounded-lg space-y-3'>
				<h2 className='font-semibold'>Conexión con la cuenta ML</h2>
				{loadingCred ? (
					<p className='text-sm text-gray-500'>Cargando…</p>
				) : credential ? (
					<div className='space-y-2'>
						<p className='text-sm text-emerald-700 font-medium'>
							✓ Conectado como <b>{credential.ml_nickname ?? `usuario ${credential.ml_user_id}`}</b>
						</p>
						<p className='text-xs text-gray-500'>
							User ID: <span className='font-mono'>{credential.ml_user_id}</span> · Token expira: {formatDate(credential.expires_at)}
						</p>
						<button
							onClick={() => {
								if (confirm('¿Desconectar la cuenta ML? Las publicaciones existentes no se borran pero el sync se detiene.')) {
									disconnect();
								}
							}}
							disabled={disconnecting}
							className='px-4 py-2 border border-red-300 text-red-700 rounded-md text-sm disabled:opacity-50'
						>
							{disconnecting ? 'Desconectando…' : 'Desconectar cuenta'}
						</button>
					</div>
				) : (
					<div className='space-y-3'>
						<p className='text-sm text-gray-600'>
							Conectá tu cuenta vendedor de Mercado Libre Uruguay (MLU) para empezar a publicar y sincronizar stock.
						</p>
						<button
							onClick={() => connect()}
							className='px-4 py-2 bg-yellow-400 hover:bg-yellow-500 text-stone-900 font-semibold rounded-md text-sm'
						>
							Conectar Mercado Libre
						</button>
					</div>
				)}
			</section>

			{/* --- STATS --- */}
			{credential && stats && (
				<section className='p-5 bg-white border border-gray-200 rounded-lg space-y-3'>
					<h2 className='font-semibold'>Estado de publicaciones</h2>
					<div className='grid grid-cols-2 md:grid-cols-5 gap-3'>
						<Stat label='Activas' value={stats.published} color='emerald' />
						<Stat label='Pausadas' value={stats.paused} color='amber' />
						<Stat label='Cerradas' value={stats.closed} color='gray' />
						<Stat label='Con error' value={stats.error} color='red' />
						<Stat label='Celulares publicables' value={stats.publishable_celulares} color='brand' />
					</div>
				</section>
			)}

			{/* --- SETTINGS --- */}
			<section className='p-5 bg-white border border-gray-200 rounded-lg space-y-4'>
				<h2 className='font-semibold'>Configuración</h2>

				<div className='grid grid-cols-1 md:grid-cols-3 gap-4'>
					<div>
						<label className='block text-sm font-medium mb-1'>Margen sobre costo CDR (%)</label>
						<input
							type='number'
							className='border rounded px-3 py-2 w-full'
							value={markup}
							onChange={e => setMarkup(Number(e.target.value))}
						/>
						<p className='text-xs text-gray-500 mt-1'>
							Precio ML = costo CDR × (1 + margen/100) + IVA
						</p>
					</div>
					<div>
						<label className='block text-sm font-medium mb-1'>Umbral mínimo de stock</label>
						<input
							type='number'
							className='border rounded px-3 py-2 w-full'
							value={threshold}
							onChange={e => setThreshold(Number(e.target.value))}
						/>
						<p className='text-xs text-gray-500 mt-1'>
							Solo se publican productos con stock mayor a este número
						</p>
					</div>
					<div>
						<label className='block text-sm font-medium mb-1'>Garantía default (meses)</label>
						<input
							type='number'
							className='border rounded px-3 py-2 w-full'
							value={warrantyMonths}
							onChange={e => setWarrantyMonths(Number(e.target.value))}
						/>
						<p className='text-xs text-gray-500 mt-1'>
							Solo se aplica cuando la descripción CDR no menciona garantía
						</p>
					</div>
				</div>

				<button
					onClick={() => saveSettings()}
					disabled={saving}
					className='px-4 py-2 bg-stone-800 text-white rounded-md text-sm disabled:opacity-50'
				>
					{saving ? 'Guardando…' : 'Guardar configuración'}
				</button>
			</section>

			{/* --- BATCH MASIVO --- */}
			{credential && <BatchSection />}

			{/* --- PUBLICADOS --- */}
			{credential && <PublishedSection />}

			{/* --- PUBLICACIÓN --- */}
			{credential && <PublishSection />}

			{/* --- INFO --- */}
			<section className='p-5 bg-blue-50 border border-blue-200 rounded-lg space-y-2 text-sm text-blue-900'>
				<p className='font-semibold'>Próximos pasos</p>
				<ul className='list-disc list-inside space-y-1'>
					<li>Fase 4 — Sync stock 3-way en tiempo real</li>
					<li>Fase 5 — Webhook ML + ingest de órdenes</li>
				</ul>
			</section>
		</div>
	);
};

const PublishSection = () => {
	const queryClient = useQueryClient();
	const [preview, setPreview] = useState<DryRunResult | null>(null);
	const [lastResult, setLastResult] = useState<PublishResult | null>(null);

	const { data: items = [], isLoading } = useQuery({
		queryKey: ['ml_publishable_pending'],
		queryFn: getPublishablePending,
	});

	const { mutate: dryRun, isPending: dryRunning } = useMutation({
		mutationFn: ({ product_id, variant_id }: { product_id: string; variant_id: string }) =>
			publishMlItem(product_id, variant_id, true) as Promise<DryRunResult>,
		onSuccess: data => {
			setPreview(data);
			toast.success('Preview generado — revisá abajo qué se va a publicar');
		},
		onError: (e: Error) => toast.error(`Dry run falló: ${e.message}`),
	});

	const { mutate: publish, isPending: publishing } = useMutation({
		mutationFn: ({ product_id, variant_id }: { product_id: string; variant_id: string }) =>
			publishMlItem(product_id, variant_id, false) as Promise<PublishResult>,
		onSuccess: data => {
			setLastResult(data);
			if (data.ok) {
				toast.success(`Publicado en ML: ${data.ml_item_id}`);
				queryClient.invalidateQueries({ queryKey: ['ml_publishable_pending'] });
				queryClient.invalidateQueries({ queryKey: ['ml_stats'] });
				queryClient.invalidateQueries({ queryKey: ['ml_published_items'] });
			} else {
				toast.error(`ML rechazó: ${data.error ?? 'ver detalle abajo'}`);
			}
		},
		onError: (e: Error) => toast.error(`Publicación falló: ${e.message}`),
	});

	return (
		<section className='p-5 bg-white border border-gray-200 rounded-lg space-y-4'>
			<div>
				<h2 className='font-semibold'>Productos pendientes de vincular ({items.length})</h2>
				<p className='text-xs text-gray-500 mt-1'>
					Cumplen todas las normas ML pero aún no están publicados. Hacé "Vista previa" para revisar el payload antes de publicar.
				</p>
			</div>

			{isLoading ? (
				<p className='text-sm text-gray-500'>Cargando candidatos…</p>
			) : items.length === 0 ? (
				<p className='text-sm text-gray-500'>No hay productos pendientes de vincular con los filtros actuales.</p>
			) : (
				<div className='overflow-auto max-h-[600px] border border-gray-100 rounded'>
					<table className='min-w-full text-sm'>
						<thead className='bg-gray-50 text-left sticky top-0'>
							<tr>
								<th className='p-2'>Imagen</th>
								<th className='p-2'>Código</th>
								<th className='p-2'>Nombre</th>
								<th className='p-2'>Marca</th>
								<th className='p-2'>Categoría</th>
								<th className='p-2 text-right'>Stock</th>
								<th className='p-2 text-right'>Costo USD</th>
								<th className='p-2'></th>
							</tr>
						</thead>
						<tbody>
							{items.map((p: PublishablePendingRow) => (
								<tr key={p.id} className='border-t hover:bg-gray-50'>
									<td className='p-2'>
										{p.images?.[0] && (
											<img src={p.images[0]} alt={p.name} className='w-12 h-12 object-cover rounded' />
										)}
									</td>
									<td className='p-2 font-mono text-xs'>{p.external_code}</td>
									<td className='p-2'>{p.name}</td>
									<td className='p-2 text-xs'>{p.brand_name ?? '—'}</td>
									<td className='p-2 text-xs text-gray-600'>
										{p.subcategory_name ?? '—'}
										<br />
										<span className='text-gray-400'>{p.category_name ?? '—'}</span>
									</td>
									<td className='p-2 text-right'>{p.stock}</td>
									<td className='p-2 text-right'>${p.price_usd}</td>
									<td className='p-2 whitespace-nowrap'>
										<div className='flex gap-1'>
											<button
												onClick={() => dryRun({ product_id: p.id, variant_id: p.variant_id })}
												disabled={dryRunning || publishing}
												className='px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50'
											>
												Vista previa
											</button>
											<button
												onClick={() => publish({ product_id: p.id, variant_id: p.variant_id })}
												disabled={dryRunning || publishing}
												className='px-2 py-1 text-xs bg-yellow-400 hover:bg-yellow-500 text-stone-900 font-semibold rounded disabled:opacity-50'
											>
												Publicar
											</button>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			{preview && (
				<div className='p-3 bg-gray-50 border border-gray-200 rounded space-y-2'>
					<div className='flex items-center justify-between'>
						<p className='text-sm font-semibold'>Vista previa del payload</p>
						<button onClick={() => setPreview(null)} className='text-xs text-gray-500 hover:text-gray-900'>
							Cerrar
						</button>
					</div>
					<div className='grid grid-cols-2 md:grid-cols-4 gap-2 text-xs'>
						<MetaCard label='FX rate USD→UYU' value={preview.meta.fxRate} />
						<MetaCard label='Costo USD' value={preview.meta.costUsd} />
						<MetaCard label='Precio ML (UYU)' value={preview.meta.priceUyu} />
						<MetaCard label='Categoría ML' value={preview.meta.predictedCategory} />
						<MetaCard label='Garantía' value={`${preview.meta.warranty.months}m ${preview.meta.warranty.type} (${preview.meta.warranty.source})`} />
						<MetaCard label='GTIN' value={preview.meta.featuresExtracted.gtin ?? '—'} />
						<MetaCard label='Modelo' value={preview.meta.featuresExtracted.model ?? '—'} />
						<MetaCard label='Color' value={preview.meta.attrsFromText?.color ?? '—'} />
						<MetaCard label='RAM' value={preview.meta.attrsFromText?.ram ?? '—'} />
						<MetaCard label='Mem. interna' value={preview.meta.attrsFromText?.internal_memory ?? '—'} />
						<MetaCard label='Dual SIM' value={preview.meta.attrsFromText?.is_dual_sim == null ? '—' : preview.meta.attrsFromText.is_dual_sim ? 'Sí' : 'No'} />
					</div>
					<details className='text-xs'>
						<summary className='cursor-pointer text-gray-600 font-medium'>Payload JSON completo</summary>
						<pre className='mt-2 p-2 bg-white border rounded overflow-auto max-h-96'>{JSON.stringify(preview.payload, null, 2)}</pre>
					</details>
				</div>
			)}

			{lastResult && !lastResult.ok && (
				<div className='p-3 bg-red-50 border border-red-200 rounded space-y-1'>
					<p className='text-sm font-semibold text-red-800'>ML rechazó la publicación</p>
					<p className='text-xs text-red-700'>{lastResult.error}</p>
					<details className='text-xs'>
						<summary className='cursor-pointer text-red-700 font-medium'>Detalle</summary>
						<pre className='mt-2 p-2 bg-white border rounded overflow-auto max-h-96'>{JSON.stringify(lastResult.detail, null, 2)}</pre>
					</details>
				</div>
			)}
		</section>
	);
};

const BatchSection = () => {
	const queryClient = useQueryClient();
	const { data: stats } = useQuery({
		queryKey: ['ml_queue_stats'],
		queryFn: getQueueStats,
		refetchInterval: 5000,
	});

	const { mutate: enqueueSmartphones, isPending: enqSmartph } = useMutation({
		mutationFn: () => enqueuePublishBatch('%smartphone%', ['Apple']),
		onSuccess: n => {
			toast.success(`${n} smartphones encolados`);
			queryClient.invalidateQueries({ queryKey: ['ml_queue_stats'] });
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const { mutate: enqueueAll, isPending: enqAll } = useMutation({
		mutationFn: () => enqueuePublishBatch(null, ['Apple']),
		onSuccess: n => {
			toast.success(`${n} productos encolados (todo CDR sin Apple)`);
			queryClient.invalidateQueries({ queryKey: ['ml_queue_stats'] });
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const { mutate: triggerNow } = useMutation({
		mutationFn: triggerPublishQueueNow,
		onSuccess: () => toast.success('Procesador disparado manualmente'),
	});

	return (
		<section className='p-5 bg-white border border-gray-200 rounded-lg space-y-4'>
			<div className='flex items-center justify-between'>
				<div>
					<h2 className='font-semibold'>Publicación masiva en cola</h2>
					<p className='text-xs text-gray-500 mt-1'>
						La cola se procesa automáticamente cada 1 min (5 productos por tick, ~30s).
					</p>
				</div>
			</div>

			{stats && (
				<div className='grid grid-cols-2 md:grid-cols-4 gap-3'>
					<StatCard label='Pendientes' value={stats.pending} color='amber' />
					<StatCard label='Procesando' value={stats.processing} color='blue' />
					<StatCard label='Completados' value={stats.done} color='emerald' />
					<StatCard label='Con error' value={stats.error} color='red' />
				</div>
			)}

			<div className='flex flex-wrap gap-2'>
				<button
					onClick={() => enqueueSmartphones()}
					disabled={enqSmartph}
					className='px-3 py-2 text-sm bg-yellow-400 hover:bg-yellow-500 text-stone-900 font-semibold rounded disabled:opacity-50'
				>
					Encolar smartphones (sin Apple)
				</button>
				<button
					onClick={() => {
						if (confirm('Esto va a encolar TODOS los productos CDR publicables (~1900 productos). Confirmá.')) {
							enqueueAll();
						}
					}}
					disabled={enqAll}
					className='px-3 py-2 text-sm border border-stone-800 rounded disabled:opacity-50'
				>
					Encolar TODO el catálogo CDR
				</button>
				<button
					onClick={() => triggerNow()}
					className='px-3 py-2 text-sm text-brand-700 hover:text-brand-900 underline'
				>
					Disparar procesador ahora
				</button>
			</div>

			{stats?.last_run && (
				<div className='text-xs text-gray-500'>
					Último tick: {new Date(stats.last_run.at).toLocaleTimeString('es-UY')} · {stats.last_run.taken} tomados · {(stats.last_run.succeeded ?? stats.last_run.ok ?? 0)} OK · {stats.last_run.failed} fallaron · {stats.last_run.elapsed_s}s
				</div>
			)}
			{stats?.stock_monitor && (
				<div className='text-xs text-gray-500'>
					Stock monitor: último run {stats.stock_monitor.at ? new Date(stats.stock_monitor.at).toLocaleTimeString('es-UY') : '—'} · {stats.stock_monitor.items_checked ?? 0} chequeados · {stats.stock_monitor.deltas_found ?? 0} cambios CDR · {stats.stock_monitor.stock_updates ?? 0} sincronizados
				</div>
			)}
		</section>
	);
};

const StatCard = ({ label, value, color }: { label: string; value: number; color: 'amber' | 'blue' | 'emerald' | 'red' }) => {
	const c: Record<string, string> = {
		amber: 'bg-amber-50 border-amber-200 text-amber-800',
		blue: 'bg-blue-50 border-blue-200 text-blue-800',
		emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800',
		red: 'bg-red-50 border-red-200 text-red-800',
	};
	return (
		<div className={`p-3 rounded border ${c[color]}`}>
			<p className='text-2xl font-bold'>{value}</p>
			<p className='text-xs'>{label}</p>
		</div>
	);
};

const statusBadge = (status: MlPublishedItem['status']) => {
	const map: Record<string, string> = {
		active: 'bg-emerald-100 text-emerald-800 border-emerald-200',
		paused: 'bg-amber-100 text-amber-800 border-amber-200',
		closed: 'bg-gray-100 text-gray-700 border-gray-200',
		error: 'bg-red-100 text-red-800 border-red-200',
		draft: 'bg-blue-100 text-blue-800 border-blue-200',
	};
	return (
		<span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold border ${map[status] ?? ''}`}>
			{status}
		</span>
	);
};

const PublishedSection = () => {
	const { data: items = [], isLoading } = useQuery({
		queryKey: ['ml_published_items'],
		queryFn: getMlPublishedItems,
	});

	return (
		<section className='p-5 bg-white border border-gray-200 rounded-lg space-y-3'>
			<div className='flex items-center justify-between'>
				<div>
					<h2 className='font-semibold'>Publicados en Mercado Libre</h2>
					<p className='text-xs text-gray-500 mt-1'>
						Productos sincronizados con ML. El stock se actualiza automáticamente cuando se sincroniza con CDR.
					</p>
				</div>
				<span className='text-xs text-gray-500'>{items.length} ítems</span>
			</div>

			{isLoading ? (
				<p className='text-sm text-gray-500'>Cargando…</p>
			) : items.length === 0 ? (
				<p className='text-sm text-gray-500'>Todavía no publicaste ningún producto.</p>
			) : (
				<div className='overflow-auto max-h-[500px] border border-gray-100 rounded'>
					<table className='min-w-full text-sm'>
						<thead className='bg-gray-50 text-left sticky top-0'>
							<tr>
								<th className='p-2'>Imagen</th>
								<th className='p-2'>Producto</th>
								<th className='p-2'>ML Item</th>
								<th className='p-2'>Categoría ML</th>
								<th className='p-2'>Estado</th>
								<th className='p-2 text-right'>Stock</th>
								<th className='p-2 text-right'>Precio UYU</th>
								<th className='p-2'>Última sync</th>
								<th className='p-2'></th>
							</tr>
						</thead>
						<tbody>
							{items.map(it => (
								<tr key={it.id} className='border-t'>
									<td className='p-2'>
										{it.product_image && (
											<img src={it.product_image} alt={it.product_name} className='w-12 h-12 object-cover rounded' />
										)}
									</td>
									<td className='p-2'>
										<p className='line-clamp-2'>{it.product_name}</p>
										<p className='font-mono text-[10px] text-gray-400'>{it.product_external_code}</p>
									</td>
									<td className='p-2 font-mono text-xs'>{it.ml_item_id}</td>
									<td className='p-2 font-mono text-xs'>{it.ml_category_id}</td>
									<td className='p-2'>
										{statusBadge(it.status)}
										{it.last_error && (
											<p className='text-[10px] text-red-700 mt-1 line-clamp-2' title={it.last_error}>{it.last_error}</p>
										)}
									</td>
									<td className='p-2 text-right'>{it.last_known_stock ?? '—'}</td>
									<td className='p-2 text-right'>${it.last_known_price_uyu?.toLocaleString('es-UY') ?? '—'}</td>
									<td className='p-2 text-xs text-gray-500'>
										{it.last_synced_at ? new Date(it.last_synced_at).toLocaleString('es-UY') : '—'}
									</td>
									<td className='p-2'>
										{it.permalink ? (
											<a
												href={it.permalink}
												target='_blank'
												rel='noreferrer'
												className='text-xs text-brand-700 hover:underline whitespace-nowrap'
											>
												Ver en ML →
											</a>
										) : null}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</section>
	);
};

const MetaCard = ({ label, value }: { label: string; value: unknown }) => (
	<div className='p-2 bg-white border border-gray-100 rounded'>
		<p className='text-[10px] uppercase text-gray-400'>{label}</p>
		<p className='font-mono text-xs'>{String(value)}</p>
	</div>
);

const Stat = ({
	label,
	value,
	color,
}: {
	label: string;
	value: number;
	color: 'emerald' | 'amber' | 'gray' | 'red' | 'brand';
}) => {
	const colors: Record<string, string> = {
		emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800',
		amber: 'bg-amber-50 border-amber-200 text-amber-800',
		gray: 'bg-gray-50 border-gray-200 text-gray-700',
		red: 'bg-red-50 border-red-200 text-red-800',
		brand: 'bg-brand-50 border-brand-200 text-brand-800',
	};
	return (
		<div className={`p-3 rounded-lg border ${colors[color]}`}>
			<p className='text-2xl font-bold'>{value}</p>
			<p className='text-xs'>{label}</p>
		</div>
	);
};
