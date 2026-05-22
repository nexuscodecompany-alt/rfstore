import { useState, useEffect } from 'react';
import { HiOutlineAdjustmentsHorizontal } from 'react-icons/hi2';
import { useTaxonomies } from '../../hooks';

interface Props {
	selectedBrands: string[];
	setSelectedBrands: (brands: string[]) => void;
	selectedCategories: string[];
	setSelectedCategories: (categories: string[]) => void;
	priceMin?: number;
	priceMax?: number;
	setPriceMin: (v?: number) => void;
	setPriceMax: (v?: number) => void;
}

export const ContainerFilter = ({
	selectedBrands,
	setSelectedBrands,
	selectedCategories,
	setSelectedCategories,
	priceMin,
	priceMax,
	setPriceMin,
	setPriceMax,
}: Props) => {
	const { brands, categories } = useTaxonomies();
	const [localMin, setLocalMin] = useState<string>(priceMin?.toString() || '');
	const [localMax, setLocalMax] = useState<string>(priceMax?.toString() || '');

	useEffect(() => {
		setPriceMin(localMin === '' ? undefined : Number(localMin));
	}, [localMin, setPriceMin]);
	useEffect(() => {
		setPriceMax(localMax === '' ? undefined : Number(localMax));
	}, [localMax, setPriceMax]);

	const toggle = (list: string[], setList: (v: string[]) => void, id: string) => {
		if (list.includes(id)) setList(list.filter(b => b !== id));
		else setList([...list, id]);
	};

	const totalActive =
		selectedBrands.length +
		selectedCategories.length +
		(priceMin !== undefined ? 1 : 0) +
		(priceMax !== undefined ? 1 : 0);

	const clearAll = () => {
		setSelectedBrands([]);
		setSelectedCategories([]);
		setLocalMin('');
		setLocalMax('');
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
				<div className='flex flex-col gap-2.5'>
					<h4 className='text-xs font-bold uppercase tracking-wider text-ink-500'>Marcas</h4>
					<div className='flex flex-col gap-2'>
						{brands.map(brand => (
							<label
								key={brand.id}
								className='inline-flex items-center gap-2.5 cursor-pointer group'
							>
								<input
									type='checkbox'
									className='w-4 h-4 rounded border-ink-300 text-brand-600 focus:ring-brand-600/30 focus:ring-2 accent-brand-600 cursor-pointer'
									checked={selectedBrands.includes(brand.id)}
									onChange={() => toggle(selectedBrands, setSelectedBrands, brand.id)}
								/>
								<span className='text-sm text-ink-700 group-hover:text-ink-900 transition-colors'>
									{brand.name}
								</span>
							</label>
						))}
					</div>
				</div>

				<div className='h-px bg-ink-100' />

				<div className='flex flex-col gap-2.5'>
					<h4 className='text-xs font-bold uppercase tracking-wider text-ink-500'>Categorías</h4>
					<div className='flex flex-col gap-2'>
						{categories.map(category => (
							<label
								key={category.id}
								className='inline-flex items-center gap-2.5 cursor-pointer group'
							>
								<input
									type='checkbox'
									className='w-4 h-4 rounded border-ink-300 text-brand-600 focus:ring-brand-600/30 focus:ring-2 accent-brand-600 cursor-pointer'
									checked={selectedCategories.includes(category.id)}
									onChange={() => toggle(selectedCategories, setSelectedCategories, category.id)}
								/>
								<span className='text-sm text-ink-700 group-hover:text-ink-900 transition-colors'>
									{category.name}
								</span>
							</label>
						))}
					</div>
				</div>

				<div className='h-px bg-ink-100' />

				<div className='flex flex-col gap-2.5'>
					<h4 className='text-xs font-bold uppercase tracking-wider text-ink-500'>Precio</h4>
					<div className='flex items-center gap-2'>
						<input
							type='number'
							className='w-full px-3 py-2 text-sm bg-white border border-ink-200 rounded-lg placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600 transition-all'
							placeholder='Mín'
							value={localMin}
							onChange={e => setLocalMin(e.target.value)}
						/>
						<span className='text-ink-400 text-sm'>—</span>
						<input
							type='number'
							className='w-full px-3 py-2 text-sm bg-white border border-ink-200 rounded-lg placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600 transition-all'
							placeholder='Máx'
							value={localMax}
							onChange={e => setLocalMax(e.target.value)}
						/>
					</div>
				</div>
			</div>
		</div>
	);
};
