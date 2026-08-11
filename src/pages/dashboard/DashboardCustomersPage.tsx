import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { FaWhatsapp } from 'react-icons/fa';
import {
	HiOutlineArrowDownTray,
	HiOutlineChevronLeft,
	HiOutlineChevronRight,
	HiOutlineEnvelope,
	HiOutlineMagnifyingGlass,
	HiOutlineUserGroup,
	HiOutlineXMark,
} from 'react-icons/hi2';
import {
	getCheckoutActivity,
	getCustomersOverview,
	getCustomerTimeline,
	type CheckoutActivityRow,
	type CustomerOverview,
} from '../../actions/customers';
import { formatMoney, normalizeSearch } from '../../helpers';
import { Loader } from '../../components/shared/Loader';

const PAGE_SIZE = 20;

const formatDate = (iso: string | null) =>
	iso ? new Date(iso).toLocaleDateString('es-UY') : '—';

const formatDateTime = (iso: string) =>
	new Date(iso).toLocaleString('es-UY', {
		day: '2-digit',
		month: '2-digit',
		year: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
	});

// Link de WhatsApp con el prefijo de Uruguay si el número viene sin él.
const waLink = (phone: string | null, name: string | null) => {
	const digits = (phone ?? '').replace(/\D/g, '');
	if (digits.length < 8) return null;
	const full = digits.startsWith('598') ? digits : `598${digits.replace(/^0+/, '')}`;
	return `https://wa.me/${full}?text=${encodeURIComponent(
		`Hola ${name?.split(' ')[0] ?? ''}, te escribo de RF Store.`
	)}`;
};

type SortKey = 'total' | 'orders' | 'last' | 'abandoned';
type CustomerFilter = 'todos' | 'compradores' | 'abandonaron' | 'sin_comprar';
type CheckoutFilter = 'todos' | 'sin_concretar' | 'compraron';

