import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { supabase } from '../../../supabase/client';
import {
	creditNoteInvoice,
	DEFAULT_INVOICE_CONFIG,
	emitInvoice,
	getInvoicePreview,
	INVOICE_STATUS_UI,
	refreshInvoice,
	retryInvoice,
	uploadInvoiceToMl,
	type InvoiceConfig,
	type InvoiceRow,
	type Receptor,
	type ReceptorTipo,
} from '../../../actions/invoices';
import { getAppSettings } from '../../../actions';
import { URUGUAY_DEPARTMENTS } from '../../../constants/shipping';

/* ======================================================================= */
/*  Bloque "Factura electrónica" de una orden (web, Mercado Libre o manual). */
/*  Nada se manda a Fixed hasta que el admin revisa la vista previa y       */
/*  confirma. Guía: docs/fixed-integracion.md                               */
/* ======================================================================= */

const money = (n: number, moneda: string) =>
	`${moneda === 'USD' ? 'USD' : '$'} ${Number(n).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const StatusBadge = ({ status }: { status: InvoiceRow['status'] }) => (
	<span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${INVOICE_STATUS_UI[status].className}`}>
		{INVOICE_STATUS_UI[status].label}
	</span>
);

const LIVE: InvoiceRow['status'][] = ['enviando', 'emitida', 'aceptada'];

export const OrderInvoicePanel = ({ orderId, channel }: { orderId: number; channel?: string | null }) => {
	const qc = useQueryClient();
	const [open, setOpen] = useState(false);

	const { data: config } = useQuery({
		queryKey: ['app_settings'],
		queryFn: getAppSettings,
		select: map => ({ ...DEFAULT_INVOICE_CONFIG, ...((map.get('invoice_config') as Partial<InvoiceConfig>) ?? {}) }),
	});

	// Facturas de la orden (o de su pack de ML), directo de la tabla: el admin la lee por RLS.
	const { data: invoices = [] } = useQuery({
		queryKey: ['invoices', orderId],
		queryFn: async () => {
			const { data, error } = await (supabase as any)
				.from('invoices')
				.select('*')
				.contains('order_ids', [orderId])
				.order('created_at', { ascending: false });
			if (error) throw new Error(error.message);
			return (data ?? []) as InvoiceRow[];
		},
	});

	const refetch = () => {
		qc.invalidateQueries({ queryKey: ['invoices', orderId] });
		qc.invalidateQueries({ queryKey: ['invoice-status'] });
	};

	const sales = invoices.filter(i => i.kind === 'venta');
	const notes = invoices.filter(i => i.kind === 'nota_credito');
	const liveSale = sales.find(i => LIVE.includes(i.status));
	const environment = invoices[0]?.environment;

	return (
		<div className='rounded-2xl border border-ink-200/70 bg-white p-5 shadow-soft'>
			<div className='mb-3 flex items-center justify-between gap-2'>
				<h2 className='font-bold text-ink-900'>🧾 Factura electrónica</h2>
				{environment === 'testing' && (
					<span className='rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-800'>
						Prueba
					</span>
				)}
			</div>

			{invoices.length === 0 && <p className='mb-3 text-sm text-ink-500'>Esta orden todavía no se facturó.</p>}

			<div className='space-y-3'>
				{sales.map(sale => (
					<InvoiceCard
						key={sale.id}
						invoice={sale}
						isMl={channel === 'ml'}
						creditNote={notes.find(n => n.parent_invoice_id === sale.id && n.status !== 'error')}
						failedNotes={notes.filter(n => n.parent_invoice_id === sale.id && n.status === 'error')}
						onChange={refetch}
					/>
				))}
			</div>

			{!liveSale && (
				<div className='mt-3'>
					{config?.enabled ? (
						<>
							{sales.length > 0 && (
								<p className='mb-2 text-xs text-ink-500'>
									Esta orden no tiene una factura vigente. Si corresponde, podés emitir una nueva.
								</p>
							)}
							<button
								onClick={() => setOpen(true)}
								className={
									sales.length
										? 'w-full rounded-full border border-ink-300 px-4 py-2.5 text-sm font-semibold text-ink-800 hover:bg-ink-50'
										: 'w-full rounded-full bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink-800'
								}
							>
								{sales.length ? 'Emitir una factura nueva' : 'Facturar'}
							</button>
						</>
					) : (
						<p className='text-xs text-ink-500'>
							La facturación está apagada. Se prende en Configuración → Facturación.
						</p>
					)}
				</div>
			)}

			{open && (
				<InvoiceModal
					orderId={orderId}
					onClose={() => setOpen(false)}
					onDone={() => {
						setOpen(false);
						refetch();
					}}
				/>
			)}
		</div>
	);
};

/* ------------------------------------------------------------------------ */

