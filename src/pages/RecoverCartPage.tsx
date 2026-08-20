import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ImSpinner2 } from 'react-icons/im';
import { HiOutlineExclamationTriangle } from 'react-icons/hi2';
import { useCartStore } from '../store/cart.store';
import {
	restoreAbandonedCart,
	guardarCuponRecuperado,
	type RecoveredCart,
} from '../actions/abandonedCart';

/**
 * Destino del botón "Retomar mi compra" del mail.
 *
 * Restaura el carrito con precios y stock de HOY y deja el cupón preparado para
 * el checkout. Acá es donde el cliente se entera de cuánto es el descuento: el
 * mail no lo dice.
 */
export const RecoverCartPage = () => {
	const { token } = useParams<{ token: string }>();
	const navigate = useNavigate();
	const cleanCart = useCartStore(s => s.cleanCart);
	const addItem = useCartStore(s => s.addItem);

	const [estado, setEstado] = useState<'cargando' | 'error'>('cargando');
	const [mensaje, setMensaje] = useState('');
	const yaCorrio = useRef(false);

	useEffect(() => {
		if (yaCorrio.current || !token) return;
		yaCorrio.current = true;

		(async () => {
			let res: RecoveredCart;
			try {
				res = await restoreAbandonedCart(token);
			} catch (e) {
				setEstado('error');
				setMensaje((e as Error).message);
				return;
			}

			if (!res.ok || res.items.length === 0) {
				setEstado('error');
				setMensaje(
					res.reason ??
						'Los productos que tenías guardados ya no están disponibles.'
				);
				return;
			}

			// Se reemplaza el carrito actual: el cliente vino a retomar ESTA compra.
			cleanCart();
			res.items.forEach(addItem);
			guardarCuponRecuperado(res.coupon);

			// Al checkout, avisando si algo quedó afuera.
			const params = new URLSearchParams({ recuperado: '1' });
			if (res.descartados > 0) params.set('descartados', String(res.descartados));
			navigate(`/checkout?${params.toString()}`, { replace: true });
		})();
	}, [token, cleanCart, addItem, navigate]);

	if (estado === 'error') {
		return (
			<div className='flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center'>
				<HiOutlineExclamationTriangle className='text-amber-500' size={44} />
				<h1 className='text-xl font-bold text-ink-900'>
					No pudimos recuperar tu carrito
				</h1>
				<p className='max-w-md text-sm text-ink-500'>{mensaje}</p>
				<button
					onClick={() => navigate('/tienda')}
					className='mt-2 rounded-full bg-black px-7 py-3.5 text-xs font-semibold uppercase tracking-widest text-white'
				>
					Ir a la tienda
				</button>
			</div>
		);
	}

	return (
		<div className='flex min-h-screen flex-col items-center justify-center gap-4'>
			<ImSpinner2 className='h-10 w-10 animate-spin text-brand-600' />
			<p className='text-sm font-medium text-ink-700'>
				Recuperando tu carrito…
			</p>
		</div>
	);
};
