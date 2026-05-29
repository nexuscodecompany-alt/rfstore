import { useState, useEffect } from 'react';
import { HiOutlineArrowDown, HiOutlineArrowUp, HiOutlineSearch } from 'react-icons/hi';
import { CardProduct } from '../components/products/CardProduct';
import { ContainerFilter } from '../components/products/ContainerFilter';
import { prepareProducts } from '../helpers';
import {
	ALL_ICON,
	NEW_ARRIVALS_ICON,
	getCategoryIcon,
} from '../helpers/categoryIcons';
import { useFilteredProducts, useTaxonomies } from '../hooks';
import { Pagination } from '../components/shared/Pagination';
import WhatsAppButton from '../components/shared/WhatsAppButton';
import { IconType } from 'react-icons';

const CategoryPill = ({
	active,
	label,
	Icon,
	onClick,
	highlight,
}: {
	active: boolean;
	label: string;
	Icon: IconType;
	onClick: () => void;
	highlight?: boolean;
}) => (
	<button
		onClick={onClick}
		className={`group flex items-center justify-center gap-1.5 sm:gap-2 rounded-xl px-2.5 py-2.5 sm:px-3 text-[11px] sm:text-xs font-semibold transition-all border ${
			active
				? highlight
					? 'bg-gradient-to-br from-brand-500 to-brand-700 text-white border-transparent shadow-card'
					: 'bg-brand-600 text-white border-transparent shadow-soft'
				: highlight
				? 'bg-white text-brand-700 border-brand-200 hover:bg-brand-50 hover:border-brand-300'
				: 'bg-white text-ink-700 border-ink-200 hover:bg-ink-50 hover:border-ink-300'
		}`}
		title={label}
	>
		<Icon size={16} className='shrink-0' />
		<span className='truncate text-left'>{label}</span>
	</button>
);

