import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { HiOutlineTruck, HiOutlineMapPin } from 'react-icons/hi2';
import {
	DEFAULT_SHIPPING_RATES,
	ShippingRates,
	MONTEVIDEO_ZONES,
} from '../../constants/shipping';
import { updateShippingRates } from '../../actions';
import { useShippingRates, useUsdUyuRate } from '../../hooks';
import { Loader } from '../../components/shared/Loader';

export const DashboardShippingPage = () => {
	const queryClient = useQueryClient();
	const { data: persisted, isLoading } = useShippingRates();
	const { data: fx } = useUsdUyuRate();

	const [rates, setRates] = useState<ShippingRates>(DEFAULT_SHIPPING_RATES);

	useEffect(() => {
		if (persisted) setRates(persisted);
	}, [persisted]);

	const save = useMutation({
		mutationFn: () => updateShippingRates(rates),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['shipping_rates'] });
			toast.success('Tarifas guardadas', { position: 'bottom-right' });
		},
		onError: (e: Error) => toast.error(e.message),
	});

	if (isLoading) return <Loader />;

	const toUsd = (uyu: number) =>
		fx?.rate ? `≈ USD ${(uyu / fx.rate).toFixed(2)}` : '';

	const tierLabel: Record<keyof ShippingRates['montevideo'], string> = {
		centro: 'Centro / Costa este (Zonas 5, 6, 7)',
		periferia: 'Periferia (Zonas 1, 2, 3, 4)',
		costa: 'Costa de oro / Canelones (Zonas 8, 9, 10, 11)',
	};

	const setMvd = (tier: keyof ShippingRates['montevideo'], v: string) =>
		setRates(r => ({
			...r,
			montevideo: { ...r.montevideo, [tier]: Number(v) || 0 },
		}));

	const zonesByTier = (tier: keyof ShippingRates['montevideo']) =>
		MONTEVIDEO_ZONES.filter(z => z.tier === tier);

	return (
		<div className='max-w-3xl space-y-6'>
			<div>
				<h1 className='text-2xl font-bold text-ink-900'>Envíos</h1>
				<p className='text-sm text-ink-500'>
					Configurá las tarifas de envío por zona (en pesos uruguayos). En el
					checkout se convierten a USD usando la cotización del BCU oficial del día
					y se suman al total.
				</p>
			</div>

			{/* MONTEVIDEO */}
			<div className='rounded-2xl border border-ink-200/70 bg-white p-5 shadow-soft space-y-4'>
				<div className='flex items-center gap-2'>
					<HiOutlineMapPin className='text-brand-600' size={22} />
					<h2 className='font-bold text-ink-900'>Montevideo (por zona)</h2>
				</div>

				{(['centro', 'periferia', 'costa'] as const).map(tier => (
					<div
						key={tier}
						className='rounded-xl border border-ink-100 bg-ink-50/40 p-4 space-y-2'
					>
						<div className='flex items-end justify-between gap-3'>
							<div className='flex-1'>
								<p className='font-semibold text-ink-800'>{tierLabel[tier]}</p>
								<p className='text-[11px] text-ink-500'>
									{zonesByTier(tier).flatMap(z => z.barrios).slice(0, 5).join(', ')}
									{' '}…
								</p>
							</div>
							<label className='flex items-center gap-2 text-xs text-ink-600'>
								Precio
								<input
									type='number'
									value={rates.montevideo[tier]}
									onChange={e => setMvd(tier, e.target.value)}
									className='w-24 rounded-lg border border-ink-200 px-2 py-1.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-brand-300'
								/>
								UYU
								<span className='text-ink-400 text-[11px]'>{toUsd(rates.montevideo[tier])}</span>
							</label>
						</div>
					</div>
				))}
			</div>

			{/* INTERIOR */}
			<div className='rounded-2xl border border-ink-200/70 bg-white p-5 shadow-soft space-y-3'>
				<div className='flex items-center gap-2'>
					<HiOutlineTruck className='text-brand-600' size={22} />
					<h2 className='font-bold text-ink-900'>Interior del país (DAC)</h2>
				</div>
				<p className='text-sm text-ink-500'>
					Para el interior, lo habitual es que el cliente pague el envío en la
					agencia DAC al retirar. Si querés cobrarlo al checkout, ponele un valor.
				</p>
				<label className='flex items-center gap-2 text-xs text-ink-600'>
					Precio
					<input
						type='number'
						value={rates.interior_uyu}
						onChange={e =>
							setRates(r => ({ ...r, interior_uyu: Number(e.target.value) || 0 }))
						}
						className='w-24 rounded-lg border border-ink-200 px-2 py-1.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-brand-300'
					/>
					UYU
					<span className='text-ink-400 text-[11px]'>{toUsd(rates.interior_uyu)}</span>
					<span className='ml-2 text-[11px] text-ink-500'>
						{rates.interior_uyu === 0
							? '(0 = el cliente paga en DAC)'
							: '(se cobra al checkout)'}
					</span>
				</label>
			</div>

			<button
				onClick={() => save.mutate()}
				disabled={save.isPending}
				className='rounded-full bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white shadow-soft transition-all hover:bg-brand-700 disabled:opacity-60'
			>
				{save.isPending ? 'Guardando…' : 'Guardar cambios'}
			</button>
		</div>
	);
};
