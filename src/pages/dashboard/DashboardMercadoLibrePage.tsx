import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAdminNotifications, useTaxonomiesAdmin } from '../../hooks';
import { getMlPricingConfig, updateMlPricingConfig } from '../../actions/ml-pricing';
import {
	DEFAULT_ML_PRICING,
	formatPriceCurrency,
	mlPriceFromConfig,
	type MlPricingConfig,
} from '../../helpers';
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
	repriceActiveMl,
	listMlUnlinkedItems,
	searchRfProductsUnlinked,
	linkMlItemToProduct,
	type DryRunResult,
	type PublishResult,
	type PublishablePendingRow,
	type MlPublishedItem,
	type MlUnlinkedItem,
	type RfProductCandidate,
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

	const [threshold, setThreshold] = useState<number>(3);
	const [warrantyMonths, setWarrantyMonths] = useState<number>(6);

	useEffect(() => {
		if (settings) {
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

			{/* --- NOVEDADES ML (ventas / avisos) --- */}
			<MlNotificationsSection />

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

				<div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
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

			{/* --- MARGENES ML (reglas por tramo + override categoría/subcategoría) --- */}
			<MlPricingRulesSection />

			{/* --- VINCULAR PUBLICACIONES ML EXISTENTES --- */}
			{credential && <LinkExistingMlSection />}

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

const LinkExistingMlSection = () => {
	const queryClient = useQueryClient();
	const [statusFilter, setStatusFilter] = useState<'active' | 'paused' | 'closed' | 'all'>('active');
	const [activeMlItem, setActiveMlItem] = useState<MlUnlinkedItem | null>(null);

	const { data, isFetching, refetch } = useQuery({
		queryKey: ['ml_unlinked_items', statusFilter],
		queryFn: () => listMlUnlinkedItems(statusFilter),
		enabled: false,
	});

	const linkMutation = useMutation({
		mutationFn: linkMlItemToProduct,
		onSuccess: () => {
			toast.success('Vinculado. El stock empezará a sincronizarse.');
			setActiveMlItem(null);
			refetch();
			queryClient.invalidateQueries({ queryKey: ['ml_published_items'] });
			queryClient.invalidateQueries({ queryKey: ['ml_stats'] });
		},
		onError: (err: Error) => toast.error(err.message),
	});

	return (
		<section className='p-5 bg-white border border-stone-200 rounded-lg space-y-4'>
			<div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3'>
				<div>
					<h2 className='text-lg font-semibold'>Vincular publicaciones manuales</h2>
					<p className='text-xs text-stone-500'>
						Importá publicaciones que ya tenés en ML y asociá cada una con un producto de RF Store para sincronizar stock.
					</p>
				</div>
				<div className='flex items-center gap-2'>
					<select
						value={statusFilter}
						onChange={e => setStatusFilter(e.target.value as 'active' | 'paused' | 'closed' | 'all')}
						className='border rounded px-2 py-1.5 text-sm'
					>
						<option value='active'>Activas</option>
						<option value='paused'>Pausadas</option>
						<option value='closed'>Finalizadas</option>
						<option value='all'>Todas</option>
					</select>
					<button
						onClick={() => refetch()}
						disabled={isFetching}
						className='px-3 py-1.5 bg-stone-800 text-white rounded-md text-sm disabled:opacity-50'
					>
						{isFetching ? 'Cargando…' : 'Cargar de ML'}
					</button>
				</div>
			</div>

			{data && (
				<div className='text-xs text-stone-600'>
					<strong>{data.unlinked_count}</strong> sin vincular · {data.total_in_ml} totales en ML ({statusFilter})
				</div>
			)}

			{!data && !isFetching && (
				<p className='text-sm text-stone-500'>Aún no cargaste las publicaciones de ML. Hacé click en "Cargar de ML".</p>
			)}

			{data && data.items.length === 0 && (
				<p className='text-sm text-emerald-700 bg-emerald-50 p-3 rounded-md'>
					✓ Todas las publicaciones de ML ya están vinculadas a productos RF.
				</p>
			)}

			{data && data.items.length > 0 && (
				<div className='border border-stone-200 rounded-md overflow-hidden'>
					<table className='w-full text-sm'>
						<thead className='bg-stone-50 text-xs uppercase text-stone-600'>
							<tr>
								<th className='text-left p-2'>Producto en ML</th>
								<th className='text-left p-2'>Marca/Modelo</th>
								<th className='text-right p-2'>Precio</th>
								<th className='text-right p-2'>Stock</th>
								<th className='text-center p-2'>Estado</th>
								<th className='text-center p-2'>Acción</th>
							</tr>
						</thead>
						<tbody>
							{data.items.map(item => (
								<tr key={item.ml_item_id} className='border-t border-stone-100'>
									<td className='p-2'>
										<div className='flex items-center gap-2'>
											{item.thumbnail && (
												<img src={item.thumbnail} alt='' className='w-10 h-10 object-contain rounded border border-stone-200' />
											)}
											<div className='min-w-0'>
												<a href={item.permalink} target='_blank' rel='noreferrer' className='text-blue-700 hover:underline font-medium block truncate max-w-xs'>
													{item.title}
												</a>
												<span className='text-xs text-stone-500'>{item.ml_item_id}</span>
											</div>
										</div>
									</td>
									<td className='p-2 text-xs text-stone-600'>
										{item.brand ?? '—'}
										{item.model ? <><br /><span className='text-stone-400'>{item.model}</span></> : null}
									</td>
									<td className='p-2 text-right font-medium'>{item.currency} {item.price?.toLocaleString('es-UY')}</td>
									<td className='p-2 text-right'>{item.stock}</td>
									<td className='p-2 text-center'>
										<span className='inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-stone-100 text-stone-700'>{item.status}</span>
									</td>
									<td className='p-2 text-center'>
										<button
											onClick={() => setActiveMlItem(item)}
											className='px-3 py-1 bg-brand-600 text-white text-xs rounded hover:bg-brand-700'
										>
											Vincular
										</button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			{activeMlItem && (
				<LinkProductModal
					mlItem={activeMlItem}
					onClose={() => setActiveMlItem(null)}
					onConfirm={(candidate) =>
						linkMutation.mutate({
							ml_item_id: activeMlItem.ml_item_id,
							product_id: candidate.product_id,
							variant_id: candidate.variant_id,
							ml_category_id: activeMlItem.category_id,
							permalink: activeMlItem.permalink,
							current_stock: activeMlItem.stock,
						})
					}
					isSaving={linkMutation.isPending}
				/>
			)}
		</section>
	);
};

const LinkProductModal = ({
	mlItem,
	onClose,
	onConfirm,
	isSaving,
}: {
	mlItem: MlUnlinkedItem;
	onClose: () => void;
	onConfirm: (candidate: RfProductCandidate) => void;
	isSaving: boolean;
}) => {
	const [search, setSearch] = useState(mlItem.title.split(' ').slice(0, 4).join(' '));
	const [selected, setSelected] = useState<RfProductCandidate | null>(null);

	useEffect(() => { setSelected(null); }, [search]);

	const { data: candidates = [], isLoading } = useQuery({
		queryKey: ['rf_unlinked_search', search],
		queryFn: () => searchRfProductsUnlinked(search),
		enabled: search.trim().length >= 2,
	});

	return (
		<div className='fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4'>
			<div className='bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col'>
				<div className='p-4 border-b border-stone-200 flex items-center justify-between'>
					<div className='min-w-0'>
						<h3 className='font-semibold text-sm'>Vincular con producto RF</h3>
						<p className='text-xs text-stone-500 truncate'>{mlItem.title}</p>
					</div>
					<button onClick={onClose} className='text-stone-500 hover:text-stone-700 text-xl leading-none'>×</button>
				</div>

				<div className='p-4 border-b border-stone-200'>
					<input
						type='text'
						value={search}
						onChange={e => setSearch(e.target.value)}
						placeholder='Buscar por nombre, código o marca…'
						className='w-full border rounded px-3 py-2 text-sm'
						autoFocus
					/>
				</div>

				<div className='flex-1 overflow-y-auto p-2'>
					{isLoading && <p className='text-sm text-stone-500 p-3'>Buscando…</p>}
					{!isLoading && candidates.length === 0 && search.trim().length >= 2 && (
						<p className='text-sm text-stone-500 p-3'>No se encontraron productos sin vincular para "{search}".</p>
					)}
					<ul className='space-y-1'>
						{candidates.map(c => (
							<li key={c.variant_id}>
								<button
									type='button'
									onClick={() => setSelected(c)}
									className={`w-full text-left flex items-center gap-3 p-2 rounded border transition ${
										selected?.variant_id === c.variant_id
											? 'border-brand-500 bg-brand-50'
											: 'border-stone-200 hover:bg-stone-50'
									}`}
								>
									{c.image_url && <img src={c.image_url} alt='' className='w-12 h-12 object-contain rounded border border-stone-200' />}
									<div className='flex-1 min-w-0'>
										<p className='text-sm font-medium truncate'>{c.product_name}</p>
										<p className='text-xs text-stone-500'>
											{c.brand_name ?? 'sin marca'} · {c.external_code ?? 's/código'} · stock {c.stock}
										</p>
									</div>
									<p className='text-xs font-semibold whitespace-nowrap'>
										{c.price_usd ? `USD ${Number(c.price_usd).toFixed(0)}` : ''}
									</p>
								</button>
							</li>
						))}
					</ul>
				</div>

				<div className='p-3 border-t border-stone-200 flex items-center justify-between gap-2 bg-stone-50'>
					<p className='text-xs text-stone-500'>
						{selected ? `Vas a vincular con: ${selected.product_name}` : 'Elegí un producto de la lista'}
					</p>
					<div className='flex gap-2'>
						<button
							onClick={onClose}
							className='px-3 py-1.5 border border-stone-300 rounded text-sm hover:bg-stone-100'
						>
							Cancelar
						</button>
						<button
							onClick={() => selected && onConfirm(selected)}
							disabled={!selected || isSaving}
							className='px-4 py-1.5 bg-brand-600 text-white rounded text-sm hover:bg-brand-700 disabled:opacity-50'
						>
							{isSaving ? 'Vinculando…' : 'Vincular'}
						</button>
					</div>
				</div>
			</div>
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

// Novedades de Mercado Libre: ventas (ml_sale) y avisos de órdenes que no se
// pudieron leer (ml_order_unfetchable). Lee de admin_notifications.
const MlNotificationsSection = () => {
	const { notifications, markOne } = useAdminNotifications();
	const mlNotifs = notifications.filter(
		n => typeof n.type === 'string' && n.type.startsWith('ml_')
	);

	if (mlNotifs.length === 0) return null;

	return (
		<section className='p-5 bg-white border border-gray-200 rounded-lg space-y-3'>
			<h2 className='font-semibold'>Novedades de Mercado Libre</h2>
			<ul className='divide-y divide-gray-100'>
				{mlNotifs.map(n => {
					const isUnread = !n.read_at;
					const isSale = n.type === 'ml_sale';
					const p = (n.payload ?? {}) as {
						ml_order_id?: string;
						message?: string;
						total?: number;
						items?: { title: string; qty: number }[];
						needs_manual_stock?: boolean;
					};
					return (
						<li
							key={n.id}
							className={`py-3 ${isUnread ? 'bg-amber-50/50 -mx-2 px-2 rounded-md' : ''}`}
						>
							<div className='flex items-start justify-between gap-3'>
								<div className='flex-1 min-w-0'>
									<p className='text-sm font-medium'>
										<span
											className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide mr-2 ${
												isSale
													? 'bg-emerald-100 text-emerald-800'
													: 'bg-red-100 text-red-800'
											}`}
										>
											{isSale ? 'Venta' : 'Atención'}
										</span>
										{p.message ?? (isSale ? 'Venta en Mercado Libre' : 'Aviso de Mercado Libre')}
									</p>
									{p.ml_order_id && (
										<p className='text-xs text-gray-500 mt-1'>
											Orden ML {p.ml_order_id}
											{typeof p.total === 'number' ? ` · $${p.total}` : ''}
										</p>
									)}
									{p.items && p.items.length > 0 && (
										<ul className='mt-1 ml-1 text-xs text-gray-600 list-disc list-inside'>
											{p.items.slice(0, 8).map((it, i) => (
												<li key={i}>
													{it.title} × {it.qty}
												</li>
											))}
										</ul>
									)}
									{p.needs_manual_stock && (
										<p className='text-xs text-red-600 mt-1 font-medium'>
											⚠️ Revisá el stock a mano (item sin vínculo).
										</p>
									)}
									<p className='text-[11px] text-gray-400 mt-1'>
										{formatDate(n.created_at)}
									</p>
								</div>
								{isUnread && (
									<button
										onClick={() => markOne(n.id)}
										className='shrink-0 text-xs font-semibold text-gray-600 hover:text-gray-900'
									>
										Marcar leída
									</button>
								)}
							</div>
						</li>
					);
				})}
			</ul>
		</section>
	);
};

// Reglas de precio para Mercado Libre: tramos por costo + override por
// categoria/subcategoria. Precedencia: subcategoria > categoria > tramo.
// El IVA y la regla USD/UYU (umbral) se mantienen para todos los casos.
const MlPricingRulesSection = () => {
	const queryClient = useQueryClient();
	const { categories, subcategories } = useTaxonomiesAdmin();
	const { data, isLoading } = useQuery({ queryKey: ['ml_pricing_config'], queryFn: getMlPricingConfig });
	const [cfg, setCfg] = useState<MlPricingConfig>(DEFAULT_ML_PRICING);
	const [previewCost, setPreviewCost] = useState('100');
	const [previewCat, setPreviewCat] = useState('');
	const [previewSub, setPreviewSub] = useState('');
	const [newCat, setNewCat] = useState('');
	const [newSub, setNewSub] = useState('');

	useEffect(() => { if (data) setCfg(data); }, [data]);

	const { mutate: save, isPending } = useMutation({
		mutationFn: () => updateMlPricingConfig(cfg),
		onSuccess: () => {
			toast.success('Margenes ML guardados');
			queryClient.invalidateQueries({ queryKey: ['ml_pricing_config'] });
		},
		onError: (e: Error) => toast.error(e.message),
	});

	// Guarda las reglas y repreciar TODAS las publicaciones activas (encola a la cola
	// que empuja a ML ~20/min). Es el unico modo de aplicar reglas a lo ya publicado.
	const { mutate: saveAndReprice, isPending: repricing } = useMutation({
		mutationFn: async () => {
			await updateMlPricingConfig(cfg);
			return repriceActiveMl(false);
		},
		onSuccess: (r) => {
			queryClient.invalidateQueries({ queryKey: ['ml_pricing_config'] });
			if (r.ok) toast.success(`Reglas guardadas. Encolados ${r.enqueued ?? 0} de ${r.active ?? 0} activos para repreciar en ML.`);
			else toast.error(`Repreciado fallo: ${r.error ?? 'desconocido'}`);
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const catName = (id: string) => categories.find(c => c.id === id)?.name ?? id;
	const subLabel = (id: string) => {
		const s = subcategories.find(x => x.id === id);
		if (!s) return id;
		return `${categories.find(c => c.id === s.category_id)?.name ?? '-'} > ${s.name}`;
	};

	const setTier = (i: number, field: 'max' | 'pct', v: string) =>
		setCfg(c => ({
			...c,
			tiers: c.tiers.map((t, idx) =>
				idx === i ? { ...t, [field]: v === '' ? (field === 'max' ? null : 0) : Number(v) } : t
			),
		}));
	const addTier = () =>
		setCfg(c => {
			const tiers = [...c.tiers];
			const lastMax = tiers.length >= 2 ? tiers[tiers.length - 2].max ?? 0 : 0;
			tiers.splice(tiers.length - 1, 0, { max: Number(lastMax) + 50, pct: 30 });
			return { ...c, tiers };
		});
	const removeTier = (i: number) =>
		setCfg(c => ({ ...c, tiers: c.tiers.filter((_, idx) => idx !== i) }));
	const rangeLabel = (i: number) => {
		const prev = i === 0 ? 0 : cfg.tiers[i - 1].max ?? 0;
		const max = cfg.tiers[i].max;
		if (max === null) return `Desde USD ${prev} en adelante`;
		return `USD ${prev} a ${max - 0.01}`;
	};

	const setOverride = (kind: 'category' | 'subcategory', id: string, pct: number) =>
		setCfg(c => {
			const key = kind === 'category' ? 'category_overrides' : 'subcategory_overrides';
			return { ...c, [key]: { ...c[key], [id]: pct } };
		});
	const removeOverride = (kind: 'category' | 'subcategory', id: string) =>
		setCfg(c => {
			const key = kind === 'category' ? 'category_overrides' : 'subcategory_overrides';
			const next = { ...c[key] };
			delete next[id];
			return { ...c, [key]: next };
		});

	const previewResult = mlPriceFromConfig(Number(previewCost) || 0, 40, previewCat || null, previewSub || null, cfg);

	if (isLoading) {
		return (
			<section className='p-5 bg-white border border-gray-200 rounded-lg'>
				<p className='text-sm text-gray-500'>Cargando margenes ML...</p>
			</section>
		);
	}

	const catOverrideIds = Object.keys(cfg.category_overrides ?? {});
	const subOverrideIds = Object.keys(cfg.subcategory_overrides ?? {});

	return (
		<section className='p-5 bg-white border border-gray-200 rounded-lg space-y-5'>
			<div>
				<h2 className='font-semibold'>Margenes de Mercado Libre</h2>
				<p className='text-xs text-gray-500 mt-1'>
					Reglas propias de ML (separadas de la web). Precio ML = costo x (1 + margen/100) x (1 + IVA/100).
					Si el costo supera el umbral USD, el precio va en USD; sino en pesos al BCU. Precedencia del margen:
					<b> subcategoria &rarr; categoria &rarr; tramo por costo</b>.
				</p>
			</div>

			<div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
				<div>
					<label className='block text-sm font-medium mb-1'>IVA (%)</label>
					<input
						type='number'
						className='border rounded px-3 py-2 w-full'
						value={cfg.iva_percent}
						onChange={e => setCfg(c => ({ ...c, iva_percent: Number(e.target.value) || 0 }))}
					/>
				</div>
				<div>
					<label className='block text-sm font-medium mb-1'>Umbral USD (precio en USD por encima)</label>
					<input
						type='number'
						className='border rounded px-3 py-2 w-full'
						value={cfg.usd_threshold}
						onChange={e => setCfg(c => ({ ...c, usd_threshold: Number(e.target.value) || 0 }))}
					/>
				</div>
			</div>

			<div>
				<div className='flex items-center justify-between mb-2'>
					<h3 className='text-sm font-semibold'>Margenes por tramo de costo</h3>
					<button onClick={addTier} className='text-xs font-semibold text-brand-700 hover:text-brand-900'>+ Agregar tramo</button>
				</div>
				<div className='space-y-2'>
					{cfg.tiers.map((tier, i) => (
						<div key={i} className='flex flex-wrap items-center gap-3 rounded-lg border border-gray-100 bg-gray-50/60 p-3'>
							<span className='min-w-[180px] text-sm font-medium text-gray-700'>{rangeLabel(i)}</span>
							{tier.max !== null && (
								<label className='flex items-center gap-1.5 text-xs text-gray-500'>
									Hasta USD
									<input type='number' value={tier.max} onChange={e => setTier(i, 'max', e.target.value)} className='w-24 rounded border border-gray-200 px-2 py-1.5 text-sm' />
								</label>
							)}
							<label className='ml-auto flex items-center gap-1.5 text-xs text-gray-500'>
								Margen
								<input type='number' value={tier.pct} onChange={e => setTier(i, 'pct', e.target.value)} className='w-20 rounded border border-gray-200 px-2 py-1.5 text-sm font-semibold' />
								%
							</label>
							{tier.max !== null && (
								<button onClick={() => removeTier(i)} className='text-xs text-rose-600 hover:text-rose-800'>Quitar</button>
							)}
						</div>
					))}
				</div>
			</div>

			<div>
				<h3 className='text-sm font-semibold mb-2'>Override por categoria</h3>
				<div className='flex flex-wrap items-center gap-2 mb-2'>
					<select value={newCat} onChange={e => setNewCat(e.target.value)} className='border rounded px-2 py-1.5 text-sm'>
						<option value=''>Elegi una categoria...</option>
						{categories.filter(c => !catOverrideIds.includes(c.id)).map(c => (
							<option key={c.id} value={c.id}>{c.name}</option>
						))}
					</select>
					<button
						onClick={() => { if (newCat) { setOverride('category', newCat, 30); setNewCat(''); } }}
						disabled={!newCat}
						className='px-3 py-1.5 text-xs font-semibold bg-stone-800 text-white rounded disabled:opacity-50'
					>Agregar</button>
				</div>
				{catOverrideIds.length === 0 ? (
					<p className='text-xs text-gray-400'>Sin overrides de categoria.</p>
				) : (
					<div className='space-y-2'>
						{catOverrideIds.map(id => (
							<div key={id} className='flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50/60 p-2.5'>
								<span className='text-sm text-gray-700 flex-1'>{catName(id)}</span>
								<label className='flex items-center gap-1.5 text-xs text-gray-500'>
									Margen
									<input type='number' value={cfg.category_overrides[id]} onChange={e => setOverride('category', id, Number(e.target.value) || 0)} className='w-20 rounded border border-gray-200 px-2 py-1.5 text-sm font-semibold' />
									%
								</label>
								<button onClick={() => removeOverride('category', id)} className='text-xs text-rose-600 hover:text-rose-800'>Quitar</button>
							</div>
						))}
					</div>
				)}
			</div>

			<div>
				<h3 className='text-sm font-semibold mb-2'>Override por subcategoria</h3>
				<div className='flex flex-wrap items-center gap-2 mb-2'>
					<select value={newSub} onChange={e => setNewSub(e.target.value)} className='border rounded px-2 py-1.5 text-sm max-w-xs'>
						<option value=''>Elegi una subcategoria...</option>
						{subcategories.filter(s => !subOverrideIds.includes(s.id)).map(s => (
							<option key={s.id} value={s.id}>{subLabel(s.id)}</option>
						))}
					</select>
					<button
						onClick={() => { if (newSub) { setOverride('subcategory', newSub, 30); setNewSub(''); } }}
						disabled={!newSub}
						className='px-3 py-1.5 text-xs font-semibold bg-stone-800 text-white rounded disabled:opacity-50'
					>Agregar</button>
				</div>
				{subOverrideIds.length === 0 ? (
					<p className='text-xs text-gray-400'>Sin overrides de subcategoria.</p>
				) : (
					<div className='space-y-2'>
						{subOverrideIds.map(id => (
							<div key={id} className='flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50/60 p-2.5'>
								<span className='text-sm text-gray-700 flex-1'>{subLabel(id)}</span>
								<label className='flex items-center gap-1.5 text-xs text-gray-500'>
									Margen
									<input type='number' value={cfg.subcategory_overrides[id]} onChange={e => setOverride('subcategory', id, Number(e.target.value) || 0)} className='w-20 rounded border border-gray-200 px-2 py-1.5 text-sm font-semibold' />
									%
								</label>
								<button onClick={() => removeOverride('subcategory', id)} className='text-xs text-rose-600 hover:text-rose-800'>Quitar</button>
							</div>
						))}
					</div>
				)}
			</div>

			<div className='rounded-lg border border-blue-200 bg-blue-50/50 p-4'>
				<h3 className='text-sm font-semibold mb-2'>Vista previa</h3>
				<div className='flex flex-wrap items-end gap-3'>
					<label className='flex flex-col gap-1 text-xs text-gray-500'>
						Costo USD
						<input type='number' value={previewCost} onChange={e => setPreviewCost(e.target.value)} className='w-28 rounded border border-gray-200 px-2 py-1.5 text-sm' />
					</label>
					<label className='flex flex-col gap-1 text-xs text-gray-500'>
						Categoria
						<select value={previewCat} onChange={e => { setPreviewCat(e.target.value); setPreviewSub(''); }} className='rounded border border-gray-200 px-2 py-1.5 text-sm'>
							<option value=''>(ninguna)</option>
							{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
						</select>
					</label>
					<label className='flex flex-col gap-1 text-xs text-gray-500'>
						Subcategoria
						<select value={previewSub} onChange={e => setPreviewSub(e.target.value)} className='rounded border border-gray-200 px-2 py-1.5 text-sm max-w-[220px]'>
							<option value=''>(ninguna)</option>
							{subcategories.filter(s => !previewCat || s.category_id === previewCat).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
						</select>
					</label>
					<div className='text-sm text-gray-700'>
						Precio ML: <span className='text-lg font-bold text-gray-900'>{formatPriceCurrency(previewResult.price, previewResult.currency)}</span>
						<span className='text-xs text-gray-500'> ({previewResult.currency === 'UYU' ? 'pesos al BCU ~40' : 'USD'})</span>
					</div>
				</div>
			</div>

			<div className='flex flex-wrap items-center gap-3 pt-1'>
				<button onClick={() => save()} disabled={isPending || repricing} className='px-4 py-2 bg-stone-800 text-white rounded-md text-sm disabled:opacity-50'>
					{isPending ? 'Guardando...' : 'Guardar margenes ML'}
				</button>
				<button
					onClick={() => {
						if (confirm('Esto guarda las reglas y RECALCULA el precio de TODAS las publicaciones activas en ML. Los nuevos precios se empujan a ML de a poco (~20/min). Confirmas?')) {
							saveAndReprice();
						}
					}}
					disabled={isPending || repricing}
					className='px-4 py-2 border border-stone-800 text-stone-800 rounded-md text-sm disabled:opacity-50'
				>
					{repricing ? 'Encolando...' : 'Guardar y repreciar publicaciones activas'}
				</button>
			</div>
			<p className='text-xs text-gray-400'>
				El repreciado aplica las reglas a lo YA publicado. Las publicaciones nuevas usan las reglas vigentes al publicar.
			</p>
		</section>
	);
};
