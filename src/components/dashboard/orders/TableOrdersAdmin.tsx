import { useNavigate } from 'react-router-dom';
import { HiChevronRight } from 'react-icons/hi2';
import {
	formatDateLong,
	formatPrice,
	orderStatusBadge,
	orderStatusOptions,
} from '../../../helpers';
import { OrderWithCustomer } from '../../../interfaces';
import { useChangeStatusOrder } from '../../../hooks';

interface Props {
	orders: OrderWithCustomer[];
}

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

export const TableOrdersAdmin = ({ orders }: Props) => {
	const navigate = useNavigate();
	const { mutate } = useChangeStatusOrder();

	const handleStatusChange = (id: number, status: string) =>
		mutate({ id, status });

	const goTo = (id: number) => navigate(`/dashboard/ordenes/${id}`);

	if (!orders.length) {
		return (
			<div className='rounded-2xl border border-ink-200 bg-white p-12 text-center text-ink-400 shadow-soft'>
				Todavía no hay órdenes.
			</div>
		);
	}

	return (
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
						{orders.map(order => (
							<tr
								key={order.id}
								className='cursor-pointer transition-colors hover:bg-brand-50/40'
								onClick={() => goTo(order.id)}
							>
								<td className='px-5 py-4'>
									<div className='flex flex-col'>
										<span className='flex items-center gap-2 font-semibold text-ink-800'>
											{order.customers?.full_name ||
												(order.channel === 'ml'
													? 'Comprador de Mercado Libre'
													: 'Sin nombre')}
											{order.channel === 'ml' && (
												<span className='inline-flex shrink-0 items-center rounded-full bg-yellow-400 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-stone-900'>
													ML
												</span>
											)}
										</span>
										<span className='text-xs text-ink-500'>
											{order.customers?.email ||
												(order.channel === 'ml' && order.ml_order_id
													? `Orden ML ${order.ml_order_id}`
													: '')}
										</span>
									</div>
								</td>
								<td className='px-5 py-4 text-ink-600'>
									{formatDateLong(order.created_at)}
								</td>
								<td className='px-5 py-4'>
									<StatusSelect
										value={order.status}
										onChange={status =>
											handleStatusChange(order.id, status)
										}
									/>
								</td>
								<td className='px-5 py-4 text-right font-semibold text-ink-900'>
									{formatPrice(order.total_amount)}
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
				{orders.map(order => (
					<div
						key={order.id}
						className='cursor-pointer rounded-2xl border border-ink-200/70 bg-white p-4 shadow-soft transition-all active:scale-[0.99]'
						onClick={() => goTo(order.id)}
					>
						<div className='flex items-start justify-between gap-3'>
							<div className='min-w-0'>
								<p className='flex items-center gap-2 truncate font-semibold text-ink-800'>
									{order.customers?.full_name ||
										(order.channel === 'ml'
											? 'Comprador de Mercado Libre'
											: 'Sin nombre')}
									{order.channel === 'ml' && (
										<span className='inline-flex shrink-0 items-center rounded-full bg-yellow-400 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-stone-900'>
											ML
										</span>
									)}
								</p>
								<p className='truncate text-xs text-ink-500'>
									{order.customers?.email ||
										(order.channel === 'ml' && order.ml_order_id
											? `Orden ML ${order.ml_order_id}`
											: '')}
								</p>
								<p className='mt-1 text-xs text-ink-400'>
									{formatDateLong(order.created_at)}
								</p>
							</div>
							<span className='shrink-0 font-bold text-ink-900'>
								{formatPrice(order.total_amount)}
							</span>
						</div>
						<div className='mt-3' onClick={e => e.stopPropagation()}>
							<StatusSelect
								value={order.status}
								onChange={status => handleStatusChange(order.id, status)}
							/>
						</div>
					</div>
				))}
			</div>
		</>
	);
};
