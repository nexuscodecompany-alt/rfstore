import {
	HiOutlineCube,
	HiOutlineShieldCheck,
	HiOutlineTruck,
	HiOutlineChatBubbleLeftRight,
} from 'react-icons/hi2';
import { IconType } from 'react-icons';

const features: { icon: IconType; title: string; desc: string }[] = [
	{
		icon: HiOutlineCube,
		title: 'Stock real',
		desc: 'Todos los productos disponibles para envío.',
	},
	{
		icon: HiOutlineShieldCheck,
		title: 'Garantía oficial',
		desc: 'Todos los productos con garantía oficial.',
	},
	{
		icon: HiOutlineTruck,
		title: 'Envíos a todo el país',
		desc: 'Enviamos a todo Uruguay de forma rápida y segura.',
	},
	{
		icon: HiOutlineChatBubbleLeftRight,
		title: 'Atención personalizada',
		desc: 'Asesoramiento técnico antes y después de tu compra.',
	},
];

/** Fila de 4 tarjetas de confianza, debajo del carrusel del hero. */
export const FeatureGrid = () => {
	return (
		<div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4'>
			{features.map(({ icon: Icon, title, desc }) => (
				<div
					key={title}
					className='group relative flex items-start gap-4 overflow-hidden rounded-xl border border-ink-200/70 bg-white p-5 shadow-card transition-all duration-300 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-card-hover'
				>
					<div className='grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-brand-50 to-brand-100 text-brand-700 ring-1 ring-brand-200/60 transition-all duration-300 group-hover:from-brand-600 group-hover:to-brand-700 group-hover:text-white'>
						<Icon size={22} />
					</div>
					<div className='space-y-0.5'>
						<p className='text-sm font-semibold text-ink-900'>{title}</p>
						<p className='text-xs leading-relaxed text-ink-500'>{desc}</p>
					</div>
				</div>
			))}
		</div>
	);
};
