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

// Alto del hero. MISMA proporción en el contenedor, en el placeholder de carga
// y en las imágenes: si cambia una, cambian todas (si no, vuelve el salto).
const ASPECT = 'aspect-[2/1] md:aspect-[1920/700]';

/**
 * Hero: carrusel fino de punta a punta. Todos los slides (incluida la imagen
 * principal) se administran desde el dashboard (Home → Carrusel).
 */
export const HeroCarousel = () => {
	const { config, isLoading } = useHomeConfig();
	// Slides configurados por el admin. Mientras la config viaja, esto viene vacío
	// (useHomeConfig devuelve DEFAULT_HOME_CONFIG como placeholder).
	const configured = config.hero_slides;
	const slides = configured.length > 0 ? configured : FALLBACK_SLIDES;

	const total = slides.length;
	const [index, setIndex] = useState(0);
	const safeIndex = index % total;

	useEffect(() => {
		if (total <= 1) return;
		const t = setInterval(() => setIndex(i => (i + 1) % total), 10000);
		return () => clearInterval(t);
	}, [total]);

	const go = (dir: number) => setIndex((safeIndex + dir + total) % total);

	// Mientras la config no llegó, NO mostramos el slide de respaldo: tiene otra
	// proporción que la caja y se veía deformado el primer segundo, hasta que
	// llegaban los slides reales. Reservamos el mismo espacio y listo (además
	// evita el salto de layout que penaliza Google).
	if (isLoading && configured.length === 0) {
		return (
			<div
				className={`bleed-full relative ${ASPECT} h-auto overflow-hidden bg-ink-950`}
				aria-hidden='true'
			/>
		);
	}

	return (
		<div className={`bleed-full group relative ${ASPECT} h-auto overflow-hidden bg-ink-950`}>
			{slides.map((slide, i) => {
				const active = safeIndex === i;
				const img = (
					<picture className='block h-full w-full'>
						{slide.image_mobile && (
							<source media='(max-width: 767px)' srcSet={slide.image_mobile} />
						)}
						{/* object-cover, NUNCA object-fill: fill estira la foto para llenar
						    la caja en vez de recortarla (era la imagen "estirada"). */}
						<img
							src={slide.image}
							alt={slide.alt || ''}
							className='h-full w-full object-cover'
							loading={i === 0 ? 'eager' : 'lazy'}
							decoding={i === 0 ? 'sync' : 'async'}
							// React 18 no tipa fetchPriority; en minúscula pasa igual al DOM.
							// Le dice al navegador que baje primero la imagen del hero (LCP).
							{...(i === 0 ? ({ fetchpriority: 'high' } as Record<string, string>) : {})}
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
