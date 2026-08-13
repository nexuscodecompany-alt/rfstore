import { useState, useEffect } from 'react';
import { HiOutlineArrowDown, HiOutlineArrowUp, HiOutlineSearch, HiOutlineSparkles } from 'react-icons/hi';
import { CardProduct } from '../components/products/CardProduct';
import { ContainerFilter } from '../components/products/ContainerFilter';
import { prepareProducts } from '../helpers';
import {
	ALL_ICON,
	NEW_ARRIVALS_ICON,
	SPECIAL_ICON,
	getCategoryIcon,
} from '../helpers/categoryIcons';
import {
	useActiveSpecialCategories,
	useFilteredProducts,
	useSpecialCategoryBySlug,
	useTaxonomies,
} from '../hooks';
import { useFilterParams, type ParamValue } from '../hooks/useFilterParams';
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
	// Parámetros iniciales desde la URL: ?q= (búsqueda), ?category=, ?subcategory=
	// y ?brand= (llegadas desde el buscador / mega-menú / tiles del header o links
	// de publicidad). category/subcategory/brand aceptan id O nombre (ej.
	// /tienda?category=notebooks&brand=asus) para que los links de ads sean legibles.
	// ?special=<slug> = categoría ESPECIAL / campaña (Día del Niño, Black Friday…):
	// va por encima de la taxonomía real, los productos los elige el admin a mano.
	// TODO el estado de filtrado vive en la URL (ver useFilterParams): así el
	// botón "atrás" del navegador lo restaura tal cual al volver de un producto,
	// y el link con los filtros puestos se puede compartir o recargar.
	const { get, getList, getNumber, getBool, patch, toggleInList } =
		useFilterParams();
	const qParam = get('q');
	const catParam = get('category');
	const specialParam = get('special');

	const page = getNumber('page') ?? 1;
	const priceMin = getNumber('min');
	const priceMax = getNumber('max');
	const newArrivalsOnly = getBool('nuevos');
	// Orden: sin parámetro = automático (ver effectiveSort). Con parámetro, mandó
	// el usuario: 'destacados' | 'asc' | 'desc'.
	const sortParam = get('sort');
	const manualSort = sortParam !== '';
	const sortOrder: 'asc' | 'desc' | undefined =
		sortParam === 'asc' ? 'asc' : sortParam === 'desc' ? 'desc' : undefined;

	// El input de búsqueda se escribe letra por letra: lo mantenemos local y lo
	// volcamos a la URL con un respiro, para no disparar una consulta por tecla.
	const [searchInput, setSearchInput] = useState(qParam);
	const searchTerm = qParam;

	// Si cambia el ?q= desde afuera (buscador del header estando ya en la tienda,
	// o "atrás" del navegador), sincronizamos el input.
	useEffect(() => {
		setSearchInput(qParam);
	}, [qParam]);

	useEffect(() => {
		if (searchInput === qParam) return;
		const t = setTimeout(
			() => patch({ q: searchInput.trim() || undefined, page: undefined }),
			350
		);
		return () => clearTimeout(t);
	}, [searchInput, qParam, patch]);

	const { categories, subcategories, brands } = useTaxonomies();
	// Campañas activas (pills destacadas) y la campaña abierta por ?special=.
	const { specialCategories } = useActiveSpecialCategories();
	const {
		specialCategory,
		productIds: specialProductIds,
		isLoading: isLoadingSpecial,
	} = useSpecialCategoryBySlug(specialParam);

	// Normaliza para comparar nombres llegados por URL: minúsculas y sin acentos.
	const norm = (s: string) =>
		s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

	// Acepta id o nombre exacto (case/acentos-insensitive). Si la lista todavía no
	// cargó o no hay match, devuelve el valor tal cual (compat con los links por id).
	// Los links de publicidad usan nombres (/tienda?category=notebooks&brand=asus);
	// los filtros de la tienda escriben ids.
	const resolveId = (param: string, list: { id: string; name: string }[]) => {
		if (!param) return '';
		if (list.some(x => x.id === param)) return param;
		return list.find(x => norm(x.name) === norm(param))?.id ?? param;
	};
	const resolveIds = (params: string[], list: { id: string; name: string }[]) =>
		params.map(p => resolveId(p, list)).filter(Boolean);

	// Derivado de la URL en cada render: cuando llegan las taxonomías, los links
	// por nombre se re-resuelven solos (antes hacía falta un efecto para eso).
	const selectedCategories = catParam ? [resolveId(catParam, categories)] : [];
	const selectedSubcategories = resolveIds(getList('subcategory'), subcategories);
	const selectedBrands = resolveIds(getList('brand'), brands);

	// ¿Hay algún filtro activo? Da igual el origen: pills/checkboxes de la tienda,
	// precio, búsqueda, campaña, o landing por link (?category=/?subcategory=/?brand=/?q=).
	const hasAnyFilter =
		selectedBrands.length > 0 ||
		selectedCategories.length > 0 ||
		selectedSubcategories.length > 0 ||
		priceMin !== undefined ||
		priceMax !== undefined ||
		!!searchTerm.trim() ||
		specialProductIds !== null;

	// Orden efectivo que va a la consulta:
	//  - Si el usuario eligió un orden con los botones, se respeta ese.
	//  - Si NO eligió y hay CUALQUIER filtro/búsqueda -> menor precio arriba ('asc').
	//  - Sólo la tienda sin filtros ("Todas") -> Destacados (undefined).
	const effectiveSort: 'asc' | 'desc' | undefined = manualSort
		? sortOrder
		: hasAnyFilter
		? 'asc'
		: undefined;

	// Cambiar cualquier filtro vuelve a la página 1 y suelta el orden manual (para
	// que rija de nuevo la regla automática). Todo en una sola escritura de URL.
	const setFilters = (values: Record<string, ParamValue>) =>
		patch({ page: undefined, sort: undefined, ...values });

	// Firma compatible con el componente de paginado (acepta valor o función).
	const setPage: React.Dispatch<React.SetStateAction<number>> = value => {
		const next = typeof value === 'function' ? value(page) : value;
		patch({ page: next > 1 ? next : undefined });
	};

	// Entrar/salir de una campaña. Va por la URL para que el link sea compartible
	// (ads, WhatsApp) y el botón "atrás" del navegador funcione.
	// Abrir una campaña arranca de cero: sin categoría/marca/precio previos, para
	// que se vea la selección completa que armó el admin.
	const setSpecial = (slug: string | null) =>
		setFilters({
			special: slug ?? undefined,
			category: undefined,
			subcategory: undefined,
			brand: undefined,
			min: undefined,
			max: undefined,
			nuevos: undefined,
		});

	const selectCategory = (id: string) => {
		// Selección exclusiva: una categoría a la vez en la barra de arriba.
		// Click sobre la misma categoría = volver a "Todas".
		const same = selectedCategories.includes(id) && selectedCategories.length === 1;
		setFilters({
			category: same ? undefined : id,
			subcategory: undefined,
			special: undefined,
			nuevos: undefined,
		});
	};

	const selectAll = () =>
		setFilters({
			category: undefined,
			subcategory: undefined,
			special: undefined,
			nuevos: undefined,
		});

	const selectNewArrivals = () =>
		setFilters({
			nuevos: '1',
			category: undefined,
			subcategory: undefined,
			special: undefined,
		});

	// Pill de campaña: si ya está abierta, volver a "Todas".
	const selectSpecial = (slug: string) =>
		setSpecial(specialParam === slug ? null : slug);

	const toggleSubcategory = (id: string) =>
		toggleInList('subcategory', id, { page: undefined, sort: undefined });

	// Setters que usa el panel de filtros lateral (ContainerFilter).
	const setSelectedBrands = (ids: string[]) => setFilters({ brand: ids });
	const setSelectedCategories = (ids: string[]) =>
		setFilters({ category: ids[0], subcategory: undefined });
	const setSelectedSubcategories = (ids: string[]) => setFilters({ subcategory: ids });
	const setPriceMin = (v?: number) => setFilters({ min: v });
	const setPriceMax = (v?: number) => setFilters({ max: v });

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
		sortOrder: effectiveSort,
		newArrivalsOnly,
		specialProductIds,
		// Esperamos a resolver ?special= antes de consultar: si no, se vería un
		// flash con todo el catálogo antes de aplicar el filtro de la campaña.
		enabled: !isLoadingSpecial,
	});

	const preparedProducts = prepareProducts(products);

	return (
		<>
			{/* Con una campaña abierta, el encabezado toma su nombre. */}
			<div className='text-center mb-10 space-y-3'>
				<p className='section-eyebrow'>
					{specialCategory ? 'Selección especial' : 'Tienda'}
				</p>
				<h1 className='section-title'>
					{specialCategory ? specialCategory.name : 'Catálogo completo'}
				</h1>
				<p className='text-sm text-ink-500 max-w-xl mx-auto'>
					{specialCategory
						? 'Una selección elegida para la ocasión. Tocá "Todas" para volver al catálogo completo.'
						: 'Explorá todos nuestros productos. Filtrá por marca, categoría o precio.'}
				</p>
			</div>

			{/* Barra de categorías con iconos, 2 filas en desktop */}
			{categories.length > 0 && (
				<div className='mb-6'>
					<div className='grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 gap-2'>
						{/* Todas */}
						<CategoryPill
							active={
								!newArrivalsOnly &&
								!specialParam &&
								selectedCategories.length === 0
							}
							label='Todas'
							Icon={ALL_ICON}
							onClick={selectAll}
						/>

						{/* Campañas activas (categorías especiales): van primero y destacadas. */}
						{specialCategories.map(sc => (
							<CategoryPill
								key={sc.id}
								active={specialParam === sc.slug}
								label={sc.name}
								Icon={SPECIAL_ICON}
								onClick={() => selectSpecial(sc.slug)}
								highlight
							/>
						))}

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
								active={!specialParam && selectedCategories.includes(cat.id)}
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
						value={searchInput}
						onChange={e => setSearchInput(e.target.value)}
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
						onClick={() => patch({ sort: 'destacados', page: undefined })}
						className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
							effectiveSort === undefined
								? 'bg-white text-ink-900 shadow-soft'
								: 'text-ink-500 hover:text-ink-900'
						}`}
					>
						<HiOutlineSparkles />
						Destacados
					</button>
					<button
						onClick={() => patch({ sort: 'desc', page: undefined })}
						className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
							effectiveSort === 'desc'
								? 'bg-white text-ink-900 shadow-soft'
								: 'text-ink-500 hover:text-ink-900'
						}`}
					>
						<HiOutlineArrowDown />
						Mayor precio
					</button>
					<button
						onClick={() => patch({ sort: 'asc', page: undefined })}
						className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
							effectiveSort === 'asc'
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
					onClearAll={() =>
						setFilters({
							brand: undefined,
							category: undefined,
							subcategory: undefined,
							min: undefined,
							max: undefined,
						})
					}
				/>

				{isLoading || isLoadingSpecial ? (
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
									id={product.id}
									name={product.name}
									price={product.price}
									img={product.images[0]}
									slug={product.slug}
									variants={product.variants}
									brandName={product.brandName}
									categoryName={product.categoryName}
									source={product.source}
									externalCode={product.external_code}
									onlinePayment={product.online_payment}
									marginOverride={product.margin_override_percent}
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
