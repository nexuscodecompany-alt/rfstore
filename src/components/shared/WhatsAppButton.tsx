import { FaWhatsapp } from 'react-icons/fa';

export default function WhatsAppButton() {
	const phoneNumber = '59894116299';
	const message =
		'Hola, me gustaría consultar sobre sus productos que vi desde la web de RF STORE.';

	return (
		<a
			href={`https://wa.me/${phoneNumber}?text=${encodeURIComponent(message)}`}
			target='_blank'
			rel='noopener noreferrer'
			className='group fixed bottom-6 right-6 z-50 flex items-center gap-3'
			aria-label='Chatear por WhatsApp'
		>
			{/* TOOLTIP */}
			<span className='hidden md:inline-flex items-center px-3 py-2 bg-ink-900 text-white text-xs font-semibold rounded-lg shadow-card opacity-0 translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300'>
				¿Hablamos por WhatsApp?
			</span>

			<span className='relative grid place-items-center w-14 h-14 rounded-full bg-[#25D366] text-white shadow-card hover:shadow-glow-brand transition-shadow'>
				{/* PULSE RINGS */}
				<span
					aria-hidden
					className='absolute inset-0 rounded-full bg-[#25D366] animate-pulse-ring'
				/>
				<span
					aria-hidden
					className='absolute inset-0 rounded-full bg-[#25D366] animate-pulse-ring [animation-delay:0.6s]'
				/>
				<FaWhatsapp size={28} className='relative z-10' />

				{/* ONLINE DOT */}
				<span className='absolute top-0 right-0 w-3.5 h-3.5 rounded-full bg-emerald-400 ring-2 ring-white' />
			</span>
		</a>
	);
}
