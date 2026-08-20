import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { HiChevronRight, HiOutlineShoppingCart } from 'react-icons/hi2';
import { confirmManualPayment } from '../../../actions';
import {
	formatDateLong,
	formatTimeShort,
	formatPrice,
	formatMoneyCur,
	orderStatusBadge,
	orderStatusLabel,
	orderStatusOptions,
	isUnpaidMpCheckout,
	isTrulyAbandoned,
} from '../../../helpers';
import { OrderWithCustomer } from '../../../interfaces';
import { useChangeStatusOrder } from '../../../hooks';
import { Pagination } from '../../shared/Pagination';

// Órdenes por página en el panel admin.
const ORDERS_PER_PAGE = 20;

interface Props {
	orders: OrderWithCustomer[];
	// Click en una venta manual: la gestiona el contenedor (abre el modal).
	onManualClick?: (orderId: number) => void;
}

const didNotPay = (o: OrderWithCustomer): boolean =>
	['expirado', 'Cancelado', 'cancelado', 'rechazado'].includes(o.status);

/**
 * Pago que espera la confirmación del admin: transferencia, depósito, y también
 * el combinado (donde lo que confirma es la PARTE que vino por transferencia).
 */
export const needsPaymentConfirm = (o: OrderWithCustomer): boolean =>
	(o.payment_method === 'transfer' ||
		o.payment_method === 'deposit' ||
		o.payment_method === 'hybrid') &&
	o.payment_status !== 'paid' &&
	!didNotPay(o);

// Una fila del listado. Para una venta normal representa una orden; para una venta
// ML en carrito (pack) agrupa todas las órdenes del pack en una sola.
interface OrderRow {
	key: string;
	rep: OrderWithCustomer; // orden representativa (la más reciente del pack)
	ids: number[]; // todas las órdenes que agrupa (1 si no es pack)
	realTotal: number; // total en la MONEDA REAL de la venta (pesos ML, USD web)
	currency: 'UYU' | 'USD';
	altTotal: number | null; // el mismo total en la otra moneda (null si no aplica)
	altCurrency: 'UYU' | 'USD';
	count: number; // cantidad de pedidos del pack
}

// Moneda y monto REAL de la venta: pesos para ML/UYU (total_original), dólares para web.
const realCurrency = (o: OrderWithCustomer): 'UYU' | 'USD' =>
	o.ml_currency === 'UYU' ? 'UYU' : 'USD';
// OJO: total_original NO es siempre la moneda real de la venta. En las órdenes web
// guarda el monto en PESOS que cobró MercadoPago (total_amount × fx_rate), y ahí
// ml_currency viene null. Tomarlo sin mirar la moneda mostraba el número en pesos
// con la etiqueta USD: una venta web de USD 307 figuraba como "USD 12.618,00".
// Mismo criterio que manualSales.ts y que la ficha de la orden.
const realTotalOf = (o: OrderWithCustomer): number =>
	realCurrency(o) === 'UYU' && o.total_original != null
		? Number(o.total_original)
		: Number(o.total_amount ?? 0);

// La contracara del total: lo mismo expresado en la OTRA moneda. En la web el
// cliente compra en dólares y MercadoPago cobra en pesos; en ML la venta es en
// pesos y el número interno de RF es en dólares. Mostrar las dos saca la duda de
// "¿esto son pesos o dólares?" y sirve para conciliar contra lo que deposita la
// pasarela. Devuelve null cuando no hay conversión (venta manual en USD, o sin
// cotización guardada), para no repetir el mismo número dos veces.
const altCurrencyOf = (o: OrderWithCustomer): 'UYU' | 'USD' =>
	realCurrency(o) === 'UYU' ? 'USD' : 'UYU';
const altTotalOf = (o: OrderWithCustomer): number | null => {
	const usd = Number(o.total_amount ?? 0);
	const original = o.total_original != null ? Number(o.total_original) : null;
	if (original == null || Math.abs(original - usd) < 0.01) return null;
	return realCurrency(o) === 'UYU' ? usd : original;
};

