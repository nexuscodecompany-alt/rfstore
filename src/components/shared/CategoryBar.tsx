import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
	HiOutlineSquares2X2,
	HiOutlineChevronDown,
	HiOutlineChevronRight,
} from 'react-icons/hi2';
import { useTaxonomies, useHomeConfig } from '../../hooks';
import { getCategoryIcon } from '../../helpers/categoryIcons';
import type { Category, Subcategory } from '../../actions/taxonomy';

const catLink = (id: string) => `/tienda?category=${id}`;
const subLink = (catId: string, subId: string) =>
	`/tienda?category=${catId}&subcategory=${subId}`;

/**
 * Barra de categorías estilo marketplace, siempre visible:
 *  - "Todas las categorías": mega-menú de 2 columnas (categorías + subcategorías al hover).
 *  - Categorías destacadas (configurables desde admin): cada una abre sus subcategorías.
 */
export const CategoryBar = () => {
	const { categories, subcategories } = useTaxonomies();
	const { config } = useHomeConfig();

	const [openKey, setOpenKey] = useState<string | null>(null); // 'all' | categoryId | null
	const [hoveredCat, setHoveredCat] = useState<string | null>(null);
	const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const subsOf = (catId: string): Subcategory[] =>
		subcategories.filter(s => s.category_id === catId);

	// Categorías destacadas resueltas (respeta el orden configurado; ignora ids inválidos).
	const featured: Category[] = config.nav_featured
		.map(id => categories.find(c => c.id === id))
		.filter(Boolean) as Category[];

	const open = (key: string) => {
		if (closeTimer.current) clearTimeout(closeTimer.current);
		setOpenKey(key);
	};
	const scheduleClose = () => {
		if (closeTimer.current) clearTimeout(closeTimer.current);
		closeTimer.current = setTimeout(() => {
			setOpenKey(null);
			setHoveredCat(null);
		}, 120);
	};

	return (
		<div className='border-t border-white/10 bg-ink-950'>
			<nav className='relative flex items-center gap-1 px-3 lg:px-10'>
				{/* Todas las categorías */}
				<div
					className='relative'
					onMouseEnter={() => {
						open('all');
						setHoveredCat(categories[0]?.id ?? null);
					}}
					onMouseLeave={scheduleClose}
				>
					<button
						className={`flex items-center gap-2 rounded-t-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
							openKey === 'all'
								? 'bg-brand-900 text-white'
								: 'bg-brand-900 text-white hover:bg-brand-800'
						}`}
					>
						<HiOutlineSquares2X2 size={18} />
						Todas las categorías
						<HiOutlineChevronDown size={14} />
					</button>

					{openKey === 'all' && categories.length > 0 && (
						<div className='absolute left-0 top-full z-50 flex min-h-[280px] w-[640px] max-w-[92vw] overflow-hidden rounded-b-xl rounded-tr-xl border border-ink-200 bg-white shadow-2xl animate-fade-in'>
							{/* Columna izquierda: categorías */}
							<ul className='w-1/2 shrink-0 overflow-auto border-r border-ink-100 py-2'>
								{categories.map(cat => {
									const Icon = getCategoryIcon(cat.name);
									const active = hoveredCat === cat.id;
									return (
										<li key={cat.id}>
											<Link
												to={catLink(cat.id)}
												onMouseEnter={() => setHoveredCat(cat.id)}
												onClick={() => setOpenKey(null)}
												className={`flex items-center gap-2.5 px-4 py-2 text-sm transition-colors ${
													active
														? 'bg-brand-50 text-brand-800'
														: 'text-ink-700 hover:bg-ink-50'
												}`}
											>
												<Icon
													size={17}
													className={active ? 'text-brand-600' : 'text-ink-400'}
												/>
												<span className='flex-1'>{cat.name}</span>
												<HiOutlineChevronRight size={14} className='text-ink-300' />
											</Link>
										</li>
									);
								})}
							</ul>
							{/* Columna derecha: subcategorías de la categoría con hover */}
							<div className='flex-1 overflow-auto p-4'>
								{hoveredCat && (
									<>
										<Link
											to={catLink(hoveredCat)}
											onClick={() => setOpenKey(null)}
											className='mb-2 inline-block text-xs font-bold uppercase tracking-wider text-brand-700 hover:underline'
										>
											Ver toda la categoría
										</Link>
										<ul className='grid grid-cols-2 gap-x-4 gap-y-1'>
											{subsOf(hoveredCat).map(sub => (
												<li key={sub.id}>
													<Link
														to={subLink(hoveredCat, sub.id)}
														onClick={() => setOpenKey(null)}
														className='block truncate rounded px-2 py-1.5 text-sm text-ink-600 hover:bg-brand-50 hover:text-brand-800 transition-colors'
													>
														{sub.name}
													</Link>
												</li>
											))}
											{subsOf(hoveredCat).length === 0 && (
												<li className='text-sm text-ink-400'>Sin subcategorías.</li>
											)}
										</ul>
									</>
								)}
							</div>
						</div>
					)}
				</div>

				{/* Categorías destacadas */}
				<div className='hidden items-center gap-0.5 md:flex'>
					{featured.map(cat => {
						const subs = subsOf(cat.id);
						return (
							<div
								key={cat.id}
								className='relative'
								onMouseEnter={() => open(cat.id)}
								onMouseLeave={scheduleClose}
							>
								<Link
									to={catLink(cat.id)}
									className={`flex items-center gap-1 rounded-md px-3 py-2.5 text-sm font-medium uppercase tracking-wide transition-colors ${
										openKey === cat.id
											? 'text-white'
											: 'text-white/80 hover:text-white'
									}`}
								>
									{cat.name}
									{subs.length > 0 && <HiOutlineChevronDown size={13} />}
								</Link>

								{openKey === cat.id && subs.length > 0 && (
									<div className='absolute left-0 top-full z-50 min-w-[220px] overflow-hidden rounded-xl border border-ink-200 bg-white py-2 shadow-2xl animate-fade-in'>
										{subs.map(sub => (
											<Link
												key={sub.id}
												to={subLink(cat.id, sub.id)}
												onClick={() => setOpenKey(null)}
												className='block px-4 py-2 text-sm text-ink-600 hover:bg-brand-50 hover:text-brand-800 transition-colors'
											>
												{sub.name}
											</Link>
										))}
									</div>
								)}
							</div>
						);
					})}
				</div>

				{/* Links secundarios a la derecha */}
				<div className='ml-auto hidden items-center gap-1 lg:flex'>
					<Link
						to='/tienda'
						className='rounded-md px-3 py-2.5 text-sm font-medium text-white/80 transition-colors hover:text-white'
					>
						Tienda
					</Link>
					<Link
						to='/blog'
						className='rounded-md px-3 py-2.5 text-sm font-medium text-white/80 transition-colors hover:text-white'
					>
						Blog
					</Link>
					<Link
						to='/nosotros'
						className='rounded-md px-3 py-2.5 text-sm font-medium text-white/80 transition-colors hover:text-white'
					>
						Contacto
					</Link>
				</div>
			</nav>
		</div>
	);
};
