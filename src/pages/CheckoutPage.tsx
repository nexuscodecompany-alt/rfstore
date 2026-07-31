import { Link, useNavigate } from 'react-router-dom';
import { useCartStore } from '../store/cart.store';
import { FormCheckout } from '../components/checkout/FormCheckout';
import { CdrCheckoutForm } from '../components/checkout/CdrCheckoutForm';
import { ItemsCheckout } from '../components/checkout/ItemsCheckout';
import { ScrollToTop } from '../components/shared/ScrollToTop';
import { useUser, usePaymentsEnabled } from '../hooks';
import { canBuyOnline } from '../helpers';
import { Loader } from '../components/shared/Loader';
import { useEffect, useRef } from 'react';
import { supabase } from '../supabase/client';
import { trackInitiateCheckout } from '../lib/pixel';

export const CheckoutPage = () => {
	const totalItems = useCartStore(state => state.totalItemsInCart);
	const cartItems = useCartStore(state => state.items);
	const totalAmount = useCartStore(state => state.totalAmount);
	const { enabled: paymentsEnabled } = usePaymentsEnabled();
	// "Comprable online" ya no es sólo CDR: también los manuales que el admin
	// habilitó con pago online. El checkout con pasarela sólo aparece si TODO el
	// carrito lo es; si se mezcla con productos por consulta, va a cotización.
	const isOnline = (i: (typeof cartItems)[number]) =>
		canBuyOnline(
			{ source: i.source, online_payment: i.onlinePayment },
			paymentsEnabled
		);
	const allOnline = cartItems.length > 0 && cartItems.every(isOnline);
	const anyOnline = cartItems.some(isOnline);
	const mixed = anyOnline && !allOnline;

	const { isLoading } = useUser();

	const navigate = useNavigate();

	// Meta Pixel: InitiateCheckout una sola vez al entrar con carrito cargado.
	const checkoutTracked = useRef(false);
	useEffect(() => {
		if (checkoutTracked.current || cartItems.length === 0) return;
		checkoutTracked.current = true;
		trackInitiateCheckout(
			cartItems.map(i => ({
				// content_id = id del producto (igual que en el feed del catálogo).
				id: i.productId,
				quantity: i.quantity,
				price: i.price,
			})),
			totalAmount
		);
	}, [cartItems, totalAmount]);

	useEffect(() => {
		supabase.auth.onAuthStateChange(async (event, session) => {
			if (event === 'SIGNED_OUT' || !session) {
				navigate('/login');
			}
		});
	}, [navigate]);

	if (isLoading) return <Loader />;

	return (
		<div
			style={{
				minHeight: 'calc(100vh - 100px',
			}}
		>
			<ScrollToTop />
			<header className='h-[100px] bg-white text-black flex items-center justify-center flex-col px-10 border-b border-slate-200'>
				<Link to='/' className='self-center md:self-start'>
					<img
						src='/img/img-docs/logoblancorf.jpg'
						alt='Logo de RF Store'
						className='h-14 w-auto'
					/>
				</Link>
			</header>

			<main className='relative flex w-full h-full'>
				{totalItems === 0 ? (
					<div
						className='flex flex-col items-center justify-center w-full gap-5'
						style={{
							height: 'calc(100vh - 100px)',
						}}
					>
						<p className='text-sm font-medium tracking-tight'>Su carro esta vacío</p>
						<Link
							to='/tienda'
							className='py-4 text-xs font-semibold tracking-widest text-white uppercase bg-black rounded-full px-7'
						>
							Empezar a comprar
						</Link>
					</div>
				) : (
					<>
						<div className='w-full md:w-[50%] p-10'>
							{mixed && (
								<div className='bg-yellow-50 border border-yellow-300 p-3 rounded mb-4 text-sm'>
									Tu carrito mezcla productos con pago online y productos por
									consulta. Por ahora generamos cotización por WhatsApp para
									todos. Para pagar online, dejá solo productos marcados como
									"Pago online".
								</div>
							)}
							{allOnline ? <CdrCheckoutForm /> : <FormCheckout />}
						</div>

						<div
							className='bg-stone-100 w-[50%] sticky top-0 right-0 p-10 hidden md:block'
							style={{
								minHeight: 'calc(100vh - 100px)',
							}}
						>
							<ItemsCheckout />
						</div>
					</>
				)}
			</main>
		</div>
	);
};
