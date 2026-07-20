import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
	HiChevronLeft,
	HiChevronRight,
	HiArrowRight,
	HiOutlineSparkles,
} from 'react-icons/hi2';
import { useHomeConfig } from '../../hooks';

const WHATSAPP_ASESORAMIENTO = `https://wa.me/59894116299?text=${encodeURIComponent(
	'Hola, me gustaría solicitar asesoramiento.'
)}`;

/** Slide por defecto: mismo texto/estilo del hero anterior (marca RF Store). */
const BrandedSlide = () => (
	<div className='section-dark relative h-full w-full'>
		<div
			aria-hidden
			className='absolute inset-0 bg-grid-dark bg-grid-md [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_75%)]'
		/>
		<div
			aria-hidden
			className='absolute -top-24 -left-24 h-[380px] w-[380px] rounded-full bg-brand-600/30 blur-3xl'
		/>
		<div
			aria-hidden
			className='absolute -bottom-28 -right-24 h-[320px] w-[320px] rounded-full bg-brand-800/40 blur-3xl'
		/>

		<div className='relative z-10 mx-auto flex h-full max-w-4xl flex-col items-center justify-center px-6 text-center'>
			<span className='chip-dark mb-3'>
				<HiOutlineSparkles className='text-brand-400' />
				Soluciones tecnológicas en Uruguay
			</span>
			<h1 className='text-2xl font-bold leading-tight tracking-tight text-white md:text-4xl lg:text-5xl'>
				Tecnología para{' '}
				<span className='bg-gradient-to-br from-brand-300 via-brand-400 to-brand-600 bg-clip-text text-transparent'>
					empresas y hogares
				</span>
			</h1>
			<p className='mt-2 hidden max-w-2xl text-sm text-white/70 sm:block md:text-base'>
				Notebooks, impresoras, redes, periféricos y soluciones tecnológicas con
				stock real, garantía y respaldo.
			</p>
			<div className='mt-4 flex flex-col gap-3 sm:flex-row'>
				<Link
					to='/tienda'
					className='inline-flex items-center justify-center gap-2 rounded-lg bg-white px-6 py-2.5 text-sm font-semibold text-ink-900 transition-all hover:bg-brand-50'
				>
					Ver Catálogo
					<HiArrowRight />
				</Link>
				<a
					href={WHATSAPP_ASESORAMIENTO}
					target='_blank'
					rel='noopener noreferrer'
					className='btn-ghost-dark px-6 py-2.5'
				>
					Solicitar asesoramiento
				</a>
			</div>
		</div>
	</div>
);

/**
 * Hero: carrusel fino de punta a punta. El primer slide es el de la marca
 * (mismo texto/imagen de antes); los que agregue el admin se suman al carrusel.
 */
export const HeroCarousel = () => {
	const { config } = useHomeConfig();
	const adminSlides = config.hero_slides;

	// total = slide de marca + slides del admin
	const total = 1 + adminSlides.length;
	const [index, setIndex] = useState(0);

	useEffect(() => {
		if (total <= 1) return;
		const t = setInterval(() => setIndex(i => (i + 1) % total), 6000);
		return () => clearInterval(t);
	}, [total]);

	const go = (dir: number) => setIndex(i => (i + dir + total) % total);

	return (
		<div className='bleed-full group relative h-[300px] overflow-hidden bg-ink-950 md:h-[420px]'>
			{/* Slide 0: marca */}
			<div
				className={`absolute inset-0 transition-opacity duration-700 ${
					index === 0 ? 'opacity-100' : 'pointer-events-none opacity-0'
				}`}
			>
				<BrandedSlide />
			</div>

			{/* Slides del admin */}
			{adminSlides.map((slide, i) => {
				const active = index === i + 1;
				const img = (
					<img
						src={slide.image}
						alt={slide.alt || ''}
						className='h-full w-full object-cover'
						loading='lazy'
					/>
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
									i === index ? 'w-5 bg-white' : 'w-1.5 bg-white/50 hover:bg-white/80'
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
