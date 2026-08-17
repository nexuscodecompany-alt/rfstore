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
	webMarginFor,
} from '../../../helpers';

interface Props {
	register: UseFormRegister<ProductFormValues>;
	watch: UseFormWatch<ProductFormValues>;
	setValue: UseFormSetValue<ProductFormValues>;
	categoryId: string;
	subcategoryId?: string;
	/** Producto del catálogo de CDR: sólo ahí hay costo sincronizado que congelar. */
	isCdrProduct?: boolean;
	/** products.price_locked: el costo está congelado y CDR no lo pisa. */
	costLocked?: boolean;
	/** Abre el modal de candados desde acá. */
	onEditSync?: () => void;
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

type Channel = 'web' | 'ml';

interface ChannelTheme {
	title: string;
	hint: string;
	/** Clases del acento: se usan en el borde, el total y el input de margen. */
	total: string;
	marginInput: string;
	totalInput: string;
	dot: string;
}

const THEME: Record<Channel, ChannelTheme> = {
	web: {
		title: 'RF Store (web)',
		hint: 'Tabla de márgenes por tramo de costo.',
		total: 'text-emerald-700',
		marginInput: 'border-emerald-300 bg-emerald-50/70 text-emerald-900',
		totalInput: 'border-emerald-300 bg-emerald-50 text-emerald-800',
		dot: 'bg-emerald-500',
	},
	ml: {
		title: 'Mercado Libre',
		hint: 'Reglas de margen de ML (tramos y categoría).',
		total: 'text-blue-700',
		marginInput: 'border-blue-300 bg-blue-50/70 text-blue-900',
		totalInput: 'border-blue-300 bg-blue-50 text-blue-800',
		dot: 'bg-blue-500',
	},
};

interface PanelProps {
	channel: Channel;
	cost: number;
	ivaPercent: number;
	autoMargin: number;
	manual: boolean;
	manualMargin: number;
	/** Campos del form que maneja este panel. */
	manualField: 'manualPrice' | 'manualPriceMl';
	marginField: 'marginPercent' | 'marginPercentMl';
	register: UseFormRegister<ProductFormValues>;
	setValue: UseFormSetValue<ProductFormValues>;
}

// Un canal: costo -> margen -> IVA -> total. Con "precio manual" prendido, el margen
// y el total son editables y están vinculados (se escribe uno, sale el otro).
const ChannelPanel = ({
	channel,
	cost,
	ivaPercent,
	autoMargin,
	manual,
	manualMargin,
	manualField,
	marginField,
	register,
	setValue,
}: PanelProps) => {
	const theme = THEME[channel];
	// Texto que el admin está tipeando en el total. Mientras edita mandamos SU texto:
	// si mostráramos el total recalculado, el redondeo le movería el cursor a cada tecla.
	const [totalDraft, setTotalDraft] = useState('');
	const [editingTotal, setEditingTotal] = useState(false);

	const effMargin = manual ? manualMargin : autoMargin;
	const marginAmount = cost * (effMargin / 100);
	const ivaAmount = (cost + marginAmount) * (ivaPercent / 100);
	const total = cost > 0 ? Math.ceil(cost * (1 + effMargin / 100) * (1 + ivaPercent / 100)) : 0;

	const onTotalChange = (raw: string) => {
		const target = Number(raw);
		if (!raw || isNaN(target)) return;
		const pct = marginForSalePrice(cost, target, { iva_percent: ivaPercent });
		if (pct === null) return;
		setValue(marginField, pct, { shouldDirty: true });
	};

	// El checkbox lo maneja react-hook-form; encima le colgamos el arranque del margen
	// para que al prenderlo el precio no salte.
	const manualReg = register(manualField);
	const onManualChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		manualReg.onChange(e);
		if (e.target.checked && !manualMargin) {
			setValue(marginField, Math.round(autoMargin * 100) / 100, { shouldDirty: true });
		}
	};

