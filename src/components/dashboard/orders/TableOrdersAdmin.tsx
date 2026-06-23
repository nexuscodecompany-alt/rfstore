import { useNavigate } from 'react-router-dom';
import { HiChevronRight, HiOutlineShoppingCart } from 'react-icons/hi2';
import {
	formatDateLong,
	formatPrice,
	formatMoneyCur,
	orderStatusBadge,
	orderStatusOptions,
} from '../../../helpers';
import { OrderWithCustomer } from '../../../interfaces';
import { useChangeStatusOrder } from '../../../hooks';

interface Props {
	orders: OrderWithCustomer[];
	// Click en una venta manual: la gestiona el contenedor (abre el modal).
	onManualClick?: (orderId: number) => void;
}

// Un "checkout sin pagar" es una orden de MercadoPago que NUNCA se pagó: el
// cliente llegó al pago y no lo completó. NO es una venta — queda solo como
// registro para seguimiento. (Transferencia/depósito pendientes SÍ son órdenes
// reales a confirmar a mano, así que NO entran acá.)
const isUnpaidMpCheckout = (o: OrderWithCustomer): boolean =>
	o.payment_method === 'mercadopago' && o.payment_status !== 'paid';

const didNotPay = (o: OrderWithCustomer): boolean =>
	['expirado', 'Cancelado', 'cancelado', 'rechazado'].includes(o.status);

// Una fila del listado. Para una venta normal representa una orden; para una venta
// ML en carrito (pack) agrupa todas las órdenes del pack en una sola.
interface OrderRow {
	key: string;
	rep: OrderWithCustomer; // orden representativa (la más reciente del pack)
	ids: number[]; // todas las órdenes que agrupa (1 si no es pack)
	realTotal: number; // total en la MONEDA REAL de la venta (pesos ML, USD web)
	currency: 'UYU' | 'USD';
	count: number; // cantidad de pedidos del pack
}

// Moneda y monto REAL de la venta: pesos para ML/UYU (total_original), dólares para web.
const realCurrency = (o: OrderWithCustomer): 'UYU' | 'USD' =>
	o.ml_currency === 'UYU' ? 'UYU' : 'USD';
const realTotalOf = (o: OrderWithCustomer): number =>
	o.total_original != null ? Number(o.total_original) : Number(o.total_amount ?? 0);

const groupByPack = (list: OrderWithCustomer[]): OrderRow[] => {
	const rows: OrderRow[] = [];
	const packIndex = new Map<string, number>();
	for (const o of list) {
		const pack = o.channel === 'ml' && o.ml_pack_id ? o.ml_pack_id : null;
		if (pack && packIndex.has(pack)) {
			const row = rows[packIndex.get(pack)!];
			row.ids.push(o.id);
			row.realTotal += realTotalOf(o);
			row.count += 1;
			continue;
		}
		if (pack) packIndex.set(pack, rows.length);
		rows.push({
			key: pack ? `pack-${pack}` : `order-${o.id}`,
			rep: o,
			ids: [o.id],
			realTotal: realTotalOf(o),
			currency: realCurrency(o),
			count: 1,
		});
	}
	return rows;
};

const StatusSelect = ({
	value,
	onChange,
}: {
	value: string;
	onChange: (status: string) => void;
}) => (
	<select
		value={value}
		onClick={e => e.stopPropagation()}
		onChange={e => onChange(e.target.value)}
		className={`cursor-pointer rounded-full border-0 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide outline-none focus:ring-2 focus:ring-brand-300 ${orderStatusBadge(
			value
		)}`}
	>
		{orderStatusOptions.map(option => (
			<option value={option} key={option} className='bg-white text-ink-800'>
				{option}
			</option>
		))}
	</select>
);

