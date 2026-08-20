import { useQuery } from '@tanstack/react-query';
import {
	HiOutlineShoppingCart,
	HiOutlineEnvelope,
	HiOutlineCursorArrowRays,
	HiOutlineBanknotes,
	HiOutlineCheckCircle,
	HiOutlineXCircle,
} from 'react-icons/hi2';
import { Link } from 'react-router-dom';
import { getAbandonedCartMetrics } from '../../actions/dashboard';
import { formatMoney, formatDateLong, formatTimeShort } from '../../helpers';

/**
 * Embudo de carritos abandonados.
 *
 * Está ordenado como una secuencia real, porque lo es: se abandona → sale el
 * mail → entra por el enlace → paga. Cada etapa muestra cuántos son y cuánta
 * plata representan, así se ve dónde se cae la gente en vez de mirar un total
 * suelto que no dice nada.
 */
export const AbandonedCartsSection = ({
	from,
	to,
}: {
	from: string;
	to: string;
}) => {
	const { data, isLoading } = useQuery({
		queryKey: ['abandoned-cart-metrics', from, to],
		queryFn: () => getAbandonedCartMetrics(from, to),
	});

	if (isLoading) {
		return (
			<div className='rounded-2xl border border-ink-200 bg-white p-8 text-center text-sm text-ink-400 shadow-soft'>
				Cargando carritos abandonados…
			</div>
		);
	}
	if (!data) return null;

	const tasaClic = data.mails_enviados > 0 ? (data.clics / data.mails_enviados) * 100 : 0;
	const tasaRecuperacion =
		data.mails_enviados > 0 ? (data.recuperados / data.mails_enviados) * 100 : 0;
	// Lo que dejó el módulo: lo cobrado menos lo que costó en descuentos.
	const neto = data.recuperado_usd - data.descuento_usd;

	const etapas = [
		{
			label: 'Abandonaron',
			valor: data.abandonados,
			sub: formatMoney(data.abandonados_usd),
			hint: 'Llegaron al pago y no compraron',
			icon: <HiOutlineShoppingCart size={18} />,
			tone: 'bg-amber-50 text-amber-700',
		},
		{
			label: 'Mails enviados',
			valor: data.mails_enviados,
			sub: `${data.primer_aviso} primeros · ${data.segundo_aviso} segundos`,
			hint: data.mails_fallidos > 0 ? `${data.mails_fallidos} fallaron` : 'Sin fallos',
			icon: <HiOutlineEnvelope size={18} />,
			tone: 'bg-sky-50 text-sky-700',
		},
		{
			label: 'Entraron por el link',
			valor: data.clics,
			sub: `${tasaClic.toFixed(0)}% de los enviados`,
			hint: 'Vieron su descuento',
			icon: <HiOutlineCursorArrowRays size={18} />,
			tone: 'bg-violet-50 text-violet-700',
		},
		{
			label: 'Compraron',
			valor: data.recuperados,
			sub: formatMoney(data.recuperado_usd),
			hint: `${tasaRecuperacion.toFixed(0)}% de recuperación`,
			icon: <HiOutlineBanknotes size={18} />,
			tone: 'bg-emerald-50 text-emerald-700',
		},
	];

	return (
		<section className='space-y-4'>
			<div className='flex flex-wrap items-end justify-between gap-2'>
				<div>
					<h2 className='text-lg font-bold text-ink-900'>Carritos abandonados</h2>
					<p className='text-sm text-ink-500'>
						Quién llegó al pago y no compró, y qué pasó después de escribirle.
					</p>
				</div>
				{data.recuperado_usd > 0 && (
					<div className='rounded-xl bg-emerald-50 px-4 py-2 text-right ring-1 ring-emerald-200'>
						<p className='text-[11px] font-semibold uppercase tracking-wide text-emerald-700'>
							Recuperado neto
						</p>
						<p className='text-lg font-bold tabular-nums text-emerald-800'>
							{formatMoney(neto)}
						</p>
						<p className='text-[11px] text-emerald-700'>
							{formatMoney(data.recuperado_usd)} cobrados −{' '}
							{formatMoney(data.descuento_usd)} de descuento
						</p>
					</div>
				)}
			</div>

			{/* El embudo */}
			<div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
				{etapas.map(e => (
					<div
						key={e.label}
						className='rounded-2xl border border-ink-200/70 bg-white p-4 shadow-soft'
					>
						<div className='flex items-center gap-2'>
							<span className={`grid h-8 w-8 place-items-center rounded-lg ${e.tone}`}>
								{e.icon}
							</span>
							<p className='text-xs font-semibold uppercase tracking-wide text-ink-500'>
								{e.label}
							</p>
						</div>
						<p className='mt-2 text-2xl font-bold tabular-nums text-ink-900'>
							{e.valor}
						</p>
						<p className='text-sm font-medium tabular-nums text-ink-600'>{e.sub}</p>
						<p className='mt-0.5 text-[11px] text-ink-400'>{e.hint}</p>
					</div>
				))}
			</div>

			{data.convertidos_solos > 0 && (
				<p className='text-xs text-ink-500'>
					Además, <b>{data.convertidos_solos}</b> volvieron y compraron solos, sin
					que les escribiéramos.
				</p>
			)}

			<div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
				{/* Qué se mandó */}
				<div className='overflow-hidden rounded-2xl border border-ink-200/70 bg-white shadow-soft'>
					<div className='border-b border-ink-100 px-5 py-3.5'>
						<h3 className='text-sm font-bold text-ink-900'>Mails enviados</h3>
					</div>
					{data.ultimos.length === 0 ? (
						<p className='px-5 py-8 text-center text-sm text-ink-400'>
							Todavía no salió ningún mail de recuperación.
						</p>
					) : (
						<ul className='divide-y divide-ink-100'>
							{data.ultimos.map(s => (
								<li key={s.id} className='flex items-center gap-3 px-5 py-3'>
									<span className='shrink-0'>
										{s.recovered_order_id ? (
											<HiOutlineCheckCircle className='text-emerald-600' size={20} />
										) : s.status === 'failed' ? (
											<HiOutlineXCircle className='text-rose-500' size={20} />
										) : s.clicked ? (
											<HiOutlineCursorArrowRays className='text-violet-500' size={20} />
										) : (
											<HiOutlineEnvelope className='text-ink-300' size={20} />
										)}
									</span>
									<div className='min-w-0 flex-1'>
										<p className='truncate text-sm font-medium text-ink-800'>
											{s.nombre || s.email}
										</p>
										<p className='truncate text-[11px] text-ink-500'>
											{s.items.slice(0, 2).join(', ')}
											{s.items.length > 2 && ` +${s.items.length - 2}`}
											{s.coupon_code && ` · ${s.coupon_code}`}
										</p>
										<p className='text-[11px] text-ink-400'>
											{formatDateLong(s.sent_at)} · {formatTimeShort(s.sent_at)}
											{s.reminder_no > 1 && ' · 2.º aviso'}
										</p>
									</div>
									<div className='shrink-0 text-right'>
										{s.recovered_order_id ? (
											<Link
												to={`/dashboard/ordenes/${s.recovered_order_id}`}
												className='text-sm font-bold tabular-nums text-emerald-700 hover:underline'
											>
												+{formatMoney(Number(s.recovered_total_usd) || 0)}
											</Link>
										) : (
											<span className='text-sm tabular-nums text-ink-400'>
												{formatMoney(s.total_usd)}
											</span>
										)}
										<p className='text-[10px] uppercase tracking-wide text-ink-400'>
											{s.recovered_order_id
												? 'recuperado'
												: s.status === 'failed'
												? 'falló'
												: s.clicked
												? 'entró'
												: 'enviado'}
										</p>
									</div>
								</li>
							))}
						</ul>
					)}
				</div>

				{/* Lo que hay para ganar */}
				<div className='overflow-hidden rounded-2xl border border-ink-200/70 bg-white shadow-soft'>
					<div className='flex items-center justify-between border-b border-ink-100 px-5 py-3.5'>
						<h3 className='text-sm font-bold text-ink-900'>Sin contactar</h3>
						<span className='text-[11px] text-ink-500'>
							{formatMoney(data.abandonados_usd)} en juego
						</span>
					</div>
					{data.pendientes.length === 0 ? (
						<p className='px-5 py-8 text-center text-sm text-ink-400'>
							No hay carritos abandonados en este período.
						</p>
					) : (
						<ul className='divide-y divide-ink-100'>
							{data.pendientes.map(p => (
								<li key={p.id} className='flex items-center gap-3 px-5 py-3'>
									<div className='min-w-0 flex-1'>
										<p className='truncate text-sm font-medium text-ink-800'>
											{p.nombre || p.email || 'Sin datos de contacto'}
										</p>
										<p className='text-[11px] text-ink-400'>
											{p.items_count} producto{p.items_count === 1 ? '' : 's'} ·{' '}
											{formatDateLong(p.updated_at)} · {formatTimeShort(p.updated_at)}
										</p>
									</div>
									<div className='shrink-0 text-right'>
										<p className='text-sm font-semibold tabular-nums text-ink-800'>
											{formatMoney(p.total_usd)}
										</p>
										{p.avisos > 0 && (
											<p className='text-[10px] uppercase tracking-wide text-sky-600'>
												{p.avisos} aviso{p.avisos === 1 ? '' : 's'}
											</p>
										)}
									</div>
								</li>
							))}
						</ul>
					)}
				</div>
			</div>
		</section>
	);
};
