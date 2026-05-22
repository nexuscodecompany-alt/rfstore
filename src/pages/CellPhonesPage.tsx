import { useState, useEffect } from 'react';
import { HiOutlineArrowDown, HiOutlineArrowUp, HiOutlineSearch } from 'react-icons/hi';
import { CardProduct } from '../components/products/CardProduct';
import { ContainerFilter } from '../components/products/ContainerFilter';
import { prepareProducts } from '../helpers';
import { useFilteredProducts } from '../hooks';
import { Pagination } from '../components/shared/Pagination';
import WhatsAppButton from '../components/shared/WhatsAppButton';

export const CellPhonesPage = () => {
	const [page, setPage] = useState(1);
	const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
	const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
	const [priceMin, setPriceMin] = useState<number | undefined>(undefined);
	const [priceMax, setPriceMax] = useState<number | undefined>(undefined);
	const [searchTerm, setSearchTerm] = useState('');
	const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | undefined>(undefined);

	useEffect(() => {
		setPage(1);
	}, [selectedBrands, selectedCategories, priceMin, priceMax, searchTerm, sortOrder]);

	const {
		data: products = [],
		isLoading,
		totalProducts,
	} = useFilteredProducts({
		page,
		brands: selectedBrands,
		categories: selectedCategories,
		priceMin,
		priceMax,
		searchTerm,
		sortOrder,
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
