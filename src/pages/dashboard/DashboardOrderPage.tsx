import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { IoChevronBack } from 'react-icons/io5';
import { HiOutlineMapPin, HiOutlineUser } from 'react-icons/hi2';
import { useNavigate, useParams } from 'react-router-dom';
import { useOrderAdmin } from '../../hooks';
import { updateOrderMlCosts } from '../../actions';
import { Loader } from '../../components/shared/Loader';
import { formatPrice, formatDateTime, orderStatusBadge } from '../../helpers';

export const DashboardOrderPage = () => {
	const navigate = useNavigate();
	const { id } = useParams<{ id: string }>();

	const { data: order, isLoading, isError } = useOrderAdmin(Number(id));
	const queryClient = useQueryClient();

	// Costos/comisiones de ML cargados a mano (USD) para la ganancia real.
	const [commission, setCommission] = useState(0);
	const [shipping, setShipping] = useState(0);
	const [other, setOther] = useState(0);
	useEffect(() => {
		if (order) {
			setCommission(order.mlCommissionUsd);
			setShipping(order.mlShippingCostUsd);
			setOther(order.mlOtherCostsUsd);
		}
	}, [order]);

	const { mutate: saveCosts, isPending: savingCosts } = useMutation({
		mutationFn: () => updateOrderMlCosts(Number(id), { commission, shipping, other }),
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

	// Margen vs costo CDR (registrado al momento de la venta en cost_usd).
	const itemsRevenue = order.orderItems.reduce(
		(s, i) => s + i.price * i.quantity,
		0
	);
	const hasCost = order.orderItems.some(i => i.cost != null);
	const totalCost = order.orderItems.reduce(
		(s, i) => s + (i.cost ?? 0) * i.quantity,
		0
	);
	const margin = itemsRevenue - totalCost;
	const marginPct = totalCost > 0 ? (margin / totalCost) * 100 : null;
	const mlCostsTotal = commission + shipping + other;
	const realProfit = margin - mlCostsTotal;

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
											{formatPrice(item.price)} × {item.quantity}
										</p>
										{item.cost != null && (
											<p className='mt-0.5 text-xs text-emerald-700'>
												Costo CDR {formatPrice(item.cost)} · Margen{' '}
												{formatPrice((item.price - item.cost) * item.quantity)}
												{item.cost > 0 &&
													` (${Math.round(((item.price - item.cost) / item.cost) * 100)}%)`}
											</p>
										)}
									</div>
									<p className='shrink-0 font-semibold text-ink-900'>
										{formatPrice(item.price * item.quantity)}
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
								<span>{formatPrice(order.totalAmount)}</span>
							</div>
							<div className='flex justify-between'>
								<span>Envío</span>
								<span>{formatPrice(0)}</span>
							</div>
							<div className='mt-2 flex justify-between border-t border-ink-100 pt-3 text-base font-bold text-ink-900'>
								<span>Total</span>
								<span>{formatPrice(order.totalAmount)}</span>
							</div>
							<div className='mt-2 space-y-1.5 border-t border-ink-100 pt-3'>
								{hasCost && (
									<>
										<div className='flex justify-between text-ink-500'>
											<span>Costo CDR</span>
											<span>{formatPrice(totalCost)}</span>
										</div>
										<div className='flex justify-between text-ink-600'>
											<span>Ganancia bruta</span>
											<span>
												{formatPrice(margin)}
												{marginPct != null && ` (${Math.round(marginPct)}%)`}
											</span>
										</div>
									</>
								)}

								{/* Costos/comisiones de Mercado Libre (cargados a mano) */}
								<div className='mt-2 space-y-2 border-t border-ink-100 pt-3'>
									<p className='text-xs font-semibold uppercase tracking-wider text-ink-500'>
										Costos Mercado Libre (USD)
									</p>
									<CostInput label='Comisión ML' value={commission} onChange={setCommission} />
									<CostInput label='Envío (Mercado Envíos)' value={shipping} onChange={setShipping} />
									<CostInput label='Otros costos' value={other} onChange={setOther} />
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
										<span>{formatPrice(realProfit)}</span>
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

const CostInput = ({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) => (
	<div className='flex items-center justify-between gap-2'>
		<span className='text-sm text-ink-600'>{label}</span>
		<div className='flex items-center gap-1'>
			<span className='text-xs text-ink-400'>USD</span>
			<input
				type='number'
				value={value}
				onChange={e => onChange(Number(e.target.value) || 0)}
				className='w-24 rounded border border-ink-200 px-2 py-1 text-sm text-right'
			/>
		</div>
	</div>
);
