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

			{/* --- INFO --- */}
			<section className='p-5 bg-blue-50 border border-blue-200 rounded-lg space-y-2 text-sm text-blue-900'>
				<p className='font-semibold'>Próximos pasos</p>
				<ul className='list-disc list-inside space-y-1'>
					<li>Fase 2 — Parser de garantía desde descripción CDR</li>
					<li>Fase 3 — Publicación masiva de Celulares</li>
					<li>Fase 4 — Sync stock 3-way en tiempo real</li>
					<li>Fase 5 — Webhook ML + ingest de órdenes</li>
				</ul>
			</section>
		</div>
	);
};

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
