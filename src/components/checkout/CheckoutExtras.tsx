import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { HiOutlinePlus, HiOutlineCheck, HiOutlineSparkles } from 'react-icons/hi2';
import { useCartStore } from '../../store/cart.store';
import { getCheckoutExtras } from '../../actions/checkoutExtras';
import { formatPrice } from '../../helpers';

/**
 * "Sumá a tu compra": los accesorios que el panel definió para lo que hay en el
 * carrito. Toda la lógica (herencia producto→categoría, precio, stock, qué
 * excluir) la resuelve get_checkout_extras en el servidor; acá sólo se pinta.
 *
 * Vive en el resumen del pedido, debajo del total: es el momento en que el
 * cliente ya vio lo que va a pagar y está por elegir cómo. Si no hay nada para
 * ofrecer, el bloque no se renderiza.
 */
export const CheckoutExtras = ({
	limit = 4,
	compact = false,
}: {
	limit?: number;
	/** Versión chica para el carrito lateral. */
	compact?: boolean;
}) => {
	const items = useCartStore(s => s.items);
	const addItem = useCartStore(s => s.addItem);

	// Las variantes del carrito son la entrada. Se ordenan para que el queryKey
	// no cambie sólo porque el cliente reordenó lo que ya tenía.
	const variantIds = items.map(i => i.variantId).sort();

	const { data: extras = [] } = useQuery({
		queryKey: ['checkout-extras', variantIds, limit],
		queryFn: () => getCheckoutExtras(variantIds, limit),
		enabled: variantIds.length > 0,
		staleTime: 60_000,
	});

	// Lo que ya se agregó desde este bloque, para mostrar el tilde.
	const enCarrito = new Set(items.map(i => i.variantId));

	if (extras.length === 0) return null;

	const add = (e: (typeof extras)[number]) => {
		addItem({
			variantId: e.extra_variant_id,
			productId: e.product_id,
			name: e.name,
			image: e.image,
			color: '',
			storage: '',
			// Precio calculado por el servidor con rf_sale_price, el mismo de la
			// tienda. El servidor lo vuelve a calcular al crear la orden.
			price: e.price_usd,
			quantity: 1,
			// Un extra siempre se puede pagar online: la RPC ya filtró los que no.
			source: 'cdr',
			externalCode: null,
			onlinePayment: true,
			stock: e.stock,
			isExtra: true,
			extraSource: e.origin,
		});
		toast.success(`${e.name} agregado a tu pedido`, { position: 'bottom-right' });
	};

	/* ---------- versión chica: carrito lateral ---------- */
	if (compact) {
		return (
			<section className='rounded-xl border border-brand-200 bg-brand-50/40 p-3'>
				<h3 className='mb-2 text-sm font-semibold text-brand-900'>
					Sumá a tu compra
				</h3>
				<ul className='space-y-2'>
					{extras.map(e => {
						const agregado = enCarrito.has(e.extra_variant_id);
						return (
							<li
								key={e.extra_variant_id}
								className={`flex items-center gap-3 rounded-lg border bg-white p-2.5 ${
									agregado ? 'border-emerald-300' : 'border-ink-200'
								}`}
							>
								<img
									src={e.image}
									alt=''
									className='h-11 w-11 shrink-0 rounded object-contain'
									loading='lazy'
								/>
								<div className='min-w-0 flex-1'>
									<p className='truncate text-sm font-medium text-ink-800'>
										{e.name}
									</p>
									{e.note && (
										<p className='truncate text-[11px] text-ink-500'>{e.note}</p>
									)}
								</div>
								<span className='shrink-0 text-sm font-semibold text-ink-900'>
									{formatPrice(e.price_usd)}
								</span>
								<button
									type='button'
									onClick={() => add(e)}
									disabled={agregado}
									className={`inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
										agregado
											? 'cursor-default bg-emerald-100 text-emerald-700'
											: 'bg-brand-600 text-white hover:bg-brand-700'
									}`}
								>
									{agregado ? (
										<>
											<HiOutlineCheck size={14} /> Listo
										</>
									) : (
										<>
											<HiOutlinePlus size={14} /> Agregar
										</>
									)}
								</button>
							</li>
						);
					})}
				</ul>
			</section>
		);
	}

	/* ---------- versión del resumen del pedido ---------- */
	return (
		<section className='overflow-hidden rounded-2xl border-2 border-brand-500/70 bg-white shadow-lg shadow-brand-900/5'>
			<header className='flex items-center gap-2.5 bg-gradient-to-r from-brand-600 to-brand-700 px-5 py-3.5 text-white'>
				<HiOutlineSparkles size={20} className='shrink-0' />
				<div className='min-w-0'>
					<h3 className='text-[15px] font-bold leading-tight'>Sumá a tu compra</h3>
					<p className='text-[11.5px] leading-tight text-white/80'>
						Los que más se llevan con lo que elegiste
					</p>
				</div>
			</header>

			<ul className='divide-y divide-ink-100'>
				{extras.map(e => {
					const agregado = enCarrito.has(e.extra_variant_id);
					return (
						<li
							key={e.extra_variant_id}
							className={`flex items-center gap-3 px-4 py-3 transition-colors ${
								agregado ? 'bg-emerald-50/60' : 'hover:bg-brand-50/40'
							}`}
						>
							<img
								src={e.image}
								alt=''
								className='h-14 w-14 shrink-0 rounded-lg border border-ink-100 bg-white object-contain p-1'
								loading='lazy'
							/>

							<div className='min-w-0 flex-1'>
								<p className='text-sm font-semibold leading-snug text-ink-900'>
									{e.name}
								</p>
								{e.note ? (
									<p className='truncate text-[11.5px] text-ink-500'>{e.note}</p>
								) : (
									e.stock <= 3 && (
										<p className='text-[11.5px] font-medium text-amber-600'>
											¡Quedan {e.stock}!
										</p>
									)
								)}
								<p className='mt-0.5 text-[15px] font-bold text-brand-700'>
									+ {formatPrice(e.price_usd)}
								</p>
							</div>

							<button
								type='button'
								onClick={() => add(e)}
								disabled={agregado}
								className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wide transition-all ${
									agregado
										? 'cursor-default bg-emerald-100 text-emerald-700'
										: 'bg-brand-600 text-white shadow-sm hover:bg-brand-700 active:scale-95'
								}`}
							>
								{agregado ? (
									<>
										<HiOutlineCheck size={15} /> Agregado
									</>
								) : (
									<>
										<HiOutlinePlus size={15} /> Agregar
									</>
								)}
							</button>
						</li>
					);
				})}
			</ul>
		</section>
	);
};