export const DashboardCustomersPage = () => {
	const [tab, setTab] = useState<'clientes' | 'checkout'>('clientes');
	const [search, setSearch] = useState('');
	const [sortBy, setSortBy] = useState<SortKey>('total');
	const [filter, setFilter] = useState<CustomerFilter>('todos');
	const [page, setPage] = useState(1);
	const [selected, setSelected] = useState<CustomerOverview | null>(null);

	const [checkoutFilter, setCheckoutFilter] = useState<CheckoutFilter>('sin_concretar');
	const [checkoutPage, setCheckoutPage] = useState(1);
	const [openRow, setOpenRow] = useState<string | null>(null);

	const { data: customers = [], isLoading } = useQuery({
		queryKey: ['customers_overview'],
		queryFn: getCustomersOverview,
		refetchInterval: 60_000, // "en vivo" mientras el panel está abierto
	});

	const { data: activity = [] } = useQuery({
		queryKey: ['checkout_activity'],
		queryFn: getCheckoutActivity,
		refetchInterval: 60_000,
	});

	const { data: timeline = [], isLoading: loadingTimeline } = useQuery({
		queryKey: ['customer_timeline', selected?.customer_id],
		queryFn: () => getCustomerTimeline(selected!.customer_id),
		enabled: !!selected,
	});

	/* ------------------------------- clientes ------------------------------ */
	const filtered = useMemo(() => {
		const q = normalizeSearch(search);
		let rows = customers.slice();

		if (filter === 'compradores') rows = rows.filter(c => c.orders_paid > 0);
		else if (filter === 'abandonaron') rows = rows.filter(c => c.abandoned_count > 0);
		else if (filter === 'sin_comprar') rows = rows.filter(c => c.orders_paid === 0);

		if (q) {
			rows = rows.filter(c =>
				normalizeSearch(
					`${c.full_name ?? ''} ${c.email ?? ''} ${c.phone ?? ''}`
				).includes(q)
			);
		}

		rows.sort((a, b) => {
			if (sortBy === 'orders') return b.orders_paid - a.orders_paid;
			if (sortBy === 'abandoned') return b.abandoned_count - a.abandoned_count;
			if (sortBy === 'last') {
				return (
					new Date(b.last_purchase_at ?? 0).getTime() -
					new Date(a.last_purchase_at ?? 0).getTime()
				);
			}
			return b.total_spent_usd - a.total_spent_usd;
		});
		return rows;
	}, [customers, search, sortBy, filter]);

	// Volver a la página 1 cuando cambia lo que se está mirando.
	useEffect(() => setPage(1), [search, sortBy, filter]);
	useEffect(() => setCheckoutPage(1), [checkoutFilter]);

	const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
	const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

	/* ------------------------------- checkout ------------------------------ */
	const checkoutRows = useMemo(() => {
		if (checkoutFilter === 'sin_concretar') return activity.filter(a => !a.converted);
		if (checkoutFilter === 'compraron') return activity.filter(a => a.converted);
		return activity;
	}, [activity, checkoutFilter]);

	const checkoutPageRows = checkoutRows.slice(
		(checkoutPage - 1) * PAGE_SIZE,
		checkoutPage * PAGE_SIZE
	);
	const checkoutTotalPages = Math.max(1, Math.ceil(checkoutRows.length / PAGE_SIZE));

	const totals = useMemo(() => {
		const sinConcretar = activity.filter(a => !a.converted);
		return {
			clientes: customers.length,
			compradores: customers.filter(c => c.orders_paid > 0).length,
			facturado: customers.reduce((acc, c) => acc + c.total_spent_usd, 0),
			llegaronCheckout: activity.length,
			sinConcretar: sinConcretar.length,
			plataEnJuego: sinConcretar.reduce((acc, a) => acc + a.total_usd, 0),
		};
	}, [customers, activity]);

	const exportCsv = () => {
		const head = [
			'nombre', 'email', 'telefono', 'compras', 'gastado_usd', 'ticket_promedio_usd',
			'primera_compra', 'ultima_compra', 'abandonos', 'valor_abandonado_usd',
			'cupones', 'canales', 'zona',
		];
		const rows = filtered.map(c => [
			c.full_name ?? '', c.email ?? '', c.phone ?? '', c.orders_paid,
			c.total_spent_usd.toFixed(2), c.avg_ticket_usd.toFixed(2),
			formatDate(c.first_purchase_at), formatDate(c.last_purchase_at),
			c.abandoned_count, c.abandoned_value_usd.toFixed(2),
			c.coupons_used, c.channels, c.last_zone ?? '',
		]);
		const csv = [head, ...rows]
			.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
			.join('\n');
		const url = URL.createObjectURL(
			new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
		);
		const a = document.createElement('a');
		a.href = url;
		a.download = `clientes-rfstore-${new Date().toISOString().slice(0, 10)}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	};

	if (isLoading) return <Loader />;

	return (
		<div className='space-y-6'>
			<div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
				<div>
					<h1 className='flex items-center gap-2 text-2xl font-bold text-ink-900'>
						<HiOutlineUserGroup size={26} className='text-brand-600' />
						Clientes
					</h1>
					<p className='text-sm text-ink-500'>
						Quién compró, cuánto, qué se llevó y quién quedó a mitad de camino.
					</p>
				</div>
				<button
					onClick={exportCsv}
					className='inline-flex items-center gap-2 self-start rounded-full border border-ink-200 bg-white px-4 py-2 text-sm font-semibold text-ink-700 hover:bg-ink-50'
				>
					<HiOutlineArrowDownTray size={18} />
					Exportar CSV
				</button>
			</div>

			<div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
				<Stat label='Clientes registrados' value={String(totals.clientes)} />
				<Stat label='Compraron alguna vez' value={String(totals.compradores)} />
				<Stat label='Facturado (USD)' value={formatMoney(totals.facturado)} />
				<Stat
					label='Checkouts sin concretar'
					value={String(totals.sinConcretar)}
					hint={`${formatMoney(totals.plataEnJuego)} en juego`}
					tone='amber'
				/>
			</div>

			<div className='flex gap-1 border-b border-ink-200'>
				<button
					onClick={() => setTab('clientes')}
					className={tabCls(tab === 'clientes')}
				>
					Clientes ({customers.length})
				</button>
				<button
					onClick={() => setTab('checkout')}
					className={tabCls(tab === 'checkout')}
				>
					Llegaron al checkout ({totals.llegaronCheckout})
				</button>
			</div>

			{tab === 'clientes' ? (
				<>
					<div className='flex flex-col gap-3 lg:flex-row'>
						<div className='relative flex-1'>
							<HiOutlineMagnifyingGlass
								className='absolute left-3 top-1/2 -translate-y-1/2 text-ink-400'
								size={18}
							/>
							<input
								value={search}
								onChange={e => setSearch(e.target.value)}
								placeholder='Buscar por nombre, mail o teléfono…'
								className='w-full rounded-lg border border-ink-200 py-2 pl-10 pr-3 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20'
							/>
						</div>
						<select
							value={filter}
							onChange={e => setFilter(e.target.value as CustomerFilter)}
							className='rounded-lg border border-ink-200 px-3 py-2 text-sm'
						>
							<option value='todos'>Todos</option>
							<option value='compradores'>Sólo los que compraron</option>
							<option value='abandonaron'>Sólo con carritos abandonados</option>
							<option value='sin_comprar'>Nunca compraron</option>
						</select>
						<select
							value={sortBy}
							onChange={e => setSortBy(e.target.value as SortKey)}
							className='rounded-lg border border-ink-200 px-3 py-2 text-sm'
						>
							<option value='total'>Ordenar por: más gastó</option>
							<option value='orders'>Más compras</option>
							<option value='last'>Compra más reciente</option>
							<option value='abandoned'>Más abandonos</option>
						</select>
					</div>

					<div className='overflow-x-auto rounded-2xl border border-ink-200 bg-white'>
						<table className='min-w-full text-sm'>
							<thead className='bg-ink-50 text-left text-xs uppercase tracking-wider text-ink-500'>
								<tr>
									<th className='p-3'>Cliente</th>
									<th className='p-3'>Contacto</th>
									<th className='p-3 text-right'>Compras</th>
									<th className='p-3 text-right'>Gastado</th>
									<th className='p-3 text-right'>Ticket prom.</th>
									<th className='p-3'>Última compra</th>
									<th className='p-3 text-right'>Abandonos</th>
									<th className='p-3'></th>
								</tr>
							</thead>
							<tbody>
								{pageRows.map(c => {
									const wa = waLink(c.phone, c.full_name);
									return (
										<tr
											key={c.customer_id}
											className='border-t border-ink-100 hover:bg-brand-50/40'
										>
											<td className='p-3'>
												<p className='font-semibold text-ink-900'>
													{c.full_name || 'Sin nombre'}
												</p>
												<p className='text-xs text-ink-400'>
													Alta {formatDate(c.registered_at)}
													{c.channels ? ` · ${c.channels}` : ''}
												</p>
											</td>
											<td className='p-3'>
												<p className='text-xs text-ink-600'>{c.email || '—'}</p>
												<p className='text-xs text-ink-400'>{c.phone || '—'}</p>
											</td>
											<td className='p-3 text-right font-semibold'>
												{c.orders_paid}
											</td>
											<td className='p-3 text-right font-semibold text-emerald-700'>
												{formatMoney(c.total_spent_usd)}
											</td>
											<td className='p-3 text-right text-ink-600'>
												{c.orders_paid > 0 ? formatMoney(c.avg_ticket_usd) : '—'}
											</td>
											<td className='p-3 text-ink-600'>
												{formatDate(c.last_purchase_at)}
											</td>
											<td className='p-3 text-right'>
												{c.abandoned_count > 0 ? (
													<span
														className='rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-700'
														title={`${formatMoney(
															c.abandoned_value_usd
														)} sin concretar`}
													>
														{c.abandoned_count}
													</span>
												) : (
													<span className='text-ink-300'>0</span>
												)}
											</td>
											<td className='p-3'>
												<div className='flex items-center justify-end gap-2'>
													{wa && (
														<a
															href={wa}
															target='_blank'
															rel='noopener noreferrer'
															title='Escribir por WhatsApp'
															className='text-[#25D366] hover:opacity-70'
														>
															<FaWhatsapp size={18} />
														</a>
													)}
													{c.email && (
														<a
															href={`mailto:${c.email}`}
															title='Escribir por mail'
															className='text-ink-400 hover:text-ink-700'
														>
															<HiOutlineEnvelope size={18} />
														</a>
													)}
													<button
														onClick={() => setSelected(c)}
														className='rounded-md border border-ink-200 px-2 py-1 text-xs font-semibold text-ink-700 hover:bg-ink-50'
													>
														Ver ficha
													</button>
												</div>
											</td>
										</tr>
									);
								})}
								{pageRows.length === 0 && (
									<tr>
										<td colSpan={8} className='p-6 text-center text-ink-400'>
											No hay clientes que coincidan con el filtro.
										</td>
									</tr>
								)}
							</tbody>
						</table>
					</div>

					<Pager
						page={page}
						totalPages={totalPages}
						total={filtered.length}
						noun='clientes'
						onChange={setPage}
					/>
				</>
			) : (
				<>
					<div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
						<p className='max-w-2xl text-sm text-ink-500'>
							Todo el que llegó al checkout: los que apretaron pagar (aunque no
							hayan pagado) y los que abrieron el checkout y ni llegaron a
							generar el pedido. Tocá una fila para ver el detalle.
						</p>
						<select
							value={checkoutFilter}
							onChange={e => setCheckoutFilter(e.target.value as CheckoutFilter)}
							className='shrink-0 rounded-lg border border-ink-200 px-3 py-2 text-sm'
						>
							<option value='sin_concretar'>Sin concretar</option>
							<option value='compraron'>Terminaron comprando</option>
							<option value='todos'>Todos</option>
						</select>
					</div>

					<div className='overflow-x-auto rounded-2xl border border-ink-200 bg-white'>
						<table className='min-w-full text-sm'>
							<thead className='bg-ink-50 text-left text-xs uppercase tracking-wider text-ink-500'>
								<tr>
									<th className='p-3'>Cuándo</th>
									<th className='p-3'>Quién</th>
									<th className='p-3'>Qué tenía en el carrito</th>
									<th className='p-3 text-right'>Monto</th>
									<th className='p-3'>Estado</th>
									<th className='p-3'></th>
								</tr>
							</thead>
							<tbody>
								{checkoutPageRows.map(row => (
									<CheckoutRow
										key={`${row.source}-${row.ref_id}`}
										row={row}
										open={openRow === `${row.source}-${row.ref_id}`}
										onToggle={() =>
											setOpenRow(prev =>
												prev === `${row.source}-${row.ref_id}`
													? null
													: `${row.source}-${row.ref_id}`
											)
										}
									/>
								))}
								{checkoutPageRows.length === 0 && (
									<tr>
										<td colSpan={6} className='p-6 text-center text-ink-400'>
											No hay checkouts con ese filtro.
										</td>
									</tr>
								)}
							</tbody>
						</table>
					</div>

					<Pager
						page={checkoutPage}
						totalPages={checkoutTotalPages}
						total={checkoutRows.length}
						noun='checkouts'
						onChange={setCheckoutPage}
					/>
				</>
			)}

			{/* Ficha del cliente */}
			{selected && (
				<div
					className='fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6'
					onClick={() => setSelected(null)}
				>
					<div
						className='max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl'
						onClick={e => e.stopPropagation()}
					>
						<div className='mb-4 flex items-start justify-between gap-3'>
							<div>
								<h2 className='text-xl font-bold text-ink-900'>
									{selected.full_name || 'Sin nombre'}
								</h2>
								<p className='text-sm text-ink-500'>
									{selected.email} {selected.phone ? `· ${selected.phone}` : ''}
								</p>
							</div>
							<button
								onClick={() => setSelected(null)}
								className='rounded-full p-1 text-ink-400 hover:bg-ink-100'
								aria-label='Cerrar'
							>
								<HiOutlineXMark size={22} />
							</button>
						</div>

						<div className='mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4'>
							<Stat label='Compras' value={String(selected.orders_paid)} />
							<Stat label='Gastado' value={formatMoney(selected.total_spent_usd)} />
							<Stat
								label='Ticket promedio'
								value={
									selected.orders_paid > 0
										? formatMoney(selected.avg_ticket_usd)
										: '—'
								}
							/>
							<Stat
								label='Abandonos'
								value={String(selected.abandoned_count)}
								tone='amber'
							/>
						</div>

						<h3 className='mb-2 text-xs font-bold uppercase tracking-wider text-ink-500'>
							Historial
						</h3>
						{loadingTimeline ? (
							<p className='text-sm text-ink-400'>Cargando…</p>
						) : (
							<ul className='space-y-2'>
								{timeline.map(o => (
									<li
										key={o.order_id}
										className={`rounded-xl border p-3 ${
											o.is_abandoned
												? 'border-amber-200 bg-amber-50/50'
												: 'border-ink-200'
										}`}
									>
										<div className='flex flex-wrap items-center justify-between gap-2'>
											<Link
												to={`/dashboard/ordenes/${o.order_id}`}
												className='font-semibold text-brand-700 hover:underline'
											>
												Pedido #{o.order_id}
											</Link>
											<span className='text-xs text-ink-500'>
												{formatDateTime(o.created_at)} · {o.channel}
											</span>
										</div>
										<p className='mt-1 text-sm text-ink-700'>{o.items || '—'}</p>
										<div className='mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-500'>
											<span className='font-semibold text-ink-800'>
												{formatMoney(o.total_amount)}
											</span>
											<span>· {o.status}</span>
											{o.shipping_zone && <span>· {o.shipping_zone}</span>}
											{o.coupon_code && <span>· cupón {o.coupon_code}</span>}
											{o.is_abandoned && (
												<span className='rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-800'>
													Casi compra
												</span>
											)}
										</div>
									</li>
								))}
								{timeline.length === 0 && (
									<li className='text-sm text-ink-400'>
										Todavía no tiene pedidos.
									</li>
								)}
							</ul>
						)}
					</div>
				</div>
			)}
		</div>
	);
};

/* ------------------------------ auxiliares ------------------------------ */

const tabCls = (active: boolean) =>
	`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
		active
			? 'border-brand-600 text-brand-700'
			: 'border-transparent text-ink-500 hover:text-ink-800'
	}`;

const CheckoutRow = ({
	row,
	open,
	onToggle,
}: {
	row: CheckoutActivityRow;
	open: boolean;
	onToggle: () => void;
}) => {
	const wa = waLink(row.phone, row.full_name);
	return (
		<>
			<tr
				className='cursor-pointer border-t border-ink-100 hover:bg-brand-50/40'
				onClick={onToggle}
			>
				<td className='p-3 text-ink-600'>{formatDateTime(row.happened_at)}</td>
				<td className='p-3'>
					<p className='font-medium text-ink-900'>{row.full_name || 'Sin nombre'}</p>
					<p className='text-xs text-ink-400'>
						{row.email || '—'}
						{row.phone ? ` · ${row.phone}` : ''}
					</p>
				</td>
				<td className='max-w-md p-3 text-xs text-ink-600'>
					<span className='line-clamp-2'>
						{row.items || `${row.items_count} ítem(s)`}
					</span>
				</td>
				<td className='p-3 text-right font-semibold'>{formatMoney(row.total_usd)}</td>
				<td className='p-3'>
					{row.converted ? (
						<span className='rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700'>
							Compró{row.order_id ? ` (#${row.order_id})` : ''}
						</span>
					) : (
						<span className='rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-700'>
							{row.source === 'lead' ? 'No llegó a pagar' : 'Sin concretar'}
						</span>
					)}
				</td>
				<td className='p-3 text-right text-xs font-semibold text-brand-700'>
					{open ? 'Ocultar' : 'Detalle'}
				</td>
			</tr>
			{open && (
				<tr className='border-t border-ink-100 bg-ink-50/60'>
					<td colSpan={6} className='p-4'>
						<div className='grid gap-4 sm:grid-cols-3'>
							<div>
								<p className='text-[11px] font-bold uppercase tracking-wider text-ink-500'>
									Carrito
								</p>
								<p className='mt-1 text-sm text-ink-700'>
									{row.items || `${row.items_count} ítem(s)`}
								</p>
							</div>
							<div>
								<p className='text-[11px] font-bold uppercase tracking-wider text-ink-500'>
									Envío
								</p>
								<p className='mt-1 text-sm text-ink-700'>
									{row.shipping_zone
										? `${row.shipping_zone}${
												row.shipping_department
													? ` — ${row.shipping_department}`
													: ''
										  }`
										: 'No lo llegó a elegir'}
								</p>
								{row.payment_method && (
									<p className='text-xs text-ink-500'>
										Método: {row.payment_method}
										{row.order_status ? ` · ${row.order_status}` : ''}
									</p>
								)}
							</div>
							<div className='flex flex-wrap items-start gap-2'>
								{wa && (
									<a
										href={wa}
										target='_blank'
										rel='noopener noreferrer'
										className='inline-flex items-center gap-1.5 rounded-lg bg-[#25D366] px-3 py-1.5 text-xs font-semibold text-white'
									>
										<FaWhatsapp size={14} /> Escribirle
									</a>
								)}
								{row.email && (
									<a
										href={`mailto:${row.email}?subject=${encodeURIComponent(
											'Tu compra en RF Store'
										)}`}
										className='inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-700'
									>
										<HiOutlineEnvelope size={14} /> Mail
									</a>
								)}
								{row.order_id && (
									<Link
										to={`/dashboard/ordenes/${row.order_id}`}
										className='inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-700'
									>
										Ver pedido #{row.order_id}
									</Link>
								)}
							</div>
						</div>
					</td>
				</tr>
			)}
		</>
	);
};

