import { useEffect, useRef, useState } from 'react';
import { HiOutlineMapPin, HiOutlineTruck, HiOutlineCheckCircle, HiOutlineChevronDown } from 'react-icons/hi2';
import { useShippingRates, useUsdUyuRate } from '../../hooks';
import {
	URUGUAY_DEPARTMENTS_INTERIOR,
	MONTEVIDEO_ZONES,
	findZoneByBarrio,
	searchBarrios,
	DEFAULT_SHIPPING_RATES,
} from '../../constants/shipping';

export type ShippingZone = 'montevideo' | 'interior';

export interface ShippingSelection {
	zone: ShippingZone;
	barrio: string | null;       // sólo para Mvd
	tier: 'centro' | 'periferia' | 'costa' | null; // sólo para Mvd
	department: string | null;   // sólo para Interior
	cost_uyu: number;            // 0 para Interior (DAC)
	cost_usd: number;            // ya convertido (UYU / fx)
}

interface Props {
	value: ShippingSelection;
	onChange: (next: ShippingSelection) => void;
}

export const ShippingZoneSelector = ({ value, onChange }: Props) => {
	const { data: rates = DEFAULT_SHIPPING_RATES } = useShippingRates();
	const { data: fx } = useUsdUyuRate();
	const fxRate = fx?.rate ?? 0;

	const [barrioQuery, setBarrioQuery] = useState(value.barrio ?? '');
	const [suggestions, setSuggestions] = useState<
		ReturnType<typeof searchBarrios>
	>([]);
	const [showSuggestions, setShowSuggestions] = useState(false);
	const [showZoneList, setShowZoneList] = useState(false);
	const containerRef = useRef<HTMLDivElement | null>(null);

	// Agrupar barrios por tier para la lista de zonas
	const zonesByTier = {
		centro: MONTEVIDEO_ZONES.filter(z => z.tier === 'centro').flatMap(z => z.barrios),
		periferia: MONTEVIDEO_ZONES.filter(z => z.tier === 'periferia').flatMap(z => z.barrios),
		costa: MONTEVIDEO_ZONES.filter(z => z.tier === 'costa').flatMap(z => z.barrios),
	};

	// Recalcular costo cuando cambian rates o fxRate o el barrio detectado
	useEffect(() => {
		if (value.zone === 'interior') {
			const cost_uyu = rates.interior_uyu;
			const cost_usd = fxRate > 0 ? +(cost_uyu / fxRate).toFixed(2) : 0;
			if (value.cost_uyu !== cost_uyu || value.cost_usd !== cost_usd) {
				onChange({ ...value, cost_uyu, cost_usd });
			}
			return;
		}
		const tier = value.tier;
		const cost_uyu = tier ? rates.montevideo[tier] : 0;
		const cost_usd = fxRate > 0 && cost_uyu > 0 ? +(cost_uyu / fxRate).toFixed(2) : 0;
		if (value.cost_uyu !== cost_uyu || value.cost_usd !== cost_usd) {
			onChange({ ...value, cost_uyu, cost_usd });
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [rates, fxRate, value.zone, value.tier]);

	// Debounce búsqueda de barrios
	useEffect(() => {
		if (value.zone !== 'montevideo') return;
		const id = setTimeout(() => {
			setSuggestions(searchBarrios(barrioQuery));
		}, 80);
		return () => clearTimeout(id);
	}, [barrioQuery, value.zone]);

	// Cerrar dropdown al click fuera
	useEffect(() => {
		const onClick = (e: MouseEvent) => {
			if (
				containerRef.current &&
				!containerRef.current.contains(e.target as Node)
			) {
				setShowSuggestions(false);
			}
		};
		document.addEventListener('mousedown', onClick);
		return () => document.removeEventListener('mousedown', onClick);
	}, []);

	const handlePickBarrio = (barrio: string) => {
		const found = findZoneByBarrio(barrio);
		if (found) {
			setBarrioQuery(found.barrio);
			onChange({
				zone: 'montevideo',
				barrio: found.barrio,
				tier: found.tier,
				department: null,
				cost_uyu: rates.montevideo[found.tier],
				cost_usd: fxRate > 0 ? +(rates.montevideo[found.tier] / fxRate).toFixed(2) : 0,
			});
		}
		setShowSuggestions(false);
	};

	const setZoneMontevideo = () =>
		onChange({
			...value,
			zone: 'montevideo',
			department: null,
		});
	const setZoneInterior = () =>
		onChange({
			...value,
			zone: 'interior',
			barrio: null,
			tier: null,
		});

	return (
		<div className='space-y-3' ref={containerRef}>
			<h3 className='text-lg font-semibold'>Envío</h3>

			<div className='grid grid-cols-2 gap-3'>
				<button
					type='button'
					onClick={setZoneMontevideo}
					className={`flex items-center gap-2 p-3 rounded-lg border text-sm font-semibold transition-all ${
						value.zone === 'montevideo'
							? 'border-brand-600 bg-brand-50 text-brand-700 ring-2 ring-brand-200'
							: 'border-ink-200 bg-white text-ink-700 hover:border-ink-300'
					}`}
				>
					<HiOutlineMapPin size={18} />
					Montevideo
				</button>
				<button
					type='button'
					onClick={setZoneInterior}
					className={`flex items-center gap-2 p-3 rounded-lg border text-sm font-semibold transition-all ${
						value.zone === 'interior'
							? 'border-brand-600 bg-brand-50 text-brand-700 ring-2 ring-brand-200'
							: 'border-ink-200 bg-white text-ink-700 hover:border-ink-300'
					}`}
				>
					<HiOutlineTruck size={18} />
					Interior del país
				</button>
			</div>

			{/* Mvd: autocomplete barrio */}
			{value.zone === 'montevideo' && (
				<div className='relative'>
					<label className='text-xs font-medium text-ink-600'>
						Barrio (escribí para buscar)
					</label>
					<input
						type='text'
						className='mt-1 w-full border rounded p-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300'
						placeholder='Ej: Pocitos, Centro, Carrasco…'
						value={barrioQuery}
						onChange={e => {
							setBarrioQuery(e.target.value);
							setShowSuggestions(true);
						}}
						onFocus={() => setShowSuggestions(true)}
					/>
					{showSuggestions && suggestions.length > 0 && (
						<ul className='absolute z-10 mt-1 w-full max-h-60 overflow-auto rounded-lg border border-ink-200 bg-white shadow-card'>
							{suggestions.map(s => (
								<li key={s.name}>
									<button
										type='button'
										className='w-full text-left px-3 py-2 text-sm hover:bg-brand-50'
										onClick={() => handlePickBarrio(s.name)}
									>
										{s.name}
										<span className='ml-2 text-xs text-ink-400'>
											· {s.zoneId.replace('_', ' ')}
										</span>
									</button>
								</li>
							))}
						</ul>
					)}

					{value.barrio && value.tier && (
						<div className='mt-2 flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md p-2'>
							<HiOutlineCheckCircle size={16} />
							<span>
								Zona detectada: <b>{value.barrio}</b> ·{' '}
								Envío <b>UYU {value.cost_uyu}</b>
								{value.cost_usd > 0 && ` (≈ USD ${value.cost_usd.toFixed(2)})`}
							</span>
						</div>
					)}

					{/* Lista de zonas con costo */}
					<div className='mt-3 border border-ink-200 rounded-md overflow-hidden'>
						<button
							type='button'
							onClick={() => setShowZoneList(s => !s)}
							className='w-full flex items-center justify-between px-3 py-2 bg-ink-50 text-xs font-semibold text-ink-700 hover:bg-ink-100'
						>
							<span>Ver zonas y costos de envío en Montevideo</span>
							<HiOutlineChevronDown
								size={16}
								className={`transition-transform ${showZoneList ? 'rotate-180' : ''}`}
							/>
						</button>
						{showZoneList && (
							<div className='p-3 space-y-3 text-xs bg-white'>
								<ZoneRow
									title='Centro'
									cost={rates.montevideo.centro}
									barrios={zonesByTier.centro}
									onPick={handlePickBarrio}
								/>
								<ZoneRow
									title='Periferia'
									cost={rates.montevideo.periferia}
									barrios={zonesByTier.periferia}
									onPick={handlePickBarrio}
								/>
								<ZoneRow
									title='Costa'
									cost={rates.montevideo.costa}
									barrios={zonesByTier.costa}
									onPick={handlePickBarrio}
								/>
							</div>
						)}
					</div>
				</div>
			)}

			{/* Interior: dropdown departamento */}
			{value.zone === 'interior' && (
				<div>
					<label className='text-xs font-medium text-ink-600'>
						Departamento
					</label>
					<select
						className='mt-1 w-full border rounded p-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 bg-white'
						value={value.department ?? ''}
						onChange={e =>
							onChange({ ...value, department: e.target.value || null })
						}
					>
						<option value=''>Seleccioná un departamento…</option>
						{URUGUAY_DEPARTMENTS_INTERIOR.map(d => (
							<option key={d} value={d}>
								{d}
							</option>
						))}
					</select>
					<div className='mt-2 flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2'>
						<HiOutlineTruck size={16} />
						<span>
							Envío al interior por <b>DAC</b>. El costo lo abona el cliente al
							retirar en la agencia.
						</span>
					</div>
				</div>
			)}
		</div>
	);
};

export const emptyShippingSelection = (): ShippingSelection => ({
	zone: 'montevideo',
	barrio: null,
	tier: null,
	department: null,
	cost_uyu: 0,
	cost_usd: 0,
});

interface ZoneRowProps {
	title: string;
	cost: number;
	barrios: string[];
	onPick: (barrio: string) => void;
}

const ZoneRow = ({ title, cost, barrios, onPick }: ZoneRowProps) => {
	const [expanded, setExpanded] = useState(false);
	const preview = barrios.slice(0, 6).join(', ');
	const hasMore = barrios.length > 6;
	return (
		<div className='border-b border-ink-100 pb-2 last:border-0'>
			<div className='flex items-center justify-between mb-1'>
				<span className='font-semibold text-ink-700'>{title}</span>
				<span className='font-semibold text-brand-700'>UYU {cost}</span>
			</div>
			<p className='text-ink-500 leading-relaxed'>
				{expanded ? barrios.join(', ') : preview}
				{hasMore && (
					<button
						type='button'
						className='ml-1 text-brand-600 underline'
						onClick={() => setExpanded(e => !e)}
					>
						{expanded ? 'ver menos' : `+${barrios.length - 6} más`}
					</button>
				)}
			</p>
			<div className='mt-1 flex flex-wrap gap-1'>
				{barrios.slice(0, expanded ? barrios.length : 4).map(b => (
					<button
						key={b}
						type='button'
						onClick={() => onPick(b)}
						className='px-2 py-0.5 text-[10px] rounded-full border border-ink-200 hover:border-brand-400 hover:bg-brand-50'
					>
						{b}
					</button>
				))}
			</div>
		</div>
	);
};
