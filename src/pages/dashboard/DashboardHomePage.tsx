import { useMemo, useState } from 'react';
import {
	HiOutlineBanknotes,
	HiOutlineClipboardDocumentList,
	HiOutlineReceiptPercent,
	HiOutlineArrowTrendingUp,
	HiOutlineArrowTrendingDown,
	HiOutlineUserPlus,
	HiOutlineDocumentText,
	HiOutlineCube,
	HiOutlineSquares2X2,
	HiOutlineExclamationTriangle,
	HiOutlineExclamationCircle,
	HiOutlineTag,
	HiOutlineRectangleGroup,
	HiOutlineArrowPath,
	HiOutlineCalendarDays,
} from 'react-icons/hi2';
import { useDashboardMetrics } from '../../hooks/dashboard/useDashboardMetrics';
import { formatPrice } from '../../helpers';
import type { TopProduct } from '../../actions/dashboard';

/* ---------- helpers de fecha ---------- */
const toISODate = (d: Date) => d.toISOString().slice(0, 10);

const presetRange = (days: number) => {
	const to = new Date();
	const from = new Date();
	from.setDate(from.getDate() - (days - 1));
	return { from: toISODate(from), to: toISODate(to) };
};

const num = (n: number) => Number(n || 0).toLocaleString('es-UY');

