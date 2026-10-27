import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { HiOutlineTruck, HiOutlineMapPin } from 'react-icons/hi2';
import { DEFAULT_SHIPPING_RATES, ShippingRates } from '../../constants/shipping';
import { updateShippingRates } from '../../actions';
import { useShippingRates } from '../../hooks';
import { Loader } from '../../components/shared/Loader';

const inputCls =
	'w-24 rounded-lg border border-ink-200 px-2 py-1.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-brand-300';

export const DashboardShippingPage = () => {
	const queryClient = useQueryClient();
	const { data: persisted, isLoading } = useShippingRates();

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

	const setNum = (key: keyof ShippingRates, v: string) =>
		setRates(r => ({ ...r, [key]: Number(v) || 0 }));

	return (
		<div className='max-w-3xl space-y-6'>
			<div>
				<h1 className='text-2xl font-bold text-ink-900'>Envíos</h1>
				<p className='text-sm text-ink-500'>
					Tarifa fija por departamento, en dólares. Se suma al total del checkout y
					la recalcula el servidor al cobrar.
				</p>
			</div>

			{/* MONTEVIDEO Y CANELONES */}
			<div className='rounded-2xl border border-ink-200/70 bg-white p-5 shadow-soft space-y-4'>
				<div className='flex items-center gap-2'>
					<HiOutlineMapPin className='text-brand-600' size={22} />
					<h2 className='font-bold text-ink-900'>Envío a domicilio</h2>
				</div>

				{(
					[
						['montevideo_usd', 'Montevideo'],
						['canelones_usd', 'Canelones'],
					] as const
				).map(([key, label]) => (
					<div
						key={key}
						className='flex items-center justify-between gap-3 rounded-xl border border-ink-100 bg-ink-50/40 p-4'
					>
						<p className='font-semibold text-ink-800'>{label}</p>
						<label className='flex items-center gap-2 text-xs text-ink-600'>
							Precio
							<input
								type='number'
								min={0}
								step='0.5'
								value={rates[key]}
								onChange={e => setNum(key, e.target.value)}
								className={inputCls}
							/>
							USD
						</label>
					</div>
				))}

				<div className='rounded-xl border border-ink-100 bg-ink-50/40 p-4 space-y-3'>
					<label className='flex items-center justify-between gap-3 text-sm text-ink-700'>
						<span className='font-semibold text-ink-800'>Envío gratis a partir de</span>
						<span className='flex items-center gap-2 text-xs text-ink-600'>
							<input
								type='number'
								min={0}
								value={rates.free_min_usd}
								onChange={e => setNum('free_min_usd', e.target.value)}
								className={inputCls}
							/>
							USD
						</span>
					</label>
					<p className='text-[11px] text-ink-500'>
						Vale en Montevideo (y en Canelones si marcás la casilla). 0 = sin envío
						gratis.
					</p>
					<label className='flex items-center gap-2 text-sm text-ink-700 cursor-pointer'>
						<input
							type='checkbox'
							checked={rates.free_includes_canelones}
							onChange={e =>
								setRates(r => ({ ...r, free_includes_canelones: e.target.checked }))
							}
						/>
						También en Canelones
					</label>
				</div>

				<label className='flex items-center justify-between gap-3 rounded-xl border border-ink-100 bg-ink-50/40 p-4 text-sm'>
					<span>
						<span className='block font-semibold text-ink-800'>Entrega en el día</span>
						<span className='text-[11px] text-ink-500'>
							Comprando antes de esta hora (lunes a viernes) llega el mismo día.
						</span>
					</span>
					<span className='flex items-center gap-2 text-xs text-ink-600'>
						<input
							type='number'
							min={0}
							max={23}
							value={rates.same_day_cutoff_hour}
							onChange={e => setNum('same_day_cutoff_hour', e.target.value)}
							className={inputCls}
						/>
						h
					</span>
				</label>
			</div>

			{/* INTERIOR */}
			<div className='rounded-2xl border border-ink-200/70 bg-white p-5 shadow-soft space-y-2'>
				<div className='flex items-center gap-2'>
					<HiOutlineTruck className='text-brand-600' size={22} />
					<h2 className='font-bold text-ink-900'>Resto del país (DAC)</h2>
				</div>
				<p className='text-sm text-ink-500'>
					El resto de los departamentos va por DAC y el cliente paga el envío al
					retirar en la agencia. No se suma al total.
				</p>
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