const groupByPack = (list: OrderWithCustomer[]): OrderRow[] => {
	const rows: OrderRow[] = [];
	const packIndex = new Map<string, number>();
	for (const o of list) {
		const pack = o.channel === 'ml' && o.ml_pack_id ? o.ml_pack_id : null;
		if (pack && packIndex.has(pack)) {
			const row = rows[packIndex.get(pack)!];
			row.ids.push(o.id);
			row.realTotal += realTotalOf(o);
			// El equivalente en la otra moneda sólo se suma si TODOS los pedidos del
			// pack lo tienen: una suma parcial sería peor que no mostrar nada.
			const alt = altTotalOf(o);
			row.altTotal =
				row.altTotal != null && alt != null ? row.altTotal + alt : null;
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
			altTotal: altTotalOf(o),
			altCurrency: altCurrencyOf(o),
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
}) => {
	// El estado puede venir del SISTEMA ('pagado', 'expirado', 'rechazado') y no
	// estar entre los que el admin elige a mano. Un <select> cuyo value no matchea
	// ninguna option renderiza la PRIMERA: todas las órdenes pagadas (web y ML) se
	// veían como "Cotización". Metemos el estado actual al principio de la lista.
	const options = orderStatusOptions.includes(value)
		? orderStatusOptions
		: [value, ...orderStatusOptions];
	return (
		<select
			value={value}
			onClick={e => e.stopPropagation()}
			onChange={e => onChange(e.target.value)}
			className={`cursor-pointer rounded-full border-0 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide outline-none focus:ring-2 focus:ring-brand-300 ${orderStatusBadge(
				value
			)}`}
		>
			{options.map(option => (
				<option value={option} key={option} className='bg-white text-ink-800'>
					{orderStatusLabel(option)}
				</option>
			))}
		</select>
	);
};

export const TableOrdersAdmin = ({ orders, onManualClick }: Props) => {
	const navigate = useNavigate();
	const { mutate } = useChangeStatusOrder();
	const queryClient = useQueryClient();

	// Confirmar el cobro de un pago manual (la edge marca pagado + Concretado y
	// dispara el mail). En un pack ML no aplica, pero lo dejamos por id igual.
	const { mutate: confirmPayment } = useMutation({
		mutationFn: async (ids: number[]) => {
			for (const id of ids) await confirmManualPayment(id, 'approve');
		},
		onSuccess: () => {
			toast.success('Pago confirmado — se le avisó al cliente');
			queryClient.invalidateQueries({ queryKey: ['orders', 'admin'] });
			queryClient.invalidateQueries({ queryKey: ['order', 'admin'] });
			queryClient.invalidateQueries({ queryKey: ['pending_payments'] });
			queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });
		},
		onError: (e: Error) => toast.error(e.message),
	});

	// Poner "Concretado" a mano en una orden de transferencia/depósito dejaba el
	// pago en "pendiente": la orden decía una cosa y el pago otra. Ahora concretar
	// una de esas órdenes ES confirmar el cobro (marca pagado + mail al cliente).
	const handleStatusChange = (row: OrderRow, status: string) => {
		const o = row.rep;
		if (status === 'Concretado' && needsPaymentConfirm(o)) {
			// En el pago combinado lo que se confirma es SÓLO la transferencia. Si
			// la parte de MercadoPago todavía no entró, el pedido sigue Pendiente:
			// hay que decirlo antes para que el admin no crea que lo está cerrando.
			const esHibrido = o.payment_method === 'hybrid';
			const mensaje = esHibrido
				? `El pedido #${o.id} es de PAGO COMBINADO.\n\nAl confirmar se registra sólo la parte que vino por TRANSFERENCIA. Si la de MercadoPago todavía no se acreditó, el pedido queda en Pendiente y no se despacha.\n\n¿Ya recibiste la transferencia?`
				: `El pedido #${o.id} se pagó por ${
						o.payment_method === 'deposit' ? 'depósito' : 'transferencia'
				  } y el pago figura PENDIENTE.\n\nAl concretarlo queda como pagado y se le manda el mail de confirmación al cliente. ¿Ya recibiste la plata?`;
			if (!window.confirm(mensaje)) return; // La orden sigue como estaba.
			confirmPayment(row.ids);
			return;
		}
		row.ids.forEach(id => mutate({ id, status }));
	};

	const goTo = (id: number) => navigate(`/dashboard/ordenes/${id}`);
	// Las ventas manuales se gestionan en un modal dentro de la misma página.
	const goToRow = (row: OrderRow) =>
		row.rep.channel === 'manual'
			? onManualClick?.(row.rep.id)
			: goTo(row.rep.id);

	const realOrders = orders.filter(o => !isUnpaidMpCheckout(o));
	// "Carritos abandonados" REALES: checkouts sin pagar que NO son un reintento
	// de una compra que el mismo cliente sí completó después. Los reintentos (la
	// venta real ya figura como orden pagada) se ocultan para no confundir.
	const unpaidCheckouts = orders.filter(o => isTrulyAbandoned(o, orders));

	// Las ventas de ML "en carrito" (varios productos) llegan partidas en una orden
	// por producto, todas con el mismo ml_pack_id. Las unimos en UNA fila: total
	// sumado y los pedidos juntos, para tratarlas como una sola venta.
	const realRows = groupByPack(realOrders);

	// Paginación de las órdenes reales (client-side: ya vienen todas cargadas).
	const [page, setPage] = useState(1);
	const totalPages = Math.max(1, Math.ceil(realRows.length / ORDERS_PER_PAGE));
	// Si cambia el set de órdenes (p.ej. un filtro), volvemos a la primera página.
	useEffect(() => {
		setPage(1);
	}, [realRows.length]);
	const safePage = Math.min(page, totalPages);
	const pagedRows = realRows.slice(
		(safePage - 1) * ORDERS_PER_PAGE,
		safePage * ORDERS_PER_PAGE
	);

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
								{pagedRows.map(row => (
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
											<span className='block'>
												{formatDateLong(row.rep.created_at)}
											</span>
											<span className='block text-xs tabular-nums text-ink-400'>
												{formatTimeShort(row.rep.created_at)}
											</span>
										</td>
										<td className='px-5 py-4'>
											<StatusSelect
												value={row.rep.status}
												onChange={status =>
													handleStatusChange(row, status)
												}
											/>
											{needsPaymentConfirm(row.rep) && (
												<span className='mt-1.5 block text-[11px] font-semibold text-amber-700'>
													⚠ Pago sin confirmar
												</span>
											)}
										</td>
										<td className='px-5 py-4 text-right'>
											<span className='block font-semibold tabular-nums text-ink-900'>
												{formatMoneyCur(row.realTotal, row.currency)}
											</span>
											{row.altTotal != null && (
												<span className='block text-[11px] tabular-nums text-ink-400'>
													≈ {formatMoneyCur(row.altTotal, row.altCurrency)}
												</span>
											)}
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
						{pagedRows.map(row => (
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
											{formatDateLong(row.rep.created_at)} ·{' '}
											<span className='tabular-nums'>
												{formatTimeShort(row.rep.created_at)}
											</span>
										</p>
									</div>
									<span className='shrink-0 text-right'>
										<span className='block font-bold tabular-nums text-ink-900'>
											{formatMoneyCur(row.realTotal, row.currency)}
										</span>
										{row.altTotal != null && (
											<span className='block text-[11px] tabular-nums text-ink-400'>
												≈ {formatMoneyCur(row.altTotal, row.altCurrency)}
											</span>
										)}
									</span>
								</div>
								<div className='mt-3' onClick={e => e.stopPropagation()}>
									<StatusSelect
										value={row.rep.status}
										onChange={status => handleStatusChange(row, status)}
									/>
									{needsPaymentConfirm(row.rep) && (
										<span className='mt-1.5 block text-[11px] font-semibold text-amber-700'>
											⚠ Pago sin confirmar
										</span>
									)}
								</div>
							</div>
						))}
					</div>
				</>
			)}

			{/* Paginación de órdenes reales */}
			{realRows.length > ORDERS_PER_PAGE && (
				<Pagination
					totalItems={realRows.length}
					page={safePage}
					setPage={setPage}
					itemsPerPage={ORDERS_PER_PAGE}
					noun='órdenes'
				/>
			)}

			{/* ===== Carritos abandonados (NO son ventas) ===== */}
			{unpaidCheckouts.length > 0 && (
				<section className='rounded-2xl border border-dashed border-ink-300 bg-ink-50/50 p-4'>
					<div className='mb-3 flex items-start gap-2'>
						<HiOutlineShoppingCart size={20} className='mt-0.5 shrink-0 text-ink-400' />
						<div>
							<h2 className='text-sm font-bold text-ink-700'>
								Carritos abandonados ({unpaidCheckouts.length})
							</h2>
							<p className='text-xs text-ink-500'>
								Llegaron al pago de Mercado Pago pero <b>no lo completaron</b> y no compraron después. No son ventas — quedan solo como registro para seguimiento.
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