	return (
		<div
			className={`rounded-xl border p-4 transition-colors ${
				manual ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200 bg-white'
			}`}
		>
			<div className="mb-3 flex items-start justify-between gap-3">
				<h4 className="flex items-center gap-2 text-sm font-bold text-slate-800">
					<span className={`h-2 w-2 rounded-full ${theme.dot}`} aria-hidden />
					{theme.title}
				</h4>
				<label className="flex cursor-pointer items-center gap-1.5">
					<input
						type="checkbox"
						className="h-4 w-4 accent-amber-600"
						{...manualReg}
						onChange={onManualChange}
					/>
					<span className="whitespace-nowrap text-xs font-semibold text-slate-700">
						Precio manual
					</span>
				</label>
			</div>

			{cost <= 0 ? (
				<p className="text-xs text-slate-500">Cargá el costo para ver el precio.</p>
			) : (
				<>
					<dl className="space-y-1.5 text-sm">
						<div className="flex items-baseline justify-between gap-2">
							<dt className="text-slate-600">Costo base</dt>
							<dd className="font-semibold text-slate-800">{money(cost)}</dd>
						</div>

						<div className="flex items-center justify-between gap-2">
							<dt className="text-slate-600">
								Margen
								{!manual && (
									<span className="ml-1 text-xs text-slate-400">(automático)</span>
								)}
							</dt>
							<dd className="flex items-center gap-2">
								{manual ? (
									<div className="flex items-center gap-1">
										<input
											type="number"
											step="0.01"
											min="0"
											className={`w-20 rounded-md border px-2 py-1 text-right text-sm font-bold focus:outline-none ${theme.marginInput}`}
											{...register(marginField, { valueAsNumber: true })}
										/>
										<span className="text-sm font-bold text-slate-700">%</span>
									</div>
								) : (
									<span className="font-semibold text-slate-800">{autoMargin}%</span>
								)}
								<span className="w-20 text-right text-xs text-slate-500">
									+{money(marginAmount)}
								</span>
							</dd>
						</div>

						<div className="flex items-baseline justify-between gap-2">
							<dt className="text-slate-600">IVA {ivaPercent}%</dt>
							<dd className="text-sm text-slate-600">+{money(ivaAmount)}</dd>
						</div>
					</dl>

					<div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-200 pt-3">
						<span className="text-sm font-bold text-slate-900">Precio final</span>
						{manual ? (
							<div className="flex items-center gap-1.5">
								<span className="text-xs font-semibold text-slate-500">USD</span>
								<input
									type="number"
									step="1"
									min="0"
									value={editingTotal ? totalDraft : String(total)}
									onFocus={() => {
										setTotalDraft(String(total));
										setEditingTotal(true);
									}}
									onChange={e => {
										setTotalDraft(e.target.value);
										onTotalChange(e.target.value);
									}}
									onBlur={() => setEditingTotal(false)}
									className={`w-28 rounded-md border px-2 py-1 text-right text-base font-extrabold focus:outline-none ${theme.totalInput}`}
								/>
							</div>
						) : (
							<span className={`text-base font-extrabold ${theme.total}`}>
								{moneyRound(total)}
							</span>
						)}
					</div>

					<p className="mt-2 text-xs text-slate-500">
						{manual
							? 'Lo fijás vos. Si CDR te cambia el costo, el precio se recalcula con este mismo margen.'
							: theme.hint}
					</p>
				</>
			)}
		</div>
	);
};

// Precio de venta por canal. Son dos precios distintos a propósito: en Mercado Libre
// hay que vender más caro para cubrir la comisión, así que cada uno tiene su margen
// y se ajustan por separado.
export const PriceBox = ({
	register,
	watch,
	setValue,
	categoryId,
	subcategoryId,
	isCdrProduct = false,
	costLocked = false,
	onEditSync,
}: Props) => {
	const pricing = usePricingConfig();
	const { data: mlPricingCfg } = useQuery({
		queryKey: ['ml_pricing_config'],
		queryFn: getMlPricingConfig,
	});
	const mlCfg = mlPricingCfg ?? DEFAULT_ML_PRICING;

	const cost = Number(watch('variants.0.price') ?? 0) || 0;

	const autoWebMargin = webMarginFor(cost, pricing);
	const autoMlMargin = mlMarginFor(cost, categoryId || null, subcategoryId || null, mlCfg);

	const manualWeb = watch('manualPrice') === true;
	const manualMl = watch('manualPriceMl') === true;

	return (
		<div className="mt-4">
			<div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
				<h3 className="text-sm font-bold text-slate-800">Precio de venta</h3>
				<span className="text-xs text-slate-500">
					Cada canal tiene su margen: se ajustan por separado.
				</span>
			</div>

			{/* De dónde sale el COSTO, que es la otra mitad del precio. Se muestra acá
			    para que no haya que adivinar por qué un precio se mueve solo: el margen
			    lo ponés vos, el costo lo puede seguir moviendo CDR. */}
			{isCdrProduct && cost > 0 && (
				<div
					className={`mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs ${
						costLocked
							? 'border-amber-200 bg-amber-50 text-amber-900'
							: 'border-slate-200 bg-slate-50 text-slate-600'
					}`}
				>
					<span>
						<span className="font-bold">
							{costLocked ? 'Costo congelado' : 'Costo sincronizado con CDR'}
						</span>
						{costLocked
							? ' — CDR no lo toca, tu precio queda clavado.'
							: ' — si CDR lo cambia, el precio final se recalcula con tu margen.'}
					</span>
					{onEditSync && (
						<button
							type="button"
							onClick={onEditSync}
							className="shrink-0 font-semibold text-brand-700 underline underline-offset-2 hover:text-brand-800"
						>
							{costLocked ? 'Volver a sincronizar' : 'Congelar costo'}
						</button>
					)}
				</div>
			)}

			<div className="grid gap-3 md:grid-cols-2">
				<ChannelPanel
					channel="web"
					cost={cost}
					ivaPercent={pricing.iva_percent}
					autoMargin={autoWebMargin}
					manual={manualWeb}
					manualMargin={Number(watch('marginPercent') ?? 0) || 0}
					manualField="manualPrice"
					marginField="marginPercent"
					register={register}
					setValue={setValue}
				/>
				<ChannelPanel
					channel="ml"
					cost={cost}
					ivaPercent={mlCfg.iva_percent}
					autoMargin={autoMlMargin}
					manual={manualMl}
					manualMargin={Number(watch('marginPercentMl') ?? 0) || 0}
					manualField="manualPriceMl"
					marginField="marginPercentMl"
					register={register}
					setValue={setValue}
				/>
			</div>

			{(manualWeb || manualMl) && isCdrProduct && !costLocked && (
				<p className="mt-2 text-xs text-slate-500">
					Al guardar te preguntamos si querés congelar el costo, así el precio que
					fijaste no se mueve cuando CDR cambie el suyo.
				</p>
			)}
		</div>
	);
};
