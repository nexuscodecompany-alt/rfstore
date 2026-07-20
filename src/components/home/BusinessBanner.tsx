import {
	HiOutlineChatBubbleLeftRight,
	HiOutlineDocumentText,
	HiOutlineCalculator,
	HiOutlineCube,
	HiOutlineWrenchScrewdriver,
} from 'react-icons/hi2';
import { HiOutlineArrowRight } from 'react-icons/hi2';

const perks = [
	{ icon: HiOutlineChatBubbleLeftRight, label: 'Atención personalizada' },
	{ icon: HiOutlineDocumentText, label: 'Factura con RUT' },
	{ icon: HiOutlineCalculator, label: 'Cotizaciones a medida' },
	{ icon: HiOutlineCube, label: 'Equipamiento por volumen' },
	{ icon: HiOutlineWrenchScrewdriver, label: 'Instalación y configuración' },
];

const WHATSAPP_URL = `https://wa.me/59894116299?text=${encodeURIComponent(
	'Hola, quería una cotización para mi empresa.'
)}`;

/** Banner "Soluciones tecnológicas para empresas". */
export const BusinessBanner = () => {
	return (
		<section className='relative my-16 overflow-hidden rounded-2xl section-dark bleed-full'>
			<div
				aria-hidden
				className='absolute inset-0 bg-grid-dark bg-grid-md [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]'
			/>
			<div
				aria-hidden
				className='absolute -top-24 left-1/2 h-[300px] w-[600px] -translate-x-1/2 rounded-full bg-brand-600/25 blur-3xl'
			/>

			<div className='relative z-10 container flex flex-col gap-8 py-12 lg:flex-row lg:items-center lg:justify-between'>
				<div className='max-w-xl'>
					<p className='section-eyebrow text-brand-400'>Empresas</p>
					<h2 className='mt-2 text-2xl font-bold text-white md:text-3xl'>
						Soluciones tecnológicas para empresas
					</h2>
					<p className='mt-3 text-sm text-white/70'>
						Equipamiento informático, redes, impresión y asesoramiento según las
						necesidades de tu negocio.
					</p>

					<div className='mt-6 flex flex-col gap-3 sm:flex-row'>
						<a
							href={WHATSAPP_URL}
							target='_blank'
							rel='noopener noreferrer'
							className='inline-flex items-center justify-center gap-2 rounded-lg bg-white px-6 py-3 text-sm font-semibold text-ink-900 transition-all hover:bg-brand-50'
						>
							Solicitar cotización
							<HiOutlineArrowRight />
						</a>
						<a
							href={WHATSAPP_URL}
							target='_blank'
							rel='noopener noreferrer'
							className='btn-ghost-dark px-6 py-3 text-center'
						>
							Hablar con un asesor
						</a>
					</div>
				</div>

				<ul className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:w-[380px]'>
					{perks.map(({ icon: Icon, label }) => (
						<li
							key={label}
							className='flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3'
						>
							<span className='grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/10 text-brand-300'>
								<Icon size={18} />
							</span>
							<span className='text-sm font-medium text-white/90'>{label}</span>
						</li>
					))}
				</ul>
			</div>
		</section>
	);
};