export const TableOrdersAdmin = ({ orders, onManualClick }: Props) => {
	const navigate = useNavigate();
	const { mutate } = useChangeStatusOrder();

	const handleStatusChange = (ids: number[], status: string) =>
		ids.forEach(id => mutate({ id, status }));

	const goTo = (id: number) => navigate(`/dashboard/ordenes/${id}`);
	// Las ventas manuales se gestionan en un modal dentro de la misma página.
	const goToRow = (row: OrderRow) =>
		row.rep.channel === 'manual'
			? onManualClick?.(row.rep.id)
			: goTo(row.rep.id);

	const realOrders = orders.filter(o => !isUnpaidMpCheckout(o));
	const unpaidCheckouts = orders.filter(isUnpaidMpCheckout);

	// Las ventas de ML "en carrito" (varios productos) llegan partidas en una orden
	// por producto, todas con el mismo ml_pack_id. Las unimos en UNA fila: total
	// sumado y los pedidos juntos, para tratarlas como una sola venta.
	const realRows = groupByPack(realOrders);

	if (!orders.length) {
		return (
			<div className='rounded-2xl border border-ink-200 bg-white p-12 text-center text-ink-400 shadow-soft'>
				Todavía no hay órdenes.
			</div>
		);
	}

	const customerName = (order: OrderWithCustomer) => {
		if (order.channel === 'manual')
			return (
				order.sale_concepts?.name ||
				order.manual_description ||
				'Venta manual'
			);
		return (
			order.customers?.full_name ||
			(order.channel === 'ml' ? 'Comprador de Mercado Libre' : 'Sin nombre')
		);
	};
	const rowSub = (row: OrderRow) => {
		const order = row.rep;
		if (order.channel === 'manual')
			return order.sale_concepts?.name ? order.manual_description ?? '' : '';
		if (order.customers?.email) return order.customers.email;
		if (order.channel === 'ml') {
			return row.count > 1
				? `Carrito ML · ${row.count} pedidos`
				: order.ml_order_id
				? `Orden ML ${order.ml_order_id}`
				: '';
		}
		return '';
	};

	return (
		<div className='space-y-8'>
			{/* ===== Órdenes reales ===== */}
			{realRows.length === 0 ? (
				<div className='rounded-2xl border border-ink-200 bg-white p-8 text-center text-ink-400 shadow-soft'>
					No hay órdenes reales todavía.
				</div>
			) : (
				<>
					{/* Tabla — desktop */}
					<div className='hidden overflow-hidden rounded-2xl border border-ink-200/70 bg-white shadow-soft md:block'>
						<table className='w-full text-sm'>
							<thead>
								<tr className='border-b border-ink-100 bg-ink-50 text-left text-xs font-semibold uppercase tracking-wider text-ink-500'>
									<th className='px-5 py-3.5'>Cliente</th>
									<th className='px-5 py-3.5'>Fecha</th>
									<th className='px-5 py-3.5'>Estado</th>
									<th className='px-5 py-3.5 text-right'>Total</th>
									<th className='w-10 px-5 py-3.5' />
								</tr>
							</thead>
							<tbody className='divide-y divide-ink-100'>
								{realRows.map(row => (
									<tr
										key={row.key}
										className='cursor-pointer transition-colors hover:bg-brand-50/40'
										onClick={() => goToRow(row)}
									>
										<td className='px-5 py-4'>
											<div className='flex flex-col'>
												<span className='flex items-center gap-2 font-semibold text-ink-800'>
													{customerName(row.rep)}
													{row.rep.channel === 'ml' && (
														<span className='inline-flex shrink-0 items-center rounded-full bg-yellow-400 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-stone-900'>
															ML
														</span>
													)}
													{row.rep.channel === 'manual' && (
														<span className='inline-flex shrink-0 items-center rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700'>
															Manual
														</span>
													)}
													{row.count > 1 && (
														<span className='inline-flex shrink-0 items-center rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-600'>
															{row.count} pedidos
														</span>
													)}
												</span>
												<span className='text-xs text-ink-500'>
													{rowSub(row)}
												</span>
											</div>
										</td>
										<td className='px-5 py-4 text-ink-600'>
											{formatDateLong(row.rep.created_at)}
										</td>
										<td className='px-5 py-4'>
											<StatusSelect
												value={row.rep.status}
												onChange={status =>
													handleStatusChange(row.ids, status)
												}
											/>
										</td>
										<td className='px-5 py-4 text-right font-semibold text-ink-900'>
											{formatMoneyCur(row.realTotal, row.currency)}
										</td>
										<td className='px-5 py-4 text-ink-300'>
											<HiChevronRight size={18} />
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>

					{/* Tarjetas — móvil */}
					<div className='space-y-3 md:hidden'>
						{realRows.map(row => (
							<div
								key={row.key}
								className='cursor-pointer rounded-2xl border border-ink-200/70 bg-white p-4 shadow-soft transition-all active:scale-[0.99]'
								onClick={() => goToRow(row)}
							>
								<div className='flex items-start justify-between gap-3'>
									<div className='min-w-0'>
										<p className='flex items-center gap-2 truncate font-semibold text-ink-800'>
											{customerName(row.rep)}
											{row.rep.channel === 'ml' && (
												<span className='inline-flex shrink-0 items-center rounded-full bg-yellow-400 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-stone-900'>
													ML
												</span>
											)}
											{row.rep.channel === 'manual' && (
												<span className='inline-flex shrink-0 items-center rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700'>
													Manual
												</span>
											)}
											{row.count > 1 && (
												<span className='inline-flex shrink-0 items-center rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-600'>
													{row.count} pedidos
												</span>
											)}
										</p>
										<p className='truncate text-xs text-ink-500'>
											{rowSub(row)}
										</p>
										<p className='mt-1 text-xs text-ink-400'>
											{formatDateLong(row.rep.created_at)}
										</p>
									</div>
									<span className='shrink-0 font-bold text-ink-900'>
										{formatMoneyCur(row.realTotal, row.currency)}
									</span>
								</div>
								<div className='mt-3' onClick={e => e.stopPropagation()}>
									<StatusSelect
										value={row.rep.status}
										onChange={status => handleStatusChange(row.ids, status)}
									/>
								</div>
							</div>
						))}
					</div>
				</>
			)}

			{/* ===== Checkouts sin pagar (NO son ventas) ===== */}
			{unpaidCheckouts.length > 0 && (
				<section className='rounded-2xl border border-dashed border-ink-300 bg-ink-50/50 p-4'>
					<div className='mb-3 flex items-start gap-2'>
						<HiOutlineShoppingCart size={20} className='mt-0.5 shrink-0 text-ink-400' />
						<div>
							<h2 className='text-sm font-bold text-ink-700'>
								Checkouts sin pagar ({unpaidCheckouts.length})
							</h2>
							<p className='text-xs text-ink-500'>
								Llegaron al pago de Mercado Pago pero <b>no lo completaron</b>. No son ventas — quedan solo como registro para seguimiento.
							</p>
						</div>
					</div>

					<div className='divide-y divide-ink-200/70 overflow-hidden rounded-xl border border-ink-200/70 bg-white/60'>
						{unpaidCheckouts.map(order => (
							<div
								key={order.id}
								className='flex cursor-pointer items-center justify-between gap-3 px-4 py-3 opacity-80 transition-colors hover:bg-white'
								onClick={() => goTo(order.id)}
							>
								<div className='min-w-0'>
									<p className='truncate text-sm font-medium text-ink-600'>
										{customerName(order)}
									</p>
									<p className='truncate text-xs text-ink-400'>
										{order.customers?.email
											? `${order.customers.email} · `
											: ''}
										{formatDateLong(order.created_at)}
									</p>
								</div>
								<div className='flex shrink-0 items-center gap-3'>
									<span
										className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${
											didNotPay(order)
												? 'bg-ink-100 text-ink-500 ring-1 ring-ink-200'
												: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
										}`}
									>
										{didNotPay(order) ? 'No pagó' : 'Esperando pago'}
									</span>
									<span className='text-sm font-medium text-ink-400 line-through'>
										{formatPrice(order.total_amount)}
									</span>
									<HiChevronRight size={16} className='text-ink-300' />
								</div>
							</div>
						))}
					</div>
				</section>
			)}
		</div>
	);
};
