import { HiArrowRight, HiOutlineEnvelope } from 'react-icons/hi2';

export const Newsletter = () => {
	return (
		<section className='relative section-dark py-20 mt-10'>
			<div
				aria-hidden
				className='absolute inset-0 bg-grid-dark bg-grid-md [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_70%)]'
			/>
			<div
				aria-hidden
				className='absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[300px] bg-brand-700/25 blur-3xl rounded-full'
			/>

			<div className='relative z-10 container'>
				<div className='max-w-2xl mx-auto text-center space-y-5'>
					<div className='inline-grid place-items-center w-12 h-12 mx-auto rounded-xl bg-white/5 border border-white/10 backdrop-blur'>
						<HiOutlineEnvelope className='text-brand-400' size={22} />
					</div>
					<h2 className='text-3xl md:text-4xl font-bold text-white tracking-tight'>
						Suscribite y enterate primero
					</h2>
					<p className='text-white/60'>
						Recibí promociones exclusivas, lanzamientos y stock fresco.
					</p>

					<form className='flex items-center gap-2 p-1.5 pl-5 bg-white/5 border border-white/10 rounded-full max-w-md mx-auto focus-within:border-brand-500/50 focus-within:bg-white/[0.07] transition-all'>
						<input
							type='email'
							placeholder='tu@correo.com'
							className='flex-1 bg-transparent text-sm text-white placeholder:text-white/40 focus:outline-none'
						/>
						<button
							type='submit'
							className='inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-gradient-to-br from-brand-600 to-brand-700 text-white text-sm font-semibold hover:shadow-glow-brand transition-all'
						>
							Suscribirme
							<HiArrowRight />
						</button>
					</form>

					<p className='text-xs text-white/40 pt-2'>
						No spam. Cancelá cuando quieras.
					</p>
				</div>
			</div>
		</section>
	);
};
