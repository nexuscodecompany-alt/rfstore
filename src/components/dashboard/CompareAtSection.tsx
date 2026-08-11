import { useEffect, useState } from 'react';
import { useCompareAtConfig, useUpdateCompareAtConfig } from '../../hooks';
import { compareAtFor, formatPrice } from '../../helpers';

const PRESET_OPTIONS = [5, 10, 15, 20];

/**
 * Precio "antes / ahora" de la vidriera.
 * Es SÓLO presentación: el precio que se cobra sigue saliendo del margen por
 * tramo + IVA, y Mercado Libre no se toca (allá manda ml_pricing_config).
 */
export const CompareAtSection = () => {
	const cfg = useCompareAtConfig();
	const { mutate: save, isPending } = useUpdateCompareAtConfig();

	const [enabled, setEnabled] = useState(cfg.enabled);
	const [percents, setPercents] = useState<number[]>(cfg.percents);

	useEffect(() => {
		setEnabled(cfg.enabled);
		setPercents(cfg.percents);
	}, [cfg.enabled, cfg.percents]);

	const togglePercent = (p: number) =>
		setPercents(prev =>
			prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p].sort((a, b) => a - b)
		);

	// Vista previa con dos ids fijos: muestra los dos porcentajes en juego.
	const preview = [
		{ id: 'preview-a', price: 199 },
		{ id: 'preview-b', price: 449 },
	].map(x => ({
		...x,
		res: compareAtFor(x.id, x.price, { enabled: true, percents }),
	}));

	return (
		<section className='space-y-4 rounded-2xl border border-ink-200 bg-white p-5'>
			<div>
				<h2 className='text-base font-bold text-ink-900'>
					Precio "antes / ahora" en la vidriera
				</h2>
				<p className='mt-1 text-sm text-ink-500'>
					Muestra un precio anterior tachado y el % de descuento en la tarjeta y
					en la ficha del producto. <b>No cambia el precio que se cobra</b> ni el
					de Mercado Libre. A cada producto le toca uno de los porcentajes
					marcados, siempre el mismo (sale de su código, no se sortea de nuevo en
					cada visita).
				</p>
			</div>

			<label className='flex items-center gap-3'>
				<input
					type='checkbox'
					className='h-4 w-4 accent-brand-600'
					checked={enabled}
					onChange={e => setEnabled(e.target.checked)}
				/>
				<span className='text-sm font-semibold text-ink-800'>
					Mostrar precio anterior tachado
				</span>
			</label>

			<div className='space-y-2'>
				<p className='text-xs font-bold uppercase tracking-wider text-ink-500'>
					Porcentajes a repartir
				</p>
				<div className='flex flex-wrap gap-2'>
					{PRESET_OPTIONS.map(p => (
						<button
							key={p}
							type='button'
							onClick={() => togglePercent(p)}
							className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition-all ${
								percents.includes(p)
									? 'border-brand-600 bg-brand-600 text-white'
									: 'border-ink-200 bg-white text-ink-600 hover:border-ink-300'
							}`}
						>
							{p}%
						</button>
					))}
				</div>
				{percents.length === 0 && (
					<p className='text-xs text-rose-600'>
						Elegí al menos un porcentaje.
					</p>
				)}
			</div>

			<div className='rounded-xl bg-ink-50 p-3'>
				<p className='mb-2 text-xs font-bold uppercase tracking-wider text-ink-500'>
					Así se ve
				</p>
				<div className='flex flex-wrap gap-5'>
					{preview.map(x => (
						<div key={x.id} className='flex items-baseline gap-2'>
							{x.res && (
								<span className='text-xs text-ink-400 line-through'>
									{formatPrice(x.res.before)}
								</span>
							)}
							<span className='text-base font-bold text-ink-900'>
								{formatPrice(x.price)}
							</span>
							{x.res && (
								<span className='rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white'>
									-{x.res.percent}%
								</span>
							)}
						</div>
					))}
				</div>
			</div>

			<button
				type='button'
				disabled={isPending || percents.length === 0}
				onClick={() => save({ enabled, percents })}
				className='rounded-lg bg-ink-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50'
			>
				{isPending ? 'Guardando…' : 'Guardar'}
			</button>
		</section>
	);
};
