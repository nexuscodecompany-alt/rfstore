import { HiOutlineShoppingBag } from 'react-icons/hi';
import { useGlobalStore } from '../../store/global.store';
import { IoMdClose } from 'react-icons/io';
import { Link } from 'react-router-dom';
import { RiSecurePaymentLine } from 'react-icons/ri';
import { CartItem } from './CartItem';
import { CheckoutExtras } from '../checkout/CheckoutExtras';
import { useCartStore } from '../../store/cart.store';
import { usePaymentsEnabled } from '../../hooks';
import { canBuyOnline } from '../../helpers';

export const Cart = () => {
	const closeSheet = useGlobalStore(state => state.closeSheet);

	const cartItems = useCartStore(state => state.items);
	const cleanCart = useCartStore(state => state.cleanCart);
	const totalItemsInCart = useCartStore(
		state => state.totalItemsInCart
	);
	const { enabled: paymentsEnabled } = usePaymentsEnabled();
	// Mismo criterio que el checkout: compra directa sólo si TODO el carrito se
	// vende online (CDR o manual habilitado); si no, es cotización.
	const allOnline =
		cartItems.length > 0 &&
		cartItems.every(i =>
			canBuyOnline(
				{ source: i.source, online_payment: i.onlinePayment },
				paymentsEnabled
			)
		);
	const ctaLabel = allOnline
		? 'Continuar con tu compra'
		: 'Continuar con la cotización';

	return (
		<div className='flex flex-col h-full'>
			<div className='px-5 py-7 flex justify-between items-center border-b border-slate-200'>
				<span className='flex gap-3 items-center font-semibold'>
					<HiOutlineShoppingBag size={20} />
					{totalItemsInCart} artículos
				</span>
				<button onClick={closeSheet}>
					<IoMdClose size={25} className='text-black' />
				</button>
			</div>

			{totalItemsInCart > 0 ? (
				<>
					{/* LISTA DE PRODUCTOS AÑADIDOS AL CARRITO */}
					<div className='p-7 overflow-auto flex-1'>
						<ul className='space-y-9'>
							{cartItems.map(item => (
								<CartItem item={item} key={item.variantId} />
							))}
						</ul>

						{/* Venta cruzada, versión chica: 2 para no empujar el botón de
						    comprar fuera de pantalla. El bloque no se pinta si no hay nada
						    configurado para lo que el cliente lleva. */}
						<div className='mt-8'>
							<CheckoutExtras limit={2} compact />
						</div>
					</div>

					{/* BOTONES ACCIÓN */}
					<div className='mt-4 p-7'>
						<Link
							to='/checkout'
							onClick={closeSheet}
							className='w-full bg-black text-white py-3.5 rounded-full flex items-center justify-center gap-3'
						>
							<RiSecurePaymentLine size={24} />
							{ctaLabel}
						</Link>

						<button
							className='mt-3 w-full text-black border border-black rounded-full py-3'
							onClick={cleanCart}
						>
							Limpiar Carrito
						</button>
					</div>
				</>
			) : (
				<div className='flex flex-col items-center justify-center h-full gap-7'>
					<p className='text-sm font-medium tracking-tight'>
						Su carro esta vacío
					</p>
					<Link
						to='/tienda'
						className='py-4 bg-black rounded-full text-white px-7 text-xs uppercase tracking-widest font-semibold'
						onClick={closeSheet}
					>
						Empezar a comprar
					</Link>
				</div>
			)}
		</div>
	);
};
