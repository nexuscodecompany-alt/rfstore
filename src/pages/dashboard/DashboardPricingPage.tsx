import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { HiOutlineCalculator } from 'react-icons/hi2';
import { getPricingConfig, updatePricingConfig } from '../../actions/pricing';
import { DEFAULT_PRICING, PricingConfig, formatPrice, salePrice } from '../../helpers';
import { Loader } from '../../components/shared/Loader';
import { NumInput } from '../../components/dashboard/NumInput';

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

	const updateTier = (i: number, patch: Partial<{ max: number | null; pct: number }>) =>
		setCfg(c => ({ ...c, tiers: c.tiers.map((t, idx) => (idx === i ? { ...t, ...patch } : t)) }));
	const addTier = () =>
		setCfg(c => {
			// Inserta un tramo nuevo justo antes del último ("en adelante", max=null).
			const tiers = [...c.tiers];
			const lastMax = tiers.length >= 2 ? tiers[tiers.length - 2].max ?? 0 : 0;
			tiers.splice(tiers.length - 1, 0, { max: Number(lastMax) + 50, pct: 20 });
			return { ...c, tiers };
		});
	const removeTier = (i: number) =>
		setCfg(c => ({ ...c, tiers: c.tiers.filter((_, idx) => idx !== i) }));
	const tierFrom = (i: number) => (i === 0 ? 0 : cfg.tiers[i - 1].max ?? 0);
	// Texto del rango EFECTIVO de cada tramo. El borde "Hasta" no se incluye:
	// un costo igual a ese número cae en el tramo siguiente (regla `costo < Hasta`).
	const tierRangeText = (i: number) => {
		const from = tierFrom(i);
		const max = cfg.tiers[i].max;
		if (max === null) return `Aplica a costos de USD ${from} o más`;
		if (i === 0) return `Aplica a costos menores a USD ${max}`;
		return `Aplica a costos de USD ${from} a menos de USD ${max}`;
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
					<NumInput
						value={cfg.iva_percent}
						onChange={n => setCfg(c => ({ ...c, iva_percent: n }))}
						className='w-28 rounded-lg border border-ink-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300'
					/>
					<span className='text-sm text-ink-500'>% (Uruguay: 22%)</span>
				</div>
			</div>

			{/* Tramos de margen */}
			<div className='rounded-2xl border border-ink-200/70 bg-white p-5 shadow-soft'>
				<div className='mb-4 flex items-center justify-between gap-3'>
					<p className='text-sm text-ink-500'>
						El tramo se decide según el <b>costo</b> del producto.
					</p>
					<button onClick={addTier} className='shrink-0 text-xs font-semibold text-brand-700 hover:text-brand-900'>
						+ Agregar tramo
					</button>
				</div>

				<div className='space-y-3'>
					{cfg.tiers.map((tier, i) => (
						<div
							key={i}
							className='flex flex-wrap items-center gap-3 rounded-xl border border-ink-100 bg-ink-50/50 p-3'
						>
							<label className='flex items-center gap-1.5 text-xs text-ink-500'>
								Desde&nbsp;USD
								<input
									type='number'
									value={tierFrom(i)}
									readOnly
									disabled
									title='Se ajusta solo con el "Hasta" del tramo anterior'
									className='w-20 rounded-lg border border-ink-200 bg-ink-100 px-2 py-1.5 text-sm text-ink-500'
								/>
							</label>

							{tier.max !== null ? (
								<label className='flex items-center gap-1.5 text-xs text-ink-500'>
									Hasta&nbsp;USD
									<NumInput
										value={tier.max}
										min={0}
										onChange={n => updateTier(i, { max: n })}
										className='w-24 rounded-lg border border-ink-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300'
									/>
								</label>
							) : (
								<span className='text-xs font-semibold text-ink-600'>en adelante</span>
							)}

							<label className='ml-auto flex items-center gap-1.5 text-xs text-ink-500'>
								Margen
								<NumInput
									value={tier.pct}
									min={0}
									onChange={n => updateTier(i, { pct: n })}
									className='w-20 rounded-lg border border-ink-200 px-2 py-1.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-brand-300'
								/>
								%
							</label>

							{tier.max !== null && (
								<button onClick={() => removeTier(i)} className='text-xs font-semibold text-rose-600 hover:text-rose-800'>
									Quitar
								</button>
							)}
							<p className='w-full text-[11px] text-ink-400'>{tierRangeText(i)}</p>
						</div>
					))}
				</div>

				<p className='mt-3 text-[11px] text-ink-500'>
					ℹ️ El monto <b>“Hasta”</b> no se incluye en el tramo: un costo igual a ese
					número entra en el tramo siguiente. Ej.: un costo de exactamente USD 20 cae
					en el tramo <b>“20 – 270”</b>, no en el <b>“0 – 20”</b>.
				</p>
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
