import { BiWorld } from 'react-icons/bi';
import { MdLocalShipping } from 'react-icons/md';

const features = [
	{
		icon: MdLocalShipping,
		title: 'Envío gratis en Montevideo',
		desc: 'En todos nuestros productos sin costo adicional',
	},
	{
		icon: BiWorld,
		title: 'Garantía oficial',
		desc: 'Garantía en todos los equipos',
	},
];

export const FeatureGrid = () => {
	return (
		<div className='grid grid-cols-1 sm:grid-cols-2 gap-4 my-16 max-w-2xl mx-auto'>
			{features.map(({ icon: Icon, title, desc }) => (
				<div
					key={title}
					className='group relative p-6 bg-white border border-ink-200/70 rounded-xl shadow-card hover:shadow-card-hover hover:border-brand-200 hover:-translate-y-0.5 transition-all duration-300 overflow-hidden'
				>
					{/* DETALLE GRADIENT TOP */}
					<div className='absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-brand-500 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500' />

					<div className='flex items-start gap-4'>
						<div className='shrink-0 grid place-items-center w-12 h-12 rounded-lg bg-gradient-to-br from-brand-50 to-brand-100 text-brand-700 ring-1 ring-brand-200/60 group-hover:scale-105 group-hover:from-brand-600 group-hover:to-brand-700 group-hover:text-white group-hover:ring-brand-600 transition-all duration-300'>
							<Icon size={22} />
						</div>
						<div className='space-y-1'>
							<p className='font-semibold text-ink-900 text-sm'>{title}</p>
							<p className='text-xs text-ink-500 leading-relaxed'>{desc}</p>
						</div>
					</div>
				</div>
			))}
		</div>
	);
};
