import { Link } from 'react-router-dom';
import { HiArrowRight } from 'react-icons/hi2';
import { useHomeConfig, useTaxonomies, useCategoryThumbnails } from '../../hooks';
import { getCategoryIcon } from '../../helpers/categoryIcons';
import type { Category } from '../../actions/taxonomy';

/**
 * "Explorá nuestras categorías" — tarjetas con la imagen de un producto real
 * de cada categoría (o una imagen propia si el admin la cargó).
 * Si no hay tiles configurados, muestra todas las categorías.
 */
export const CategoryTiles = () => {
	const { config } = useHomeConfig();
	const { categories } = useTaxonomies();

	const catById = new Map(categories.map(c => [c.id, c]));

	// Lista de tiles: los configurados (en orden) o, si no hay, todas las categorías.
	type Tile = { category: Category; image?: string; label?: string; link?: string };
	const tiles: Tile[] =
		config.category_tiles.length > 0
			? config.category_tiles.reduce<Tile[]>((acc, t) => {
					const category = catById.get(t.category_id);
					if (category)
						acc.push({ category, image: t.image, label: t.label, link: t.link });
					return acc;
			  }, [])
			: categories.map(category => ({ category }));

	const ids = tiles.map(t => t.category.id);
	const { data: thumbs = {} } = useCategoryThumbnails(ids);

	if (tiles.length === 0) return null;

	return (
		<section className='my-16'>
			<div className='mb-8 flex items-end justify-between gap-4'>
				<div>
					<p className='section-eyebrow'>Catálogo</p>
					<h2 className='text-2xl font-bold tracking-tight text-ink-900 md:text-3xl'>
						Explorá nuestras categorías
					</h2>
				</div>
				<Link
					to='/tienda'
					className='hidden shrink-0 items-center gap-1.5 text-sm font-semibold text-brand-700 hover:text-brand-900 sm:inline-flex'
				>
					Ver todas
					<HiArrowRight />
				</Link>
			</div>

			<div className='grid grid-cols-4 gap-2.5 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9 xl:grid-cols-10'>
				{tiles.map(({ category, image, label, link }) => {
					const src = image || thumbs[category.id];
					const Icon = getCategoryIcon(category.name);
					const to =
						link && link.trim() ? link.trim() : `/tienda?category=${category.id}`;
					const external = /^https?:\/\//.test(to);
					const cls =
						'group flex flex-col items-center overflow-hidden rounded-xl border border-ink-200/70 bg-white p-2 shadow-soft transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-card-hover';
					const inner = (
						<>
							<div className='flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-white'>
								{src ? (
									<img
										src={src}
										alt={label || category.name}
										loading='lazy'
										className='h-full w-full object-contain p-1.5 transition-transform duration-500 group-hover:scale-105'
									/>
								) : (
									<Icon size={26} className='text-ink-300' />
								)}
							</div>
							<span className='mt-1.5 line-clamp-2 text-center text-xs font-bold leading-tight text-brand-800'>
								{label || category.name}
							</span>
						</>
					);
					return external ? (
						<a
							key={category.id}
							href={to}
							target='_blank'
							rel='noopener noreferrer'
							className={cls}
						>
							{inner}
						</a>
					) : (
						<Link key={category.id} to={to} className={cls}>
							{inner}
						</Link>
					);
				})}
			</div>
		</section>
	);
};
