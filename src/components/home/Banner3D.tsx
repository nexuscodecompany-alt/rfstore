import { Link } from 'react-router-dom';
import { HiArrowRight } from 'react-icons/hi2';
import { useHomeConfig } from '../../hooks';

/**
 * Banner de Impresión 3D (Bambu Lab). Configurable desde admin (Home → Banner 3D).
 * Si está deshabilitado o sin imagen, no se muestra.
 */
export const Banner3D = () => {
	const { config } = useHomeConfig();
	const b = config.banner_3d;

	if (!b.enabled) return null;

	return (
		<section className='my-16'>
			<Link
				to={b.link || '/tienda'}
				className='group relative block overflow-hidden rounded-2xl bg-ink-900'
			>
				{b.image ? (
					<img
						src={b.image}
						alt={b.title || 'Impresión 3D'}
						loading='lazy'
						className='h-[220px] w-full object-contain object-right md:h-[300px]'
					/>
				) : (
					<div className='relative h-[220px] w-full bg-gradient-to-br from-brand-600 via-brand-800 to-ink-900 md:h-[300px]'>
						<div
							aria-hidden
							className='absolute inset-0 bg-grid-dark bg-grid-md [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]'
						/>
					</div>
				)}
				<div className='absolute inset-0 bg-gradient-to-r from-ink-900/80 via-ink-900/40 to-transparent' />
				<div className='absolute inset-0 flex flex-col justify-center gap-3 p-8 md:p-12'>
					<h2 className='max-w-md text-2xl font-bold text-white md:text-4xl'>
						{b.title || 'Impresión 3D'}
					</h2>
					{b.subtitle && (
						<p className='max-w-md text-sm text-white/80 md:text-base'>{b.subtitle}</p>
					)}
					<span className='inline-flex w-fit items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-ink-900 transition-all group-hover:gap-3'>
						Ver productos
						<HiArrowRight />
					</span>
				</div>
			</Link>
		</section>
	);
};
