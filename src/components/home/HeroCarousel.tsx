import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HiChevronLeft, HiChevronRight } from 'react-icons/hi2';
import { useHomeConfig } from '../../hooks';
import type { HomeSlide } from '../../actions/homeConfig';

/**
 * Fallback si el admin todavía no cargó ningún slide: la imagen de marca
 * que vive en /public. Apenas haya slides configurados, se usan solo esos.
 */
const FALLBACK_SLIDES: HomeSlide[] = [
	{
		id: 'fallback-brand',
		image: '/hero-principal.jpg',
		link: '/tienda',
		alt: 'RF Store — Tecnología para empresas y hogares',
	},
];

/**
 * Hero: carrusel fino de punta a punta. Todos los slides (incluida la imagen
 * principal) se administran desde el dashboard (Home → Carrusel).
 */
export const HeroCarousel = () => {
	const { config } = useHomeConfig();
	const slides = config.hero_slides.length > 0 ? config.hero_slides : FALLBACK_SLIDES;

	const total = slides.length;
	const [index, setIndex] = useState(0);
	const safeIndex = index % total;

	useEffect(() => {
		if (total <= 1) return;
		const t = setInterval(() => setIndex(i => (i + 1) % total), 10000);
		return () => clearInterval(t);
	}, [total]);

	const go = (dir: number) => setIndex((safeIndex + dir + total) % total);

	return (
		<div className='bleed-full group relative aspect-[2/1] h-auto overflow-hidden bg-ink-950 md:aspect-[1920/700]'>
			{slides.map((slide, i) => {
				const active = safeIndex === i;
				const img = (
					<picture className='block h-full w-full'>
						{slide.image_mobile && (
							<source media='(max-width: 767px)' srcSet={slide.image_mobile} />
						)}
						<img
							src={slide.image}
							alt={slide.alt || ''}
							className='h-full w-full object-fill'
							loading={i === 0 ? 'eager' : 'lazy'}
						/>
					</picture>
				);
				return (
					<div
						key={slide.id}
						className={`absolute inset-0 transition-opacity duration-700 ${
							active ? 'opacity-100' : 'pointer-events-none opacity-0'
						}`}
					>
						{slide.link ? (
							<Link to={slide.link} className='block h-full w-full'>
								{img}
							</Link>
						) : (
							img
						)}
					</div>
				);
			})}

			{total > 1 && (
				<>
					<button
						onClick={() => go(-1)}
						className='absolute left-3 top-1/2 hidden -translate-y-1/2 place-items-center rounded-full bg-white/80 p-2 text-ink-800 opacity-0 shadow-soft transition-opacity hover:bg-white group-hover:opacity-100 md:grid'
						aria-label='Anterior'
					>
						<HiChevronLeft size={20} />
					</button>
					<button
						onClick={() => go(1)}
						className='absolute right-3 top-1/2 hidden -translate-y-1/2 place-items-center rounded-full bg-white/80 p-2 text-ink-800 opacity-0 shadow-soft transition-opacity hover:bg-white group-hover:opacity-100 md:grid'
						aria-label='Siguiente'
					>
						<HiChevronRight size={20} />
					</button>

					<div className='absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5'>
						{Array.from({ length: total }).map((_, i) => (
							<button
								key={i}
								onClick={() => setIndex(i)}
								className={`h-1.5 rounded-full transition-all ${
									i === safeIndex ? 'w-5 bg-white' : 'w-1.5 bg-white/50 hover:bg-white/80'
								}`}
								aria-label={`Ir al slide ${i + 1}`}
							/>
						))}
					</div>
				</>
			)}
		</div>
	);
};
