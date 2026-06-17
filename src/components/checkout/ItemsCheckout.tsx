import { formatPrice } from '../../helpers';
import { useCartStore } from '../../store/cart.store';
import { useCheckoutShippingStore } from '../../store/checkoutShipping.store';

export const ItemsCheckout = () => {
	const cartItems = useCartStore(state => state.items);
	const totalAmount = useCartStore(state => state.totalAmount);
	const shippingLabel = useCheckoutShippingStore(s => s.shippingLabel);
	const discountUsd = useCheckoutShippingStore(s => s.discountUsd);
	const couponCode = useCheckoutShippingStore(s => s.couponCode);
	const grandTotalUsd = useCheckoutShippingStore(s => s.grandTotalUsd);

	// Total real a pagar: lo calcula el formulario (subtotal + envío - descuento).
	// Si todavía no se calculó (flujo cotización), caemos al subtotal del carrito.
	const total = grandTotalUsd ?? totalAmount;

	return (
		<div>
			<ul className='space-y-5'>
				{cartItems.map(item => (
					<li
						key={item.variantId}
						className='flex justify-between items-center gap-5'
					>
						<div className='flex relative border border-stone-300 bg-stone-200 rounded-md'>
							<img
								src={item.image}
								alt={item.name}
								className='w-20 h-20 object-contain'
							/>
							<span className='w-5 h-5 rounded-full bg-gray-500 text-white flex items-center justify-center text-xs absolute -right-1 -top-2 font-medium'>
								{item.quantity}
							</span>
						</div>

						<div className='flex-1 space-y-3'>
							<div className='flex justify-between'>
								<p className='font-semibold'>{item.name}</p>
								<p className='text-sm font-medium text-gray-600 mt-1'>
									{formatPrice(item.price)}
								</p>
							</div>
						</div>
					</li>
				))}
			</ul>

			<div className='mt-4 p-7 space-y-3'>
				<div className='flex justify-between text-sm text-gray-600'>
					<p>Subtotal</p>
					<p>{formatPrice(totalAmount)}</p>
				</div>
				<div className='flex justify-between text-sm text-gray-600'>
					<p>Envío</p>
					<p className='uppercase'>{shippingLabel}</p>
				</div>
				{discountUsd > 0 && (
					<div className='flex justify-between text-sm text-emerald-700'>
						<p>Descuento{couponCode ? ` (${couponCode})` : ''}</p>
						<p>- {formatPrice(discountUsd)}</p>
					</div>
				)}
				<div className='flex justify-between font-semibold text-lg border-t border-gray-200 pt-3'>
					<p>Total:</p>
					<p>{formatPrice(total)}</p>
				</div>
			</div>
		</div>
	);
};