const InvoiceCard = ({
	invoice,
	isMl,
	creditNote,
	failedNotes,
	onChange,
}: {
	invoice: InvoiceRow;
	isMl: boolean;
	creditNote?: InvoiceRow;
	failedNotes: InvoiceRow[];
	onChange: () => void;
}) => {
	const act = useMutation({
		mutationFn: async (kind: 'refresh' | 'retry' | 'void' | 'ml') => {
			if (kind === 'refresh') return refreshInvoice(invoice.id);
			if (kind === 'ml') return uploadInvoiceToMl(invoice.id);
			if (kind === 'retry') return retryInvoice(invoice.id);
			const motivo = window.prompt(
				`¿Anular ${invoice.comprobante}?\n\nSe emite una nota de crédito por el TOTAL (${money(invoice.total, invoice.moneda)}). No se puede deshacer.\n\nMotivo (opcional):`,
				''
			);
			if (motivo === null) return null;
			return creditNoteInvoice(invoice.id, motivo);
		},
		onSuccess: (r, kind) => {
			if (!r) return;
			if (kind === 'void') toast.success(r.invoice.status === 'error' ? 'No se pudo anular' : `Anulada: ${r.invoice.comprobante ?? 'nota de crédito emitida'}`);
			onChange();
		},
		onError: e => toast.error((e as Error).message),
	});

	return (
		<div className='rounded-xl border border-ink-100 bg-ink-50/40 p-3 text-sm'>
			<div className='flex flex-wrap items-center justify-between gap-2'>
				<span className={`font-semibold ${invoice.status === 'anulada' ? 'text-ink-500 line-through' : 'text-ink-900'}`}>
					{invoice.comprobante ?? 'Comprobante'}
				</span>
				<StatusBadge status={invoice.status} />
			</div>
			<p className='mt-1 text-ink-600'>
				{money(invoice.total, invoice.moneda)}
				{invoice.cotizacion ? ` · cotización ${invoice.cotizacion}` : ''} ·{' '}
				{new Date(invoice.created_at).toLocaleString('es-UY', { dateStyle: 'short', timeStyle: 'short' })}
			</p>

			{invoice.status === 'error' && invoice.last_error_desc && (
				<p className='mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700'>{invoice.last_error_desc}</p>
			)}
			{invoice.status === 'rechazada' && (
				<p className='mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700'>
					DGI la rechazó: {invoice.motivo_rechazo_dgi || 'sin detalle'}. Corregí los datos y volvé a facturar.
				</p>
			)}
			{invoice.status === 'enviando' && (
				<p className='mt-2 text-xs text-sky-700'>
					Todavía no hay respuesta de Fixed. Se reintenta solo cada 10 minutos sin riesgo de duplicarla.
				</p>
			)}
			{invoice.status === 'emitida' && !invoice.url_a4 && invoice.last_error_desc && (
				<p className='mt-2 text-xs text-amber-700'>Emitida, pero el PDF todavía no está: se pide solo.</p>
			)}

			<div className='mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold'>
				{invoice.url_a4 && (
					<a href={invoice.url_a4} target='_blank' rel='noreferrer' className='text-ink-900 underline'>
						Ver PDF
					</a>
				)}
				{invoice.url_verificar && (
					<a href={invoice.url_verificar} target='_blank' rel='noreferrer' className='text-ink-900 underline'>
						Verificar
					</a>
				)}
				{invoice.status === 'emitida' && (
					<button disabled={act.isPending} onClick={() => act.mutate('refresh')} className='text-ink-900 underline disabled:opacity-50'>
						Consultar DGI
					</button>
				)}
				{invoice.status === 'enviando' && (
					<button disabled={act.isPending} onClick={() => act.mutate('retry')} className='text-ink-900 underline disabled:opacity-50'>
						Reintentar ahora
					</button>
				)}
				{(invoice.status === 'emitida' || invoice.status === 'aceptada') && !creditNote && (
					<button disabled={act.isPending} onClick={() => act.mutate('void')} className='text-red-700 underline disabled:opacity-50'>
						Anular (nota de crédito)
					</button>
				)}
			</div>

			{/* Venta de Mercado Libre: la factura se sube a la venta para que la vea el comprador. */}
			{isMl && (invoice.status === 'emitida' || invoice.status === 'aceptada') && (
				<div className='mt-2 text-xs'>
					{invoice.environment === 'testing' ? (
						<p className='text-ink-500'>En producción esta factura se sube sola a la venta de Mercado Libre (en prueba no se sube).</p>
					) : invoice.ml_fiscal_document_id ? (
						<p className='text-emerald-700'>✓ Subida a la venta de Mercado Libre: el comprador ya la puede ver.</p>
					) : invoice.ml_upload_error ? (
						<p className='text-red-700'>
							No se pudo subir a Mercado Libre: {invoice.ml_upload_error}{' '}
							<button disabled={act.isPending} onClick={() => act.mutate('ml')} className='font-semibold underline disabled:opacity-50'>
								Reintentar
							</button>
						</p>
					) : (
						<p className='text-ink-500'>Subiendo a Mercado Libre cuando el PDF esté listo…</p>
					)}
				</div>
			)}

			{/* La nota de crédito no es otra factura: es CÓMO se anuló ésta. */}
			{creditNote && (
				<div className='mt-3 rounded-lg border border-ink-100 bg-white px-3 py-2 text-xs'>
					<p className='text-ink-700'>
						<b>Anulada</b> el{' '}
						{new Date(creditNote.created_at).toLocaleString('es-UY', { dateStyle: 'short', timeStyle: 'short' })} con la{' '}
						<b>{creditNote.comprobante ?? 'nota de crédito'}</b>.
					</p>
					{creditNote.note && <p className='mt-0.5 text-ink-500'>Motivo: {creditNote.note}</p>}
					<p
						className={`mt-0.5 ${
							creditNote.status === 'rechazada' ? 'text-red-700' : creditNote.status === 'aceptada' ? 'text-emerald-700' : 'text-ink-500'
						}`}
					>
						{creditNote.status === 'aceptada'
							? 'DGI confirmó la anulación.'
							: creditNote.status === 'rechazada'
							? `DGI rechazó la anulación: ${creditNote.motivo_rechazo_dgi || 'sin detalle'}. La factura sigue vigente; revisalo en Fixed.`
							: creditNote.status === 'enviando'
							? 'Enviando la anulación a Fixed…'
							: 'Falta que DGI confirme la anulación (se consulta solo).'}
					</p>
					{creditNote.url_a4 && (
						<a href={creditNote.url_a4} target='_blank' rel='noreferrer' className='mt-1 inline-block font-semibold text-ink-900 underline'>
							Ver PDF de la nota de crédito
						</a>
					)}
				</div>
			)}
			{failedNotes.map(n => (
				<p key={n.id} className='mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700'>
					No se pudo anular: {n.last_error_desc}
				</p>
			))}
		</div>
	);
};

