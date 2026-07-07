import { Link } from 'react-router-dom';
import { HiArrowRight, HiOutlineShieldCheck, HiOutlineSparkles } from 'react-icons/hi2';

export const Banner = () => {
	return (
		<section className='section-dark'>
			{/* GRID PATTERN */}
			<div
				aria-hidden
				className='absolute inset-0 bg-grid-dark bg-grid-md [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_75%)]'
			/>

			{/* GLOWS */}
			<div
				aria-hidden
				className='absolute -top-32 -left-32 w-[600px] h-[600px] bg-brand-600/30 rounded-full blur-3xl'
			/>
			<div
				aria-hidden
				className='absolute -bottom-40 -right-32 w-[500px] h-[500px] bg-brand-800/40 rounded-full blur-3xl'
			/>

			{/* CONTENIDO */}
			<div className='relative z-10 container py-24 lg:py-32 flex flex-col items-center text-center'>
				<span className='chip-dark mb-6 animate-fade-in-up'>
					<HiOutlineSparkles className='text-brand-400' />
					Soluciones tecnológicas en Uruguay
				</span>

				<h1 className='text-4xl font-bold tracking-tight leading-[1.05] mb-5 lg:text-6xl xl:text-7xl max-w-4xl animate-fade-in-up [animation-delay:80ms]'>
					Tecnología para{' '}
					<span className='bg-gradient-to-br from-brand-300 via-brand-400 to-brand-600 bg-clip-text text-transparent'>
						empresas y hogares
					</span>
				</h1>

				<p className='text-base md:text-lg text-white/70 max-w-2xl mb-9 animate-fade-in-up [animation-delay:160ms]'>
					Notebooks, impresoras, redes, periféricos y soluciones tecnológicas
					con stock real, garantía y respaldo.
				</p>

				<div className='flex flex-col sm:flex-row gap-3 animate-fade-in-up [animation-delay:240ms]'>
					<Link
						to='/tienda'
						className='inline-flex items-center justify-center gap-2 bg-white text-ink-900 py-3 px-6 rounded-lg font-semibold text-sm hover:bg-brand-50 hover:-translate-y-0.5 hover:shadow-glow-brand transition-all duration-200'
					>
						Ver Catálogo
						<HiArrowRight />
					</Link>
					<a
						href={`https://wa.me/59894116299?text=${encodeURIComponent('Hola, me gustaría solicitar asesoramiento.')}`}
						target='_blank'
						rel='noopener noreferrer'
						className='btn-ghost-dark px-6 py-3'
					>
						Solicitar asesoramiento
					</a>
				</div>

				{/* TRUST STRIP */}
				<div className='mt-14 grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-6 max-w-3xl w-full animate-fade-in-up [animation-delay:320ms]'>
					{[
						{ k: '+10', l: 'Años en el rubro' },
						{ k: '+500', l: 'Clientes felices' },
						{ k: '100%', l: 'Productos garantidos' },
					].map(item => (
						<div key={item.l} className='text-center'>
							<p className='text-2xl md:text-3xl font-bold text-white'>{item.k}</p>
							<p className='text-xs text-white/50 mt-1'>{item.l}</p>
						</div>
					))}
				</div>

				<div className='mt-10 flex items-center gap-2 text-xs text-white/40'>
					<HiOutlineShieldCheck className='text-brand-400' />
					Pago seguro · Facturación con IVA · Envíos a todo Uruguay
				</div>
			</div>
		</section>
	);
};