const pct = (n: number) =>
	`${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

const deltaPercent = (current: number, prev: number): number | null => {
	if (!prev || prev === 0) return current > 0 ? 100 : null;
	return ((current - prev) / prev) * 100;
};

/* ---------- subcomponentes ---------- */
interface StatCardProps {
	icon: React.ReactNode;
	label: string;
	value: string;
	sub?: string;
	delta?: number | null;
	tone?: 'brand' | 'emerald' | 'amber' | 'rose' | 'violet' | 'slate';
}

const toneStyles: Record<string, string> = {
	brand: 'bg-brand-50 text-brand-600',
	emerald: 'bg-emerald-50 text-emerald-600',
	amber: 'bg-amber-50 text-amber-600',
	rose: 'bg-rose-50 text-rose-600',
	violet: 'bg-violet-50 text-violet-600',
	slate: 'bg-ink-100 text-ink-600',
};

const StatCard = ({
	icon,
	label,
	value,
	sub,
	delta,
	tone = 'brand',
}: StatCardProps) => (
	<div className='group relative rounded-2xl border border-ink-200/70 bg-white p-4 sm:p-5 shadow-soft transition-all hover:shadow-card-hover hover:-translate-y-0.5'>
		<div className='flex items-start justify-between gap-3'>
			<div className='min-w-0'>
				<p className='text-xs font-medium uppercase tracking-wider text-ink-500'>
					{label}
				</p>
				<p className='mt-1.5 text-xl sm:text-2xl font-bold text-ink-900 truncate'>
					{value}
				</p>
				{sub && <p className='mt-1 text-xs text-ink-500'>{sub}</p>}
			</div>
			<div
				className={`shrink-0 grid place-items-center w-10 h-10 rounded-xl ${toneStyles[tone]}`}
			>
				{icon}
			</div>
		</div>
		{delta !== undefined && delta !== null && (
			<div className='mt-3 flex items-center gap-1 text-xs font-semibold'>
				<span
					className={`inline-flex items-center gap-0.5 ${
						delta >= 0 ? 'text-emerald-600' : 'text-rose-600'
					}`}
				>
					{delta >= 0 ? (
						<HiOutlineArrowTrendingUp size={14} />
					) : (
						<HiOutlineArrowTrendingDown size={14} />
					)}
					{pct(delta)}
				</span>
				<span className='text-ink-400 font-normal'>vs período anterior</span>
			</div>
		)}
	</div>
);

const SectionCard = ({
	title,
	action,
	children,
}: {
	title: string;
	action?: React.ReactNode;
	children: React.ReactNode;
}) => (
	<div className='rounded-2xl border border-ink-200/70 bg-white shadow-soft'>
		<div className='flex items-center justify-between gap-3 border-b border-ink-100 px-5 py-4'>
			<h3 className='font-bold text-ink-900'>{title}</h3>
			{action}
		</div>
		<div className='p-5'>{children}</div>
	</div>
);

const ProductList = ({
	items,
	empty,
}: {
	items: TopProduct[];
	empty: string;
}) => {
	if (!items.length)
		return <p className='py-8 text-center text-sm text-ink-400'>{empty}</p>;

	return (
		<ul className='divide-y divide-ink-100'>
			{items.map((p, i) => (
				<li
					key={p.product_id}
					className='flex items-center gap-3 py-3 first:pt-0 last:pb-0'
				>
					<span className='grid w-6 shrink-0 place-items-center text-xs font-bold text-ink-400'>
						{i + 1}
					</span>
					<div className='h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-ink-100 bg-ink-50'>
						{p.image ? (
							<img
								src={p.image}
								alt={p.name}
								className='h-full w-full object-contain'
							/>
						) : null}
					</div>
					<div className='min-w-0 flex-1'>
						<p className='truncate text-sm font-medium text-ink-800'>
							{p.name}
						</p>
						<p className='text-xs text-ink-500'>
							{num(p.units)} u. · {formatPrice(Number(p.revenue))}
						</p>
					</div>
				</li>
			))}
		</ul>
	);
};

/* ---------- mini gráfico de barras (sin dependencias) ---------- */
const SalesChart = ({
	data,
}: {
	data: { day: string; orders: number; amount: number }[];
}) => {
	const max = Math.max(1, ...data.map(d => Number(d.amount)));
	// Mostramos como máximo ~31 barras para no saturar
	const points = data.length > 45 ? data.filter((_, i) => i % 2 === 0) : data;

	return (
		<div className='flex h-44 items-end gap-1'>
			{points.map(d => {
				const amount = Number(d.amount);
				const h = (amount / max) * 100;
				const label = new Date(d.day + 'T00:00:00').toLocaleDateString(
					'es-UY',
					{ day: '2-digit', month: '2-digit' }
				);
				return (
					<div
						key={d.day}
						className='group relative flex flex-1 flex-col items-center justify-end'
						title={`${label}: ${d.orders} órdenes · ${formatPrice(amount)}`}
					>
						<div
							className='w-full rounded-t bg-gradient-to-t from-brand-600 to-brand-400 transition-all hover:from-brand-700 hover:to-brand-500'
							style={{ height: `${Math.max(amount > 0 ? 4 : 0, h)}%` }}
						/>
					</div>
				);
			})}
		</div>
	);
};

/* ---------- página ---------- */
export const DashboardHomePage = () => {
	const [range, setRange] = useState(() => presetRange(30));
	const [activePreset, setActivePreset] = useState<number | null>(30);

	const fromISO = `${range.from}T00:00:00`;
	const toISO = `${range.to}T23:59:59`;

	const { data, isLoading, isError, refetch, isFetching } =
		useDashboardMetrics(fromISO, toISO);

	const o = data?.overview;

	const conversion = useMemo(() => {
		if (!o || !o.orders_in_period) return 0;
		return (o.concretado_count / o.orders_in_period) * 100;
	}, [o]);

	const applyPreset = (days: number) => {
		setActivePreset(days);
		setRange(presetRange(days));
	};

	const presets = [
		{ days: 7, label: '7 días' },
		{ days: 30, label: '30 días' },
		{ days: 90, label: '90 días' },
		{ days: 365, label: '1 año' },
	];

	return (
		<div className='space-y-6'>
			{/* Encabezado */}
			<div className='flex flex-col gap-1'>
				<h1 className='text-2xl font-bold text-ink-900'>Resumen general</h1>
				<p className='text-sm text-ink-500'>
					Métricas clave de tu tienda en el período seleccionado.
				</p>
			</div>

			{/* Filtros de fecha */}
			<div className='flex flex-col gap-3 rounded-2xl border border-ink-200/70 bg-white p-4 shadow-soft lg:flex-row lg:items-center lg:justify-between'>
				<div className='flex flex-wrap items-center gap-2'>
					{presets.map(p => (
						<button
							key={p.days}
							onClick={() => applyPreset(p.days)}
							className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
								activePreset === p.days
									? 'bg-brand-600 text-white shadow-soft'
									: 'bg-ink-100 text-ink-600 hover:bg-ink-200'
							}`}
						>
							{p.label}
						</button>
					))}
				</div>

				<div className='flex flex-wrap items-center gap-2'>
					<div className='flex items-center gap-2 rounded-lg border border-ink-200 px-3 py-1.5'>
						<HiOutlineCalendarDays className='text-ink-400' size={18} />
						<input
							type='date'
							value={range.from}
							max={range.to}
							onChange={e => {
								setActivePreset(null);
								setRange(r => ({ ...r, from: e.target.value }));
							}}
							className='bg-transparent text-sm text-ink-700 focus:outline-none'
						/>
						<span className='text-ink-300'>—</span>
						<input
							type='date'
							value={range.to}
							min={range.from}
							max={toISODate(new Date())}
							onChange={e => {
								setActivePreset(null);
								setRange(r => ({ ...r, to: e.target.value }));
							}}
							className='bg-transparent text-sm text-ink-700 focus:outline-none'
						/>
					</div>
					<button
						onClick={() => refetch()}
						className='grid h-9 w-9 place-items-center rounded-lg border border-ink-200 text-ink-500 transition-all hover:bg-ink-50 hover:text-brand-600'
						title='Actualizar'
					>
						<HiOutlineArrowPath
							size={18}
							className={isFetching ? 'animate-spin' : ''}
						/>
					</button>
				</div>
			</div>

			{isError && (
				<div className='rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700'>
					Ocurrió un error al cargar las métricas. Probá actualizar.
				</div>
			)}

			{isLoading || !o ? (
				<MetricsSkeleton />
			) : (
				<>
					{/* KPIs */}
					<div className='grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4'>
						<StatCard
							icon={<HiOutlineBanknotes size={20} />}
							label='Ingresos (pagado)'
							value={formatPrice(o.paid_revenue_period)}
							sub={`${num(o.paid_orders_in_period)} pagadas`}
							delta={deltaPercent(
								o.paid_revenue_period,
								o.prev_paid_revenue_period
							)}
							tone='emerald'
						/>
						<StatCard
							icon={<HiOutlineDocumentText size={20} />}
							label='Cotizado (pipeline)'
							value={formatPrice(o.revenue_period)}
							sub={`${num(o.orders_in_period)} cotizaciones`}
							tone='brand'
						/>
						<StatCard
							icon={<HiOutlineClipboardDocumentList size={20} />}
							label='Órdenes'
							value={num(o.orders_in_period)}
							delta={deltaPercent(
								o.orders_in_period,
								o.prev_orders_in_period
							)}
							tone='violet'
						/>
						<StatCard
							icon={<HiOutlineReceiptPercent size={20} />}
							label='Ticket prom. (cotiz.)'
							value={formatPrice(o.avg_order_value)}
							tone='slate'
						/>

						<StatCard
							icon={<HiOutlineArrowTrendingUp size={20} />}
							label='Conversión'
							value={`${conversion.toFixed(1)}%`}
							sub={`${num(o.concretado_count)} concretadas`}
							tone='emerald'
						/>
						<StatCard
							icon={<HiOutlineUserPlus size={20} />}
							label='Clientes nuevos'
							value={num(o.customers_new_period)}
							sub={`${num(o.customers_total)} en total`}
							tone='brand'
						/>
						<StatCard
							icon={<HiOutlineCube size={20} />}
							label='Unidades en stock'
							value={num(o.stock_units)}
							tone='slate'
						/>
						<StatCard
							icon={<HiOutlineSquares2X2 size={20} />}
							label='Productos'
							value={num(o.products_total)}
							sub={`${num(o.products_local)} propios · ${num(
								o.products_cdr
							)} CDR`}
							tone='brand'
						/>

						<StatCard
							icon={<HiOutlineExclamationTriangle size={20} />}
							label='Sin stock'
							value={num(o.variants_out_of_stock)}
							sub='variantes agotadas'
							tone='rose'
						/>
						<StatCard
							icon={<HiOutlineExclamationCircle size={20} />}
							label='Bajo stock'
							value={num(o.variants_low_stock)}
							sub='menos de 5 unidades'
							tone='amber'
						/>
						<StatCard
							icon={<HiOutlineTag size={20} />}
							label='Marcas'
							value={num(o.brands_total)}
							tone='slate'
						/>
						<StatCard
							icon={<HiOutlineRectangleGroup size={20} />}
							label='Categorías'
							value={num(o.categories_total)}
							tone='slate'
						/>
					</div>

					{/* Gráfico + estados */}
					<div className='grid grid-cols-1 gap-4 lg:grid-cols-3'>
						<div className='lg:col-span-2'>
							<SectionCard
								title='Órdenes por día'
								action={
									<span className='text-sm font-semibold text-ink-500'>
										Cotizado: {formatPrice(o.revenue_period)}
									</span>
								}
							>
								{data && data.timeseries.length > 0 ? (
									<SalesChart data={data.timeseries} />
								) : (
									<p className='py-12 text-center text-sm text-ink-400'>
										Sin datos en el período.
									</p>
								)}
							</SectionCard>
						</div>

						<SectionCard title='Órdenes por estado'>
							{data && data.overview.status_breakdown.length > 0 ? (
								<ul className='space-y-3'>
									{data.overview.status_breakdown.map(s => {
										const total = data.overview.orders_in_period || 1;
										const w = (s.count / total) * 100;
										return (
											<li key={s.status}>
												<div className='mb-1 flex items-center justify-between text-sm'>
													<span className='font-medium text-ink-700'>
														{s.status}
													</span>
													<span className='text-ink-500'>
														{num(s.count)}
													</span>
												</div>
												<div className='h-2 overflow-hidden rounded-full bg-ink-100'>
													<div
														className='h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-600'
														style={{ width: `${w}%` }}
													/>
												</div>
											</li>
										);
									})}
								</ul>
							) : (
								<p className='py-8 text-center text-sm text-ink-400'>
									Sin órdenes en el período.
								</p>
							)}
						</SectionCard>
					</div>

					{/* Más / menos vendidos + marcas */}
					<div className='grid grid-cols-1 gap-4 lg:grid-cols-3'>
						<SectionCard title='Más vendidos'>
							<ProductList
								items={data?.topProducts ?? []}
								empty='Aún no hay ventas en el período.'
							/>
						</SectionCard>
						<SectionCard title='Menos vendidos'>
							<ProductList
								items={data?.bottomProducts ?? []}
								empty='Aún no hay ventas en el período.'
							/>
						</SectionCard>
						<SectionCard title='Marcas con más catálogo'>
							{data && data.topBrands.length > 0 ? (
								<ul className='space-y-3'>
									{data.topBrands.map(b => {
										const max = Math.max(
											1,
											...data.topBrands.map(x => x.products)
										);
										const w = (b.products / max) * 100;
										return (
											<li key={b.name}>
												<div className='mb-1 flex items-center justify-between text-sm'>
													<span className='truncate font-medium text-ink-700'>
														{b.name}
													</span>
													<span className='text-ink-500'>
														{num(b.products)}
													</span>
												</div>
												<div className='h-2 overflow-hidden rounded-full bg-ink-100'>
													<div
														className='h-full rounded-full bg-gradient-to-r from-violet-500 to-violet-600'
														style={{ width: `${w}%` }}
													/>
												</div>
											</li>
										);
									})}
								</ul>
							) : (
								<p className='py-8 text-center text-sm text-ink-400'>
									Sin datos.
								</p>
							)}
						</SectionCard>
					</div>
				</>
			)}
		</div>
	);
};

/* ---------- skeleton ---------- */
const MetricsSkeleton = () => (
	<div className='space-y-4'>
		<div className='grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4'>
			{Array.from({ length: 12 }).map((_, i) => (
				<div
					key={i}
					className='h-28 animate-pulse rounded-2xl border border-ink-200/70 bg-ink-100/60'
				/>
			))}
		</div>
		<div className='grid grid-cols-1 gap-4 lg:grid-cols-3'>
			<div className='h-64 animate-pulse rounded-2xl bg-ink-100/60 lg:col-span-2' />
			<div className='h-64 animate-pulse rounded-2xl bg-ink-100/60' />
		</div>
	</div>
);
