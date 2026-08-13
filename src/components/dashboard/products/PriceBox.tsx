import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UseFormRegister, UseFormSetValue, UseFormWatch } from 'react-hook-form';
import { ProductFormValues } from '../../../lib/validators';
import { usePricingConfig } from '../../../hooks';
import { getMlPricingConfig } from '../../../actions/ml-pricing';
import {
	DEFAULT_ML_PRICING,
	marginForSalePrice,
	mlMarginFor,
	salePrice,
	webMarginFor,
} from '../../../helpers';

interface Props {
	register: UseFormRegister<ProductFormValues>;
	watch: UseFormWatch<ProductFormValues>;
	setValue: UseFormSetValue<ProductFormValues>;
	categoryId: string;
	subcategoryId?: string;
}

const money = (n: number) =>
	`USD ${new Intl.NumberFormat('es-UY', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(isFinite(n) ? n : 0)}`;

const moneyRound = (n: number) =>
	`USD ${new Intl.NumberFormat('es-UY', {
		minimumFractionDigits: 0,
		maximumFractionDigits: 0,
	}).format(Math.ceil(isFinite(n) ? n : 0))}`;

// Desglose del precio en vivo: costo base -> margen -> IVA -> total.
// El admin puede tocar el MARGEN o directamente el TOTAL: los dos campos están
// vinculados (si escribe el total, se recalcula el margen que hay que guardar).
// Lo que se guarda siempre es el margen, así el precio sigue teniendo sentido si
// después cambia el costo.
export const PriceBox = ({
	register,
	watch,
	setValue,
	categoryId,
	subcategoryId,
}: Props) => {
	const pricing = usePricingConfig();
	const { data: mlPricingCfg } = useQuery({
		queryKey: ['ml_pricing_config'],
		queryFn: getMlPricingConfig,
	});
	const mlCfg = mlPricingCfg ?? DEFAULT_ML_PRICING;

	const cost = Number(watch('variants.0.price') ?? 0) || 0;
	const manual = watch('manualPrice') === true;
	const manualMargin = Number(watch('marginPercent') ?? 0) || 0;

	// Texto que el admin está tipeando en el campo del total (ver el input).
	const [totalDraft, setTotalDraft] = useState('');
	const [editingTotal, setEditingTotal] = useState(false);

	// Margen automático (el que rige si no hay precio manual).
	const autoWebMargin = webMarginFor(cost, pricing);
	const autoMlMargin = mlMarginFor(cost, categoryId || null, subcategoryId || null, mlCfg);

	const effWebMargin = manual ? manualMargin : autoWebMargin;
	const effMlMargin = manual ? manualMargin : autoMlMargin;

	const iva = pricing.iva_percent;
	const marginAmount = cost * (effWebMargin / 100);
	const ivaAmount = (cost + marginAmount) * (iva / 100);
	const webTotal = salePrice(cost, pricing, manual ? manualMargin : undefined);
	const mlTotal =
		cost > 0 ? Math.ceil(cost * (1 + effMlMargin / 100) * (1 + mlCfg.iva_percent / 100)) : 0;

	// El admin escribe el total -> guardamos el margen equivalente.
	const onTotalChange = (raw: string) => {
		const target = Number(raw);
		if (!raw || isNaN(target)) return;
		const pct = marginForSalePrice(cost, target, pricing);
		if (pct === null) return;
		setValue('marginPercent', pct, { shouldDirty: true });
	};

	// El checkbox lo maneja react-hook-form; encima le colgamos el arranque del
	// margen para que al prenderlo el precio no salte.
	const manualReg = register('manualPrice');
	const onManualChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		manualReg.onChange(e);
		if (e.target.checked && !manualMargin) {
			setValue('marginPercent', Math.round(autoWebMargin * 100) / 100, {
				shouldDirty: true,
			});
		}
	};

	return (
		<div className='mt-4 rounded-xl border border-slate-200 bg-white p-4'>
			<div className='mb-3 flex items-center justify-between gap-3'>
				<h3 className='text-sm font-bold text-slate-800'>Precio de venta</h3>
				<label className='flex cursor-pointer items-center gap-2'>
					<input
						type='checkbox'
						className='h-4 w-4 accent-amber-600'
						{...manualReg}
						onChange={onManualChange}
					/>
					<span className='text-xs font-semibold text-slate-700'>
						Precio manual
					</span>
				</label>
			</div>

			{cost <= 0 ? (
				<p className='text-xs text-slate-500'>
					Cargá el costo arriba para ver el precio final.
				</p>
			) : (
				<>
					<dl className='space-y-1.5 text-sm'>
						<div className='flex items-center justify-between'>
							<dt className='text-slate-600'>Costo base (sin IVA)</dt>
							<dd className='font-semibold text-slate-800'>{money(cost)}</dd>
						</div>

						<div className='flex items-center justify-between gap-3'>
							<dt className='text-slate-600'>
								Margen
								{!manual && (
									<span className='ml-1 text-xs text-slate-400'>
										(automático por tramo)
									</span>
								)}
							</dt>
							<dd className='flex items-center gap-2'>
								{manual ? (
									<div className='flex items-center gap-1'>
										<input
											type='number'
											step='0.01'
											min='0'
											className='w-24 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-right text-sm font-bold text-amber-900 focus:outline-none'
											{...register('marginPercent', { valueAsNumber: true })}
										/>
										<span className='text-sm font-bold text-amber-900'>%</span>
									</div>
								) : (
									<span className='font-semibold text-slate-800'>
										{autoWebMargin}%
									</span>
								)}
								<span className='w-24 text-right text-xs text-slate-500'>
									+{money(marginAmount)}
								</span>
							</dd>
						</div>

						<div className='flex items-center justify-between'>
							<dt className='text-slate-600'>IVA {iva}%</dt>
							<dd className='text-sm text-slate-600'>+{money(ivaAmount)}</dd>
						</div>
					</dl>

					<div className='mt-3 flex items-center justify-between gap-3 border-t border-slate-200 pt-3'>
						<span className='text-sm font-bold text-slate-900'>
							Precio final web
						</span>
						{manual ? (
							<div className='flex items-center gap-2'>
								<span className='text-xs font-semibold text-slate-500'>USD</span>
								<input
									type='number'
									step='1'
									min='0'
									// Mientras el admin escribe mandamos SU texto (si mostráramos el
									// total recalculado, el redondeo le movería el cursor y el valor
									// a cada tecla). Al salir del campo vuelve a mostrar el real.
									value={editingTotal ? totalDraft : String(webTotal)}
									onFocus={() => {
										setTotalDraft(String(webTotal));
										setEditingTotal(true);
									}}
									onChange={e => {
										setTotalDraft(e.target.value);
										onTotalChange(e.target.value);
									}}
									onBlur={() => setEditingTotal(false)}
									className='w-32 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-right text-base font-extrabold text-emerald-800 focus:outline-none'
								/>
							</div>
						) : (
							<span className='text-base font-extrabold text-emerald-700'>
								{moneyRound(webTotal)}
							</span>
						)}
					</div>

					<div className='mt-2 flex items-center justify-between text-sm'>
						<span className='text-slate-600'>
							Precio en Mercado Libre
							<span className='ml-1 text-xs text-slate-400'>
								({manual ? 'mismo margen manual' : `${effMlMargin}% por regla ML`})
							</span>
						</span>
						<span className='font-bold text-blue-700'>{moneyRound(mlTotal)}</span>
					</div>

					<p className='mt-3 text-xs text-slate-500'>
						{manual
							? 'Este margen pisa la tabla de márgenes en la web y en Mercado Libre. Si CDR te cambia el costo, el precio final se recalcula con este mismo margen: para clavarlo del todo, pausá la sync de precio (te lo vamos a preguntar al guardar).'
							: 'El precio sale de la tabla de márgenes por tramo de costo. Prendé “Precio manual” para fijarlo vos.'}
					</p>
				</>
			)}
		</div>
	);
};
