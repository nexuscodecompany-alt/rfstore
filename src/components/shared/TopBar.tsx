import { HiOutlineTruck, HiOutlineShieldCheck, HiOutlineChatBubbleLeftRight } from 'react-icons/hi2';

const items = [
	{ icon: HiOutlineTruck, text: 'Envíos a todo Uruguay' },
	{ icon: HiOutlineShieldCheck, text: 'Garantía oficial' },
	{ icon: HiOutlineChatBubbleLeftRight, text: 'Asesoramiento personalizado' },
];

/** Franja superior de beneficios. Se va con el scroll (no es sticky). */
export const TopBar = () => {
	return (
		<div className='border-b border-ink-100 bg-ink-50/80'>
			<div className='container flex items-center justify-center gap-4 py-1.5 text-[10px] font-medium text-ink-600 sm:gap-10 sm:text-xs'>
				{items.map(({ icon: Icon, text }, i) => (
					<span
						key={text}
						className={`items-center gap-1.5 whitespace-nowrap ${
							i === 2 ? 'hidden sm:flex' : 'flex'
						}`}
					>
						<Icon size={15} className='text-brand-600' />
						{text}
					</span>
				))}
			</div>
		</div>
	);
};
