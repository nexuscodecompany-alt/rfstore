import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { IoChevronBack } from 'react-icons/io5';
import { HiOutlineMapPin, HiOutlineUser } from 'react-icons/hi2';
import { useNavigate, useParams } from 'react-router-dom';
import { useOrderAdmin } from '../../hooks';
import { updateOrderMlCosts, updatePackMlCosts } from '../../actions';
import { Loader } from '../../components/shared/Loader';
import { formatPriceCurrency, formatDateTime, orderStatusBadge } from '../../helpers';

// fx_rate (pesos por USD) cuando la orden se cobró en pesos vía ML; 1 en otro caso.
const orderFx = (o: { channel?: string | null; mlCurrency?: string | null; fxRate?: number }) =>
	o.channel === 'ml' && o.mlCurrency === 'UYU' && (o.fxRate ?? 0) > 0 ? (o.fxRate as number) : 1;

// El costo CDR se compra CON IVA (22%): el precio CDR es sin IVA y RF paga el IVA
// al comprar. La ganancia real usa costo × 1.22.
const CDR_IVA_FACTOR = 1.22;
const costWithIva = (cost: number) => cost * CDR_IVA_FACTOR;

export const DashboardOrderPage = () => {
	const navigate = useNavigate();
	const { id } = useParams<{ id: string }>();

	const { data: order, isLoading, isError } = useOrderAdmin(Number(id));
	const queryClient = useQueryClient();

	// Costos/comisiones de ML cargados a mano. El admin los ve y los ingresa en la
	// moneda real de la venta (pesos en ML/UYU); internamente se guardan en USD.
	const [commission, setCommission] = useState(0);
	const [shipping, setShipping] = useState(0);
	const [other, setOther] = useState(0);
	useEffect(() => {
		if (order) {
			const fx = orderFx(order);
			setCommission(Math.round(order.mlCommissionUsd * fx * 100) / 100);
			setShipping(Math.round(order.mlShippingCostUsd * fx * 100) / 100);
			setOther(Math.round(order.mlOtherCostsUsd * fx * 100) / 100);
		}
	}, [order]);

	const { mutate: saveCosts, isPending: savingCosts } = useMutation({
		mutationFn: () => {
			const fx = order ? orderFx(order) : 1;
			// Guardamos en USD: lo ingresado (moneda nativa) / fx de la orden.
			const costsUsd = {
				commission: commission / fx,
				shipping: shipping / fx,
				other: other / fx,
			};
			// Si es una venta ML unificada (pack con varias órdenes), guardamos los
			// costos una sola vez para todo el pack.
			const packIds = order?.packOrderIds ?? [];
			return packIds.length > 1
				? updatePackMlCosts(packIds, costsUsd)
				: updateOrderMlCosts(Number(id), costsUsd);
		},
		onSuccess: () => {
			toast.success('Costos guardados');
			queryClient.invalidateQueries({ queryKey: ['order', 'admin', Number(id)] });
		},
		onError: (e: Error) => toast.error(e.message),
	});

	if (isLoading) return <Loader />;

	if (isError || !order) {
		return (
			<div className='mx-auto max-w-md rounded-2xl border border-ink-200 bg-white p-8 text-center shadow-soft'>
				<p className='text-lg font-semibold text-ink-900'>
					No se pudo cargar el pedido
				</p>
				<p className='mt-1 text-sm text-ink-500'>
					Es posible que el pedido #{id} no exista o haya sido eliminado.
				</p>
				<button
					onClick={() => navigate('/dashboard/ordenes')}
					className='mt-5 inline-flex items-center gap-2 rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-brand-700'
				>
					<IoChevronBack size={16} />
					Volver a órdenes
				</button>
			</div>
		);
	}

	// Moneda real de la venta: pesos para ML/UYU, dólares para web. Todo se calcula
	// internamente en USD y se convierte al mostrar con el fx de la orden.
	const fx = orderFx(order);
	const cur: 'USD' | 'UYU' = fx !== 1 ? 'UYU' : 'USD';
	const isUyu = cur === 'UYU';
	// Recibe un valor en USD (interno) y lo muestra en la moneda de la orden.
	const money = (usd: number) => formatPriceCurrency(usd * fx, cur);

	// Margen vs costo CDR (registrado al momento de la venta en cost_usd). Todo USD.
	const itemsRevenue = order.orderItems.reduce(
		(s, i) => s + i.price * i.quantity,
		0
	);
	const hasCost = order.orderItems.some(i => i.cost != null);
	const totalCost = order.orderItems.reduce(
		(s, i) => s + costWithIva(i.cost ?? 0) * i.quantity,
		0
	);
	const margin = itemsRevenue - totalCost;
	const marginPct = totalCost > 0 ? (margin / totalCost) * 100 : null;
	// Inputs de costos ML están en moneda nativa; pasamos a USD para la ganancia real.
	const mlCostsTotalUsd = (commission + shipping + other) / fx;
	const realProfit = margin - mlCostsTotalUsd;
	// Total que se muestra: para ML/UYU el monto exacto en pesos que pagó el comprador.
	const displayTotal = isUyu && order.totalOriginal != null ? order.totalOriginal : order.totalAmount * fx;

	return (
		<div className='space-y-6'>
			{/* Encabezado */}
			<div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
				<div className='flex items-center gap-3'>
					<button
						className='grid h-10 w-10 place-items-center rounded-full border border-ink-200 text-ink-600 transition-all hover:bg-ink-100'
						onClick={() => navigate('/dashboard/ordenes')}
						aria-label='Volver'
					>
						<IoChevronBack size={18} />
					</button>
					<div>
						<h1 className='text-2xl font-bold text-ink-900'>
							Pedido #{order.id}
						</h1>
						<p className='text-sm text-ink-500'>
							{formatDateTime(order.created_at)}
						</p>
					</div>
				</div>
				<div className='flex w-fit items-center gap-2'>
					{order.channel === 'ml' && (
						<span
							className='inline-flex items-center rounded-full bg-yellow-400 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-stone-900'
							title={order.ml_order_id ? `Orden ML ${order.ml_order_id}` : 'Venta de Mercado Libre'}
						>
							Mercado Libre
						</span>
					)}
					<span
						className={`inline-flex items-center rounded-full px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wide ${orderStatusBadge(
							order.status
						)}`}
					>
						{order.status}
					</span>
				</div>
			</div>

			{(order.packOrderIds?.length ?? 0) > 1 && (
				<div className='flex items-start gap-3 rounded-xl border border-yellow-300 bg-yellow-50/70 p-4'>
					<span className='text-xl'>🛒</span>
					<div className='text-sm'>
						<p className='font-semibold text-yellow-900'>
							Venta unificada de Mercado Libre ({order.packOrderIds!.length} pedidos)
						</p>
						<p className='text-yellow-800'>
							El comprador llevó varios productos en un mismo carrito y ML los partió
							en {order.packOrderIds!.length} pedidos. Acá los ves juntos como una sola
							venta: cargá la <b>comisión y el envío una sola vez</b> para todo el pack.
						</p>
					</div>
				</div>
			)}

			{order.paymentMethod === 'mercadopago' && order.paymentStatus !== 'paid' && (
				<div className='flex items-start gap-3 rounded-xl border border-dashed border-amber-300 bg-amber-50/70 p-4'>
					<span className='text-xl'>🛒</span>
					<div className='text-sm'>
						<p className='font-semibold text-amber-900'>
							Checkout sin pagar — no es una venta
						</p>
						<p className='text-amber-800'>
							Esta persona llegó al pago de Mercado Pago pero <b>no completó el pago</b>.
							Queda como registro para seguimiento; no se cobró ni se debe despachar.
						</p>
					</div>
				</div>
			)}

			<div className='grid grid-cols-1 gap-6 lg:grid-cols-3'>
				{/* Productos */}
				<div className='lg:col-span-2'>
					<div className='overflow-hidden rounded-2xl border border-ink-200/70 bg-white shadow-soft'>
						<div className='border-b border-ink-100 px-5 py-4'>
							<h2 className='font-bold text-ink-900'>
								Productos ({order.orderItems.length})
							</h2>
						</div>
						<ul className='divide-y divide-ink-100'>
							{order.orderItems.map((item, index) => (
								<li
									key={index}
									className='flex items-center gap-4 px-5 py-4'
								>
									<div className='h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-ink-100 bg-ink-50'>
										{item.productImage && (
											<img
												src={item.productImage}
												alt={item.productName}
												className='h-full w-full object-contain'
											/>
										)}
									</div>
									<div className='min-w-0 flex-1'>
										<h3 className='truncate font-medium text-ink-800'>
											{item.productName}
										</h3>
										<p className='text-xs text-ink-500'>
											{[item.color_name, item.storage]
												.filter(Boolean)
												.join(' / ')}
										</p>
										<p className='mt-1 text-sm text-ink-600'>
											{money(item.price)} × {item.quantity}
										</p>
										{item.cost != null && (
											<p className='mt-0.5 text-xs text-emerald-700'>
												Costo CDR c/IVA {money(costWithIva(item.cost))} · Margen{' '}
												{money((item.price - costWithIva(item.cost)) * item.quantity)}
												{item.cost > 0 &&
													` (${Math.round(((item.price - costWithIva(item.cost)) / costWithIva(item.cost)) * 100)}%)`}
											</p>
										)}
									</div>
									<p className='shrink-0 font-semibold text-ink-900'>
										{money(item.price * item.quantity)}
									</p>
								</li>
							))}
						</ul>
					</div>
				</div>

				{/* Resumen + cliente + dirección */}
				<div className='space-y-6'>
					<div className='rounded-2xl border border-ink-200/70 bg-white p-5 shadow-soft'>
						<h2 className='mb-4 font-bold text-ink-900'>Resumen</h2>
						<div className='space-y-2.5 text-sm text-ink-600'>
							<div className='flex justify-between'>
								<span>Subtotal</span>
								<span>{formatPriceCurrency(displayTotal, cur)}</span>
							</div>
							<div className='flex justify-between'>
								<span>Envío</span>
								<span>{money(0)}</span>
							</div>
							<div className='mt-2 flex justify-between border-t border-ink-100 pt-3 text-base font-bold text-ink-900'>
								<span>Total</span>
								<span>{formatPriceCurrency(displayTotal, cur)}</span>
							</div>
							<div className='mt-2 space-y-1.5 border-t border-ink-100 pt-3'>
								{hasCost && (
									<>
										<div className='flex justify-between text-ink-500'>
											<span>Costo CDR c/IVA</span>
											<span>{money(totalCost)}</span>
										</div>
										<div className='flex justify-between text-ink-600'>
											<span>Ganancia bruta</span>
											<span>
												{money(margin)}
												{marginPct != null && ` (${Math.round(marginPct)}%)`}
											</span>
										</div>
									</>
								)}

								{/* Costos/comisiones de Mercado Libre (cargados a mano, en la moneda de la venta) */}
								<div className='mt-2 space-y-2 border-t border-ink-100 pt-3'>
									<p className='text-xs font-semibold uppercase tracking-wider text-ink-500'>
										Costos Mercado Libre ({isUyu ? 'pesos' : 'USD'})
									</p>
									<CostInput label='Comisión ML' value={commission} onChange={setCommission} currency={cur} />
									<CostInput label='Envío (Mercado Envíos)' value={shipping} onChange={setShipping} currency={cur} />
									<CostInput label='Otros costos' value={other} onChange={setOther} currency={cur} />
									<button
										onClick={() => saveCosts()}
										disabled={savingCosts}
										className='w-full rounded-md bg-stone-800 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50'
									>
										{savingCosts ? 'Guardando…' : 'Guardar costos'}
									</button>
								</div>

								{hasCost && (
									<div className='mt-2 flex justify-between border-t border-ink-100 pt-3 text-base font-bold text-emerald-700'>
										<span>Ganancia real</span>
										<span>{money(realProfit)}</span>
									</div>
								)}
							</div>
						</div>
					</div>

					<div className='rounded-2xl border border-ink-200/70 bg-white p-5 shadow-soft'>
						<h2 className='mb-3 flex items-center gap-2 font-bold text-ink-900'>
							<HiOutlineUser className='text-brand-600' size={18} />
							Cliente
						</h2>
						<p className='text-sm font-medium text-ink-800'>
							{order.customer.full_name ||
								(order.channel === 'ml'
									? 'Comprador de Mercado Libre'
									: 'Sin nombre')}
						</p>
						{order.customer.email && (
							<a
								href={`mailto:${order.customer.email}`}
								className='text-sm text-brand-600 hover:underline'
							>
								{order.customer.email}
							</a>
						)}
					</div>

					<div className='rounded-2xl border border-ink-200/70 bg-white p-5 shadow-soft'>
						<h2 className='mb-3 flex items-center gap-2 font-bold text-ink-900'>
							<HiOutlineMapPin className='text-brand-600' size={18} />
							Dirección de envío
						</h2>
						<div className='space-y-0.5 text-sm text-ink-600'>
							{order.address?.addressLine1 ? (
								<>
									<p>{order.address?.addressLine1}</p>
									{order.address?.addressLine2 && (
										<p>{order.address?.addressLine2}</p>
									)}
									<p>
										{[order.address?.city, order.address?.state]
											.filter(Boolean)
											.join(', ')}
									</p>
									{order.address?.postalCode && (
										<p>CP {order.address?.postalCode}</p>
									)}
									<p>{order.address?.country}</p>
								</>
							) : (
								<p className='text-ink-400'>
									{order.channel === 'ml'
										? 'Envío gestionado por Mercado Envíos (ML).'
										: 'Sin dirección registrada (cotización).'}
								</p>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
};

const CostInput = ({
	label,
	value,
	onChange,
	currency,
}: {
	label: string;
	value: number;
	onChange: (n: number) => void;
	currency: 'USD' | 'UYU';
}) => (
	<div className='flex items-center justify-between gap-2'>
		<span className='text-sm text-ink-600'>{label}</span>
		<div className='flex items-center gap-1'>
			<span className='text-xs text-ink-400'>{currency === 'UYU' ? '$' : 'USD'}</span>
			<input
				type='number'
				value={value}
				onChange={e => onChange(Number(e.target.value) || 0)}
				className='w-24 rounded border border-ink-200 px-2 py-1 text-sm text-right'
			/>
		</div>
	</div>
);
