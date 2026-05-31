import { useEffect, useState } from 'react';
import { HiOutlineAdjustmentsHorizontal } from 'react-icons/hi2';
import { useBrandsByCategories, useTaxonomies } from '../../hooks';

interface Props {
	selectedBrands: string[];
	setSelectedBrands: (brands: string[]) => void;
	selectedCategories: string[];
	setSelectedCategories: (categories: string[]) => void;
	selectedSubcategories: string[];
	setSelectedSubcategories: (subs: string[]) => void;
	priceMin?: number;
	priceMax?: number;
	setPriceMin: (v?: number) => void;
	setPriceMax: (v?: number) => void;
}

const VISIBLE = 6;

interface Option {
	id: string;
	name: string;
}

/* Bloque de checkboxes con "Ver más / Ver menos" */
const CheckboxBlock = ({
	title,
	options,
	selected,
	onToggle,
	emptyHint,
}: {
	title: string;
	options: Option[];
	selected: string[];
	onToggle: (id: string) => void;
	emptyHint?: string;
}) => {
	const [showAll, setShowAll] = useState(false);
	const visible = showAll ? options : options.slice(0, VISIBLE);

	return (
		<div className='flex flex-col gap-2.5'>
			<h4 className='text-xs font-bold uppercase tracking-wider text-ink-500'>
				{title}
			</h4>

			{options.length === 0 ? (
				<p className='text-xs text-ink-400'>{emptyHint ?? 'Sin opciones.'}</p>
			) : (
				<>
					<div className='flex flex-col gap-2'>
						{visible.map(opt => (
							<label
								key={opt.id}
								className='inline-flex items-center gap-2.5 cursor-pointer group'
							>
								<input
									type='checkbox'
									className='w-4 h-4 rounded border-ink-300 text-brand-600 focus:ring-brand-600/30 focus:ring-2 accent-brand-600 cursor-pointer'
									checked={selected.includes(opt.id)}
									onChange={() => onToggle(opt.id)}
								/>
								<span className='text-sm text-ink-700 group-hover:text-ink-900 transition-colors'>
									{opt.name}
								</span>
							</label>
						))}
					</div>

					{options.length > VISIBLE && (
						<button
							onClick={() => setShowAll(s => !s)}
							className='self-start text-xs font-semibold text-brand-700 hover:text-brand-900'
						>
							{showAll ? 'Ver menos' : `Ver más (${options.length - VISIBLE})`}
						</button>
					)}
				</>
			)}
		</div>
	);
};

