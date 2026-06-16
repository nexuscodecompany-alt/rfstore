import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { HiOutlineCalculator } from 'react-icons/hi2';
import { getPricingConfig, updatePricingConfig } from '../../actions/pricing';
import { DEFAULT_PRICING, PricingConfig, formatPrice, salePrice } from '../../helpers';
import { Loader } from '../../components/shared/Loader';

export const DashboardPricingPage = ({ embedded = false }: { embedded?: boolean } = {}) => {
	const queryClient = useQueryClient();
	const { data, isLoading } = useQuery({
		queryKey: ['pricing_config'],
		queryFn: getPricingConfig,
	});

	const [cfg, setCfg] = useState<PricingConfig>(DEFAULT_PRICING);
	const [preview, setPreview] = useState('100');

	useEffect(() => {
		if (data) setCfg(data);
	}, [data]);

	const { mutate, isPending } = useMutation({
		mutationFn: updatePricingConfig,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['pricing_config'] });
			toast.success('Precios actualizados', { position: 'bottom-right' });
		},
		onError: () => toast.error('No se pudo guardar', { position: 'bottom-right' }),
	});

	if (isLoading) return <Loader />;

	const setIva = (v: string) =>
		setCfg(c => ({ ...c, iva_percent: Number(v) || 0 }));

	const setTier = (i: number, field: 'max' | 'pct', v: string) =>
		setCfg(c => ({
			...c,
			tiers: c.tiers.map((t, idx) =>
				idx === i
					? { ...t, [field]: v === '' ? (field === 'max' ? null : 0) : Number(v) }
					: t
			),
		}));

	const rangeLabel = (i: number) => {
		const prev = i === 0 ? 0 : cfg.tiers[i - 1].max ?? 0;
		const max = cfg.tiers[i].max;
		if (max === null) return `Desde USD ${prev} en adelante`;
		return `USD ${prev} a ${max - 0.01}`;
	};

	const previewCost = Number(preview) || 0;

	return (
		<div className='max-w-3xl space-y-6'>
			{!embedded && (
				<div>
					<h1 className='text-2xl font-bold text-ink-900'>Precios y márgenes</h1>
					<p className='text-sm text-ink-500'>
						El precio que cargás en cada producto es el <b>costo sin IVA</b>. El
						sistema calcula el precio de venta sumando el margen según el costo y
						el IVA. Fórmula: <code>costo × (1 + margen) × (1 + IVA)</code>.
					</p>
				</div>
			)}

			{/* IVA */}
			<div className='rounded-2xl border border-ink-200/70 bg-white p-5 shadow-soft'>
				<h2 className='mb-3 font-bold text-ink-900'>IVA</h2>
				<div className='flex items-center gap-2'>
					<input
						type='number'
						value={cfg.iva_percent}
						onChange={e => setIva(e.target.value)}
						className='w-28 rounded-lg border border-ink-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300'
					/>
					<span className='text-sm text-ink-500'>% (Uruguay: 22%)</span>
				</div>
			</div>

			{/* Tramos de margen */}
			<div className='rounded-2xl border border-ink-200/70 bg-white p-5 shadow-soft'>
				<h2 className='mb-1 font-bold text-ink-900'>Márgenes por tramo</h2>
				<p className='mb-4 text-sm text-ink-500'>
					El tramo se decide según el <b>costo</b> del producto.
				</p>

				<div className='space-y-3'>
					{cfg.tiers.map((tier, i) => (
						<div
							key={i}
							className='flex flex-wrap items-center gap-3 rounded-xl border border-ink-100 bg-ink-50/50 p-3'
						>
							<span className='min-w-[180px] text-sm font-medium text-ink-700'>
								{rangeLabel(i)}
							</span>

							{tier.max !== null && (
								<label className='flex items-center gap-1.5 text-xs text-ink-500'>
									Hasta&nbsp;USD
									<input
										type='number'
										value={tier.max}
										onChange={e => setTier(i, 'max', e.target.value)}
										className='w-24 rounded-lg border border-ink-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300'
									/>
								</label>
							)}

							<label className='ml-auto flex items-center gap-1.5 text-xs text-ink-500'>
								Margen
								<input
									type='number'
									value={tier.pct}
									onChange={e => setTier(i, 'pct', e.target.value)}
									className='w-20 rounded-lg border border-ink-200 px-2 py-1.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-brand-300'
								/>
								%
							</label>
						</div>
					))}
				</div>
			</div>

			{/* Vista previa */}
			<div className='rounded-2xl border border-brand-200 bg-brand-50/50 p-5'>
				<h2 className='mb-3 flex items-center gap-2 font-bold text-ink-900'>
					<HiOutlineCalculator className='text-brand-600' size={20} />
					Vista previa
				</h2>
				<div className='flex flex-wrap items-end gap-4'>
					<label className='flex flex-col gap-1 text-xs text-ink-500'>
						Costo (USD)
						<input
							type='number'
							value={preview}
							onChange={e => setPreview(e.target.value)}
							className='w-32 rounded-lg border border-ink-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300'
						/>
					</label>
					<div className='text-sm text-ink-600'>
						Precio de venta:{' '}
						<span className='text-lg font-bold text-ink-900'>
							{formatPrice(salePrice(previewCost, cfg))}
						</span>{' '}
						<span className='text-xs text-ink-500'>IVA incluido</span>
					</div>
				</div>
			</div>

			<button
				onClick={() => mutate(cfg)}
				disabled={isPending}
				className='rounded-full bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white shadow-soft transition-all hover:bg-brand-700 disabled:opacity-60'
			>
				{isPending ? 'Guardando…' : 'Guardar cambios'}
			</button>
		</div>
	);
};