export const CellPhonesPage = () => {
	const [page, setPage] = useState(1);
	const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
	const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
	const [selectedSubcategories, setSelectedSubcategories] = useState<string[]>([]);
	const [priceMin, setPriceMin] = useState<number | undefined>(undefined);
	const [priceMax, setPriceMax] = useState<number | undefined>(undefined);
	const [searchTerm, setSearchTerm] = useState('');
	const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | undefined>(undefined);
	const [newArrivalsOnly, setNewArrivalsOnly] = useState(false);

	const { categories, subcategories } = useTaxonomies();

	useEffect(() => {
		setPage(1);
	}, [selectedBrands, selectedCategories, selectedSubcategories, priceMin, priceMax, searchTerm, sortOrder, newArrivalsOnly]);

	const selectCategory = (id: string) => {
		// Selección exclusiva: una categoría a la vez en la barra de arriba.
		setNewArrivalsOnly(false);
		if (selectedCategories.includes(id) && selectedCategories.length === 1) {
			// Click sobre la misma categoría = volver a "Todas".
			setSelectedCategories([]);
		} else {
			setSelectedCategories([id]);
		}
		setSelectedSubcategories([]);
	};

	const selectAll = () => {
		setNewArrivalsOnly(false);
		setSelectedCategories([]);
		setSelectedSubcategories([]);
	};

	const selectNewArrivals = () => {
		setNewArrivalsOnly(true);
		setSelectedCategories([]);
		setSelectedSubcategories([]);
	};

	const toggleSubcategory = (id: string) => {
		setSelectedSubcategories(prev =>
			prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
		);
	};

	// Sólo mostramos subcategorías cuando hay una categoría seleccionada.
	const visibleSubcategories =
		selectedCategories.length === 1
			? subcategories.filter(s => s.category_id === selectedCategories[0])
			: [];

	const {
		data: products = [],
		isLoading,
		totalProducts,
	} = useFilteredProducts({
		page,
		brands: selectedBrands,
		categories: selectedCategories,
		subcategories: selectedSubcategories,
		priceMin,
		priceMax,
		searchTerm,
		sortOrder,
		newArrivalsOnly,
	});

	const preparedProducts = prepareProducts(products);

	return (
		<>
			<div className='text-center mb-10 space-y-3'>
				<p className='section-eyebrow'>Tienda</p>
				<h1 className='section-title'>Catálogo completo</h1>
				<p className='text-sm text-ink-500 max-w-xl mx-auto'>
					Explorá todos nuestros productos. Filtrá por marca, categoría o precio.
				</p>
			</div>

			{/* Barra de categorías con iconos, 2 filas en desktop */}
			{categories.length > 0 && (
				<div className='mb-6'>
					<div className='grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 gap-2'>
						{/* Todas */}
						<CategoryPill
							active={!newArrivalsOnly && selectedCategories.length === 0}
							label='Todas'
							Icon={ALL_ICON}
							onClick={selectAll}
						/>

						{/* Recién Llegados (categoría virtual) */}
						<CategoryPill
							active={newArrivalsOnly}
							label='Recién Llegados'
							Icon={NEW_ARRIVALS_ICON}
							onClick={selectNewArrivals}
							highlight
						/>

						{categories.map(cat => (
							<CategoryPill
								key={cat.id}
								active={selectedCategories.includes(cat.id)}
								label={cat.name}
								Icon={getCategoryIcon(cat.name)}
								onClick={() => selectCategory(cat.id)}
							/>
						))}
					</div>

					{/* Subcategorías (sólo cuando hay UNA categoría seleccionada) */}
					{visibleSubcategories.length > 0 && (
						<div className='mt-3 flex flex-wrap items-center justify-center gap-1.5 px-1'>
							{visibleSubcategories.map(sub => (
								<button
									key={sub.id}
									onClick={() => toggleSubcategory(sub.id)}
									className={`rounded-full px-3 py-1 text-xs font-semibold transition-all ${
										selectedSubcategories.includes(sub.id)
											? 'bg-ink-900 text-white'
											: 'bg-ink-50 text-ink-600 hover:bg-ink-100 ring-1 ring-ink-200'
									}`}
								>
									{sub.name}
								</button>
							))}
						</div>
					)}
				</div>
			)}

			<div className='flex justify-center mb-10'>
				<div className='relative w-full max-w-2xl'>
					<HiOutlineSearch className='absolute left-5 top-1/2 -translate-y-1/2 text-ink-400' size={20} />
					<input
						type='text'
						placeholder='Buscar productos por nombre, marca o categoría...'
						value={searchTerm}
						onChange={e => setSearchTerm(e.target.value)}
						className='w-full pl-12 pr-4 py-3.5 text-sm bg-white border border-ink-200 rounded-full shadow-soft placeholder:text-ink-400 focus:outline-none focus:ring-4 focus:ring-brand-600/15 focus:border-brand-600 transition-all'
					/>
				</div>
			</div>

			<div className='flex flex-col items-center gap-4 mb-6 sm:flex-row'>
				<div className='flex-1 text-center sm:text-left'>
					<p className='text-sm text-ink-500'>
						{searchTerm
							? `${totalProducts} resultado${totalProducts !== 1 ? 's' : ''} para "${searchTerm}"`
							: `${totalProducts} producto${totalProducts !== 1 ? 's' : ''} disponible${totalProducts !== 1 ? 's' : ''}`}
					</p>
				</div>

				<div className='inline-flex items-center gap-1 p-1 bg-ink-100 rounded-lg border border-ink-200/70'>
					<button
						onClick={() => setSortOrder('desc')}
						className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
							sortOrder === 'desc'
								? 'bg-white text-ink-900 shadow-soft'
								: 'text-ink-500 hover:text-ink-900'
						}`}
					>
						<HiOutlineArrowDown />
						Mayor precio
					</button>
					<button
						onClick={() => setSortOrder('asc')}
						className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
							sortOrder === 'asc'
								? 'bg-white text-ink-900 shadow-soft'
								: 'text-ink-500 hover:text-ink-900'
						}`}
					>
						<HiOutlineArrowUp />
						Menor precio
					</button>
				</div>
			</div>

			<div className='grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5'>
				<ContainerFilter
					setSelectedBrands={setSelectedBrands}
					selectedBrands={selectedBrands}
					selectedCategories={selectedCategories}
					setSelectedCategories={setSelectedCategories}
					selectedSubcategories={selectedSubcategories}
					setSelectedSubcategories={setSelectedSubcategories}
					priceMin={priceMin}
					priceMax={priceMax}
					setPriceMin={setPriceMin}
					setPriceMax={setPriceMax}
				/>

				{isLoading ? (
					<div className='col-span-2 lg:col-span-2 xl:col-span-4 flex items-center justify-center h-[500px]'>
						<div className='animate-pulse text-ink-500'>Cargando productos…</div>
					</div>
				) : preparedProducts.length === 0 ? (
					<div className='col-span-2 lg:col-span-2 xl:col-span-4 flex flex-col items-center justify-center h-[500px] gap-2'>
						<p className='text-lg font-semibold text-ink-700'>Sin resultados</p>
						<p className='text-sm text-ink-500'>Probá con otros filtros o términos de búsqueda.</p>
					</div>
				) : (
					<div className='flex flex-col col-span-2 gap-12 lg:col-span-2 xl:col-span-4'>
						<div className='grid grid-cols-1 sm:grid-cols-2 gap-5 xl:grid-cols-4'>
							{preparedProducts.map(product => (
								<CardProduct
									key={product.id}
									name={product.name}
									price={product.price}
									colors={product.colors}
									img={product.images[0]}
									slug={product.slug}
									variants={product.variants}
									brandName={product.brandName}
									categoryName={product.categoryName}
									source={product.source}
									externalCode={product.external_code}
								/>
							))}
						</div>

						<Pagination
							totalItems={totalProducts}
							page={page}
							setPage={setPage}
						/>
					</div>
				)}
			</div>

			<WhatsAppButton />
		</>
	);
};
