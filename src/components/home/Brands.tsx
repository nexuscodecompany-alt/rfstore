const brands = [
	{ image: '/img/brands/logitech.png', alt: 'Logitech' },
	{ image: '/img/brands/samsung.png', alt: 'Samsung' },
	{ image: '/img/brands/brother.png', alt: 'Brother' },
	{ image: '/img/brands/intel.png', alt: 'Intel' },
	{ image: '/img/brands/mikrotik.png', alt: 'MikroTik' },
	{ image: '/img/brands/hp.png', alt: 'HP' },
	{ image: '/img/brands/asus.svg', alt: 'ASUS' },
	{ image: '/img/brands/dell.svg', alt: 'Dell' },
	{ image: '/img/brands/hikvision.svg', alt: 'Hikvision' },
	{ image: '/img/brands/microsoft.svg', alt: 'Microsoft' },
	{ image: '/img/brands/lenovo.svg', alt: 'Lenovo' },
	{ image: '/img/brands/tp-link.svg', alt: 'TP-Link' },
	{ image: '/img/brands/ubiquiti-seeklogo.png', alt: 'Ubiquiti' },
];

export const Brands = () => {
	const loop = [...brands, ...brands];

	return (
		<section className='relative section-dark py-20 my-16 bleed-full'>
			<div
				aria-hidden
				className='absolute inset-0 bg-grid-dark bg-grid-md [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_70%)]'
			/>
			<div
				aria-hidden
				className='absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[300px] bg-brand-700/20 blur-3xl rounded-full'
			/>

			<div className='relative z-10 container'>
				<div className='text-center mb-12 space-y-3'>
					<p className='text-xs font-bold tracking-[0.18em] uppercase text-brand-400'>
						Partners tecnológicos
					</p>
					<h2 className='text-3xl font-bold tracking-tight text-white md:text-4xl'>
						Trabajamos con las{' '}
						<span className='bg-gradient-to-br from-brand-300 to-brand-500 bg-clip-text text-transparent'>
							mejores marcas
						</span>
					</h2>
					<p className='text-sm text-white/50 max-w-xl mx-auto'>
						Distribuidores y partners autorizados de líderes globales en hardware,
						redes y tecnología para hogar y oficina.
					</p>
				</div>

				<div className='relative overflow-hidden mask-fade-x'>
					<ul className='flex w-max items-center gap-6 animate-marquee'>
						{loop.map((b, idx) => (
							<li
								key={`${b.alt}-${idx}`}
								className='shrink-0 grid place-items-center w-[160px] h-20 bg-white rounded-xl px-5 py-4 shadow-soft ring-1 ring-white/10 hover:scale-105 transition-transform duration-300'
							>
								<img
									src={b.image}
									alt={b.alt}
									loading='lazy'
									className='max-h-10 w-auto object-contain'
								/>
							</li>
						))}
					</ul>
				</div>
			</div>
		</section>
	);
};
