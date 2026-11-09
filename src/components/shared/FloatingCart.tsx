import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { HiOutlineShoppingBag } from 'react-icons/hi';
import { useGlobalStore } from '../../store/global.store';
import { useCartStore } from '../../store/cart.store';

// Pasado este scroll el navbar (con su botón de carrito) ya no se ve.
const SHOW_AFTER_PX = 220;

// Páginas que muestran el botón flotante de WhatsApp abajo a la derecha: ahí
// el carrito va encima, no tapándolo.
const WITH_WHATSAPP = new Set(['/', '/tienda']);

/** Botón de carrito flotante: aparece cuando el navbar quedó fuera de la vista. */
export const FloatingCart = () => {
	const { pathname } = useLocation();
	const openSheet = useGlobalStore(s => s.openSheet);
	const isSheetOpen = useGlobalStore(s => s.isSheetOpen);
	const totalItems = useCartStore(s => s.totalItemsInCart);
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		const onScroll = () => setVisible(window.scrollY > SHOW_AFTER_PX);
		onScroll();
		window.addEventListener('scroll', onScroll, { passive: true });
		return () => window.removeEventListener('scroll', onScroll);
	}, []);

	const show = visible && !isSheetOpen;
	const bottom = WITH_WHATSAPP.has(pathname) ? 'bottom-24' : 'bottom-6';

	return (
		<button
			onClick={() => openSheet('cart')}
			aria-label={totalItems > 0 ? `Carrito (${totalItems})` : 'Carrito'}
			tabIndex={show ? 0 : -1}
			aria-hidden={!show}
			className={`fixed right-6 ${bottom} z-50 grid h-14 w-14 place-items-center rounded-full bg-ink-950 text-white shadow-card ring-1 ring-white/10 transition-all duration-300 hover:scale-105 ${
				show ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0'
			}`}
		>
			<HiOutlineShoppingBag size={24} />
			{totalItems > 0 && (
				<span className='absolute -right-1 -top-1 grid h-6 min-w-6 place-items-center rounded-full bg-gradient-to-br from-brand-600 to-brand-700 px-1.5 text-xs font-bold text-white ring-2 ring-white'>
					{totalItems}
				</span>
			)}
		</button>
	);
};