export const ContainerFilter = ({
	selectedBrands,
	setSelectedBrands,
	selectedCategories,
	setSelectedCategories,
	selectedSubcategories,
	setSelectedSubcategories,
	priceMin,
	priceMax,
	setPriceMin,
	setPriceMax,
}: Props) => {
	const { brands, categories, subcategories } = useTaxonomies();
	const { data: availableBrandIds } = useBrandsByCategories(
		selectedCategories,
		selectedSubcategories
	);
	const [localMin, setLocalMin] = useState<string>(priceMin?.toString() || '');
	const [localMax, setLocalMax] = useState<string>(priceMax?.toString() || '');

	// Si hay categorías seleccionadas, mostramos sólo las marcas que tienen
	// productos en ellas (evita marcas vacías). Mientras carga, mostramos todas.
	const visibleBrands =
		selectedCategories.length > 0 && availableBrandIds
			? brands.filter(b => availableBrandIds.includes(b.id))
			: brands;

	// Quitamos de la selección las marcas que ya no aplican a la categoría elegida,
	// para que el listado de productos no quede filtrado por una marca oculta.
	useEffect(() => {
		if (selectedCategories.length === 0 || !availableBrandIds) return;
		const pruned = selectedBrands.filter(id => availableBrandIds.includes(id));
		if (pruned.length !== selectedBrands.length) setSelectedBrands(pruned);
	}, [availableBrandIds, selectedCategories, selectedBrands, setSelectedBrands]);

	const toggle = (list: string[], setList: (v: string[]) => void, id: string) => {
		if (list.includes(id)) setList(list.filter(b => b !== id));
		else setList([...list, id]);
	};

	// Subcategorías visibles: si hay categorías seleccionadas, sólo las de esas categorías.
	const visibleSubcategories =
		selectedCategories.length > 0
			? subcategories.filter(s => selectedCategories.includes(s.category_id))
			: subcategories;

	const applyMin = (v: string) => {
		setLocalMin(v);
		setPriceMin(v === '' ? undefined : Number(v));
	};
	const applyMax = (v: string) => {
		setLocalMax(v);
		setPriceMax(v === '' ? undefined : Number(v));
	};

	const totalActive =
		selectedBrands.length +
		selectedCategories.length +
		selectedSubcategories.length +
		(priceMin !== undefined ? 1 : 0) +
		(priceMax !== undefined ? 1 : 0);

	const clearAll = () => {
		setSelectedBrands([]);
		setSelectedCategories([]);
		setSelectedSubcategories([]);
		setLocalMin('');
		setLocalMax('');
		setPriceMin(undefined);
		setPriceMax(undefined);
	};

	return (
		<div className='p-5 bg-white border border-ink-200 rounded-xl shadow-soft h-fit col-span-2 lg:col-span-1'>
			<div className='flex items-center justify-between mb-5'>
				<div className='flex items-center gap-2'>
					<HiOutlineAdjustmentsHorizontal className='text-brand-700' size={20} />
					<h3 className='text-base font-bold text-ink-900'>Filtros</h3>
					{totalActive > 0 && (
						<span className='inline-flex items-center justify-center min-w-5 h-5 px-1.5 text-[10px] font-bold rounded-full bg-brand-600 text-white'>
							{totalActive}
						</span>
					)}
				</div>
				{totalActive > 0 && (
					<button
						onClick={clearAll}
						className='text-xs font-semibold text-brand-700 hover:text-brand-900'
					>
						Limpiar
					</button>
				)}
			</div>

			<div className='flex flex-col gap-6'>
				{/* 1. Categorías */}
				<CheckboxBlock
					title='Categorías'
					options={categories.map(c => ({ id: c.id, name: c.name }))}
					selected={selectedCategories}
					onToggle={id =>
						toggle(selectedCategories, setSelectedCategories, id)
					}
				/>

				{/* 2. Subcategorías — sólo si hay categorías filtradas */}
				{selectedCategories.length > 0 && (
					<>
						<div className='h-px bg-ink-100' />
						<CheckboxBlock
							title='Subcategorías'
							options={visibleSubcategories.map(s => ({ id: s.id, name: s.name }))}
							selected={selectedSubcategories}
							onToggle={id =>
								toggle(selectedSubcategories, setSelectedSubcategories, id)
							}
							emptyHint='Esta categoría no tiene subcategorías.'
						/>
					</>
				)}

				<div className='h-px bg-ink-100' />

				{/* 3. Marcas */}
				<CheckboxBlock
					title='Marcas'
					options={visibleBrands.map(b => ({ id: b.id, name: b.name }))}
					selected={selectedBrands}
					onToggle={id => toggle(selectedBrands, setSelectedBrands, id)}
					emptyHint={
						selectedCategories.length > 0
							? 'No hay marcas con productos en esta categoría.'
							: 'Sin marcas.'
					}
				/>

				<div className='h-px bg-ink-100' />

				{/* 4. Precio */}
				<div className='flex flex-col gap-2.5'>
					<h4 className='text-xs font-bold uppercase tracking-wider text-ink-500'>
						Precio
					</h4>
					<div className='flex items-center gap-2'>
						<input
							type='number'
							className='w-full px-3 py-2 text-sm bg-white border border-ink-200 rounded-lg placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600 transition-all'
							placeholder='Mín'
							value={localMin}
							onChange={e => applyMin(e.target.value)}
						/>
						<span className='text-ink-400 text-sm'>—</span>
						<input
							type='number'
							className='w-full px-3 py-2 text-sm bg-white border border-ink-200 rounded-lg placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600 transition-all'
							placeholder='Máx'
							value={localMax}
							onChange={e => applyMax(e.target.value)}
						/>
					</div>
				</div>
			</div>
		</div>
	);
};