/* ------------------------------------------------------------------------ */

const TIPOS: { value: ReceptorTipo; label: string }[] = [
	{ value: 'final', label: 'Consumidor final (sin datos)' },
	{ value: 'ci', label: 'Persona (cédula)' },
	{ value: 'rut', label: 'Empresa (RUT) → e-Factura' },
];

const InvoiceModal = ({ orderId, onClose, onDone }: { orderId: number; onClose: () => void; onDone: () => void }) => {
	const { data, isLoading, error } = useQuery({
		queryKey: ['invoice-preview', orderId],
		queryFn: () => getInvoicePreview(orderId),
		staleTime: 0,
	});
	const [edited, setEdited] = useState<Receptor | null>(null);
	const receptor = edited ?? data?.draft.receptor ?? null;
	const set = (k: keyof Receptor, v: string) => receptor && setEdited({ ...receptor, [k]: v });

	const emit = useMutation({
		mutationFn: () => emitInvoice(orderId, receptor!),
		onSuccess: r => {
			if (r.invoice.status === 'error') toast.error(r.invoice.last_error_desc ?? 'Fixed rechazó la factura');
			else if (r.invoice.status === 'enviando') toast('Enviada: todavía no hay respuesta de Fixed, se reintenta sola.', { icon: '⏳' });
			else toast.success(`Emitida: ${r.invoice.comprobante}`);
			onDone();
		},
		onError: e => toast.error((e as Error).message, { duration: 8000 }),
	});

	const d = data?.draft;
	const blocked = !!data?.not_invoiceable || !data?.enabled;

	return (
		<div className='fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/40 p-4'>
			<div className='my-8 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-card'>
				<div className='mb-4 flex items-center justify-between'>
					<h3 className='text-lg font-bold text-ink-900'>Facturar orden #{orderId}</h3>
					<button onClick={onClose} className='text-sm text-ink-500 hover:text-ink-900'>
						Cerrar
					</button>
				</div>

				{isLoading && <p className='text-sm text-ink-500'>Armando la factura…</p>}
				{error && <p className='text-sm text-red-700'>{(error as Error).message}</p>}

				{d && receptor && (
					<div className='space-y-5 text-sm'>
						{data.environment === 'testing' && (
							<p className='rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800'>
								Ambiente de PRUEBA de Fixed: el comprobante no va a DGI ni le llega al cliente.
							</p>
						)}
						{data.not_invoiceable && <p className='rounded-lg bg-red-50 px-3 py-2 text-red-700'>{data.not_invoiceable}</p>}

						{/* Líneas */}
						<div>
							<p className='mb-2 font-semibold text-ink-900'>
								Detalle · {d.moneda === 'UYU' ? 'en pesos' : 'en dólares'}
								{d.cotizacion ? ` (cotización ${d.cotizacion})` : ''}
							</p>
							<div className='overflow-hidden rounded-xl border border-ink-100'>
								<table className='w-full text-left text-xs'>
									<thead className='bg-ink-50 text-ink-500'>
										<tr>
											<th className='px-3 py-2'>Descripción</th>
											<th className='px-3 py-2 text-right'>Cant.</th>
											<th className='px-3 py-2 text-right'>Precio</th>
											<th className='px-3 py-2 text-right'>Desc.</th>
										</tr>
									</thead>
									<tbody className='divide-y divide-ink-100'>
										{d.lines.map((l, i) => (
											<tr key={i}>
												<td className='px-3 py-2'>
													{l.descripcion}
													<span className='block text-[11px] text-ink-400'>Rubro: {l.rubro}</span>
												</td>
												<td className='px-3 py-2 text-right'>{l.cantidad}</td>
												<td className='px-3 py-2 text-right'>{money(l.precioUnitario, d.moneda)}</td>
												<td className='px-3 py-2 text-right'>{l.descuentoMonto ? money(l.descuentoMonto, d.moneda) : '—'}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
							<p className='mt-2 text-right font-bold text-ink-900'>Total (IVA incluido): {money(d.total, d.moneda)}</p>
							{d.warnings.map(w => (
								<p key={w} className='mt-1 text-xs text-ink-500'>{w}</p>
							))}
						</div>

						{/* Cliente */}
						<div>
							<p className='mb-1 font-semibold text-ink-900'>A nombre de</p>
							<p className='mb-2 text-xs text-ink-500'>{d.receptor_source}</p>
							{d.id_required && (
								<p className='mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800'>
									Supera 5000 UI (≈ $ {Math.round(d.id_threshold_uyu).toLocaleString('es-UY')}): DGI exige documento, domicilio, localidad y departamento.
								</p>
							)}
							<select
								value={receptor.tipo}
								onChange={e => set('tipo', e.target.value)}
								className='mb-3 w-full rounded-lg border border-ink-200 px-3 py-2'
							>
								{TIPOS.map(t => (
									<option key={t.value} value={t.value}>
										{t.label}
									</option>
								))}
							</select>

							{receptor.tipo !== 'final' && (
								<div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
									<Field label={receptor.tipo === 'rut' ? 'RUT (12 dígitos)' : 'Cédula (opcional si no supera 5000 UI)'} value={receptor.documento} onChange={v => set('documento', v)} />
									{receptor.tipo === 'rut' && <Field label='Razón social' value={receptor.razonSocial} onChange={v => set('razonSocial', v)} />}
									<Field label={receptor.tipo === 'rut' ? 'Nombre comercial' : 'Nombre y apellido'} value={receptor.nombreComercial} onChange={v => set('nombreComercial', v)} />
									<Field label='Domicilio' value={receptor.domicilio} onChange={v => set('domicilio', v)} />
									<Field label='Localidad' value={receptor.localidad} onChange={v => set('localidad', v)} />
									<label className='text-xs text-ink-500'>
										Departamento
										<select
											value={receptor.departamento}
											onChange={e => set('departamento', e.target.value)}
											className='mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-900'
										>
											<option value=''>—</option>
											{receptor.departamento && !URUGUAY_DEPARTMENTS.includes(receptor.departamento) && (
												<option value={receptor.departamento}>{receptor.departamento}</option>
											)}
											{URUGUAY_DEPARTMENTS.map(dep => (
												<option key={dep} value={dep}>
													{dep}
												</option>
											))}
										</select>
									</label>
									<Field label='Mail (Fixed le manda la factura)' value={receptor.email} onChange={v => set('email', v)} />
									<Field label='Teléfono' value={receptor.telefono} onChange={v => set('telefono', v)} />
								</div>
							)}
						</div>

						{data.problems.length > 0 && !edited && (
							<ul className='space-y-1 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700'>
								{data.problems.map(p => (
									<li key={p}>• {p}</li>
								))}
							</ul>
						)}

						<div className='flex justify-end gap-2'>
							<button onClick={onClose} className='rounded-full border border-ink-300 px-5 py-2.5 font-semibold text-ink-800'>
								Cancelar
							</button>
							<button
								disabled={blocked || emit.isPending}
								onClick={() => emit.mutate()}
								className='rounded-full bg-ink-900 px-5 py-2.5 font-semibold text-white disabled:opacity-50'
							>
								{emit.isPending ? 'Emitiendo…' : receptor.tipo === 'rut' ? 'Emitir e-Factura' : 'Emitir e-Ticket'}
							</button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
};

const Field = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
	<label className='text-xs text-ink-500'>
		{label}
		<input
			value={value}
			onChange={e => onChange(e.target.value)}
			className='mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-900'
		/>
	</label>
);
