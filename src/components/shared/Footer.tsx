import { BiChevronRight } from 'react-icons/bi';
import { Link } from 'react-router-dom';
import { socialLinks } from '../../constants/links';
import { useLegalPages } from '../../hooks/settings/useLegalPages';

export const Footer = () => {
	const { data: legalPages } = useLegalPages();
	const legalEntries = Object.entries(legalPages ?? {});

	return (
		<footer className='relative section-dark mt-20'>
			<div
				aria-hidden
				className='absolute inset-0 bg-grid-dark bg-grid-md [mask-image:radial-gradient(ellipse_at_top,black_20%,transparent_70%)]'
			/>
			<div
				aria-hidden
				className='absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-brand-500/40 to-transparent'
			/>

			<div className='relative z-10 container px-6 lg:px-12 py-16'>
				<div className='grid grid-cols-1 md:grid-cols-12 gap-10'>
					{/* LOGO + DESC */}
					<div className='md:col-span-4 space-y-4'>
						<Link to='/' className='inline-block'>
							<img
								src='/img/img-docs/logonegrorf.jpg'
								alt='RF Store'
								className='h-12 w-auto rounded'
							/>
						</Link>
						<p className='text-sm text-white/60 leading-relaxed max-w-xs'>
							Tecnología con stock real, garantía oficial y soporte
							especializado, en todo Uruguay.
						</p>
						<div className='flex gap-2 pt-2'>
							{socialLinks.map(link => (
								<a
									key={link.id}
									href={link.href}
									target='_blank'
									rel='noreferrer'
									className='grid place-items-center w-10 h-10 rounded-lg border border-white/10 bg-white/5 text-white/80 hover:bg-brand-600 hover:border-brand-600 hover:text-white transition-all duration-200'
								>
									{link.icon}
								</a>
							))}
						</div>
					</div>

					{/* NEWSLETTER */}
					<div className='md:col-span-4 space-y-4'>
						<p className='text-xs font-bold tracking-[0.18em] uppercase text-brand-400'>
							Newsletter
						</p>
						<p className='text-sm text-white/70'>
							Recibe ofertas exclusivas y novedades de stock.
						</p>
						<form className='flex items-center gap-2 p-1.5 pl-4 bg-white/5 border border-white/10 rounded-full focus-within:border-brand-500/60 focus-within:bg-white/[0.07] transition-all'>
							<input
								type='email'
								placeholder='tu@correo.com'
								className='flex-1 bg-transparent text-sm text-white placeholder:text-white/40 focus:outline-none'
							/>
							<button
								type='submit'
								className='shrink-0 grid place-items-center w-9 h-9 rounded-full bg-gradient-to-br from-brand-600 to-brand-700 text-white hover:shadow-glow-brand transition-all'
								aria-label='Suscribirme'
							>
								<BiChevronRight size={20} />
							</button>
						</form>
					</div>

					{/* LINKS */}
					<div className='md:col-span-2 space-y-4'>
						<p className='text-xs font-bold tracking-[0.18em] uppercase text-white/80'>
							Tienda
						</p>
						<nav className='flex flex-col gap-2.5 text-sm text-white/60'>
							<Link to='/tienda' className='hover:text-white transition-colors'>Productos</Link>
							<Link to='/contacto' className='hover:text-white transition-colors'>Contacto</Link>
							<Link to='/blog' className='hover:text-white transition-colors'>Blog</Link>
						</nav>
					</div>

					<div className='md:col-span-2 space-y-4'>
						<p className='text-xs font-bold tracking-[0.18em] uppercase text-white/80'>
							Legal
						</p>
						<nav className='flex flex-col gap-2.5 text-sm text-white/60'>
							{legalEntries.length > 0 ? (
								legalEntries.map(([slug, page]) => (
									<Link
										key={slug}
										to={`/legal/${slug}`}
										className='hover:text-white transition-colors'
									>
										{page.title}
									</Link>
								))
							) : (
								<span className='text-white/40'>Próximamente</span>
							)}
						</nav>
					</div>
				</div>

				<div className='mt-12 pt-6 border-t border-white/10 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-white/40'>
					<p>© 2025 RF STORE. Todos los derechos reservados.</p>
					<p>
						Created by{' '}
						<a
							href='https://www.linkedin.com/company/hglabs-uy'
							target='_blank'
							rel='noopener noreferrer'
							className='font-semibold text-white/70 hover:text-brand-400 transition-colors'
						>
							hgLabs
						</a>
					</p>
				</div>
			</div>
		</footer>
	);
};