const Pager = ({
	page,
	totalPages,
	total,
	noun,
	onChange,
}: {
	page: number;
	totalPages: number;
	total: number;
	noun: string;
	onChange: (p: number) => void;
}) => (
	<div className='flex items-center justify-between gap-3'>
		<p className='text-xs text-ink-500'>
			{total === 0
				? `Sin ${noun}`
				: `Mostrando ${(page - 1) * PAGE_SIZE + 1}–${Math.min(
						page * PAGE_SIZE,
						total
				  )} de ${total} ${noun}`}
		</p>
		<div className='flex items-center gap-1'>
			<button
				onClick={() => onChange(Math.max(1, page - 1))}
				disabled={page <= 1}
				className='grid h-8 w-8 place-items-center rounded-lg border border-ink-200 text-ink-600 disabled:opacity-40'
				aria-label='Anterior'
			>
				<HiOutlineChevronLeft size={16} />
			</button>
			<span className='px-2 text-xs font-semibold text-ink-600'>
				{page} / {totalPages}
			</span>
			<button
				onClick={() => onChange(Math.min(totalPages, page + 1))}
				disabled={page >= totalPages}
				className='grid h-8 w-8 place-items-center rounded-lg border border-ink-200 text-ink-600 disabled:opacity-40'
				aria-label='Siguiente'
			>
				<HiOutlineChevronRight size={16} />
			</button>
		</div>
	</div>
);

const Stat = ({
	label,
	value,
	hint,
	tone,
}: {
	label: string;
	value: string;
	hint?: string;
	tone?: 'amber';
}) => (
	<div
		className={`rounded-xl border p-3 ${
			tone === 'amber'
				? 'border-amber-200 bg-amber-50/60'
				: 'border-ink-200 bg-white'
		}`}
	>
		<p className='text-[11px] font-bold uppercase tracking-wider text-ink-500'>
			{label}
		</p>
		<p className='mt-0.5 text-lg font-bold text-ink-900'>{value}</p>
		{hint && <p className='text-[11px] text-ink-500'>{hint}</p>}
	</div>
);
