import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useGlobalStore } from '../../store/global.store';
import { Cart } from './Cart';
import { Search } from './Search';

export const Sheet = () => {
	const sheetContent = useGlobalStore(state => state.sheetContent);
	const closeSheet = useGlobalStore(state => state.closeSheet);
	const location = useLocation();
	const initialPathRef = useRef(location.pathname);

	const sheetRef = useRef<HTMLDivElement | null>(null);

	// Si cambia la ruta mientras el sheet está abierto (ej. el usuario clickea
	// "Comprar" y lo redirige a /login), cerramos automáticamente.
	useEffect(() => {
		if (location.pathname !== initialPathRef.current) {
			closeSheet();
		}
	}, [location.pathname, closeSheet]);

	useEffect(() => {
		document.body.style.overflow = 'hidden';

		const handleOutsideClick = (event: MouseEvent) => {
			if (
				sheetRef.current &&
				!sheetRef.current.contains(event.target as Node)
			) {
				closeSheet();
			}
		};

		document.addEventListener('mousedown', handleOutsideClick);

		return () => {
			document.body.style.overflow = 'unset';
			document.removeEventListener('mousedown', handleOutsideClick);
		};
	}, [closeSheet]);

	// Función para saber el componente a renderizar
	const renderContent = () => {
		switch (sheetContent) {
			case 'cart':
				return <Cart />;
			case 'search':
				return <Search />;
			default:
				return null;
		}
	};

	return (
		<div className='fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-end animate-fade-in'>
			<div
				ref={sheetRef}
				className='flex flex-col bg-white text-black h-[100dvh] w-full max-w-[500px] shadow-lg animate-slide-in overflow-y-auto overflow-x-hidden overscroll-contain'
			>
				{renderContent()}
			</div>
		</div>
	);
};
