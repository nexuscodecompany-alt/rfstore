import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
	HiOutlineTrash,
	HiXMark,
	HiOutlinePlus,
	HiOutlinePencilSquare,
} from 'react-icons/hi2';
import {
	useSaleConcepts,
	useCreateSaleConcept,
	useDeleteSaleConcept,
	useManualSales,
	useCreateManualSale,
	useUpdateManualSale,
	useDeleteManualSale,
	useUsdUyuRate,
} from '../../../hooks';
import { supabase } from '../../../supabase/client';
import {
	sendManualSaleConfirmation,
	sendManualSalePaymentLink,
	manualPaymentMethodLabels,
	manualPaymentMethodOptions,
} from '../../../actions';
import type {
	ManualSale,
	ManualSaleItem,
	ManualPaymentMethod,
} from '../../../actions';
import { formatMoneyCur, formatDateLong } from '../../../helpers';

type Currency = 'USD' | 'UYU';

interface VariantRow {
	id: string;
	color_name: string | null;
	storage: string | null;
	stock: number;
}
interface ProductRow {
	id: string;
	name: string;
	variants: VariantRow[];
}

const todayISODate = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
const toISODate = (iso: string) => new Date(iso).toLocaleDateString('en-CA');

interface Props {
	open: boolean;
	onClose: () => void;
	// Si viene un id, el modal muestra esa venta manual (ver + editar + eliminar).
	// Si no, muestra el formulario para crear una nueva.
	saleId?: number | null;
}

export const ManualSaleModal = ({ open, onClose, saleId }: Props) => {
	const [editing, setEditing] = useState(false);

	// Al cerrar (o cambiar de venta) volvemos siempre al modo lectura.
	useEffect(() => {
		if (!open) setEditing(false);
	}, [open, saleId]);

	if (!open) return null;

	const title = !saleId
		? 'Nueva venta manual'
		: editing
		? 'Editar venta manual'
		: 'Venta manual';

	return (
		<div className='fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/50 p-4 backdrop-blur-sm'>
			<div className='my-8 w-full max-w-2xl rounded-2xl bg-white shadow-2xl'>
				<div className='flex items-center justify-between border-b border-ink-100 px-5 py-4'>
					<h2 className='text-lg font-bold text-ink-900'>{title}</h2>
					<button
						onClick={onClose}
						className='grid h-9 w-9 place-items-center rounded-lg text-ink-400 hover:bg-ink-100'
						aria-label='Cerrar'
					>
						<HiXMark size={20} />
					</button>
				</div>
				<div className='p-5'>
					{saleId ? (
						editing ? (
							<EditManualSale
								saleId={saleId}
								onClose={() => setEditing(false)}
							/>
						) : (
							<ViewManualSale
								saleId={saleId}
								onClose={onClose}
								onEdit={() => setEditing(true)}
							/>
						)
					) : (
						<ManualSaleForm onClose={onClose} />
					)}
				</div>
				<style>{`.inp{width:100%;border:1px solid #d6d3d1;border-radius:0.5rem;padding:0.5rem 0.75rem;font-size:0.875rem;outline:none}.inp:focus{box-shadow:0 0 0 2px rgba(99,102,241,.3)}`}</style>
			</div>
		</div>
	);
};

/* ------------------------------ Editar venta ------------------------------ */
// Carga la venta y reusa el mismo formulario que el alta, precargado.
const EditManualSale = ({
	saleId,
	onClose,
}: {
	saleId: number;
	onClose: () => void;
}) => {
	const { data: sales = [] } = useManualSales(null);
	const sale = sales.find(s => s.id === saleId);
	if (!sale) return <p className='text-sm text-ink-500'>Cargando…</p>;
	return <ManualSaleForm sale={sale} onClose={onClose} />;
};

/* ------------------------- Ver / editar / eliminar ------------------------- */
const ViewManualSale = ({
	saleId,
	onClose,
	onEdit,
}: {
	saleId: number;
	onClose: () => void;
	onEdit: () => void;
}) => {
	const { data: sales = [] } = useManualSales(null);
	const deleteSale = useDeleteManualSale();
	const sale = sales.find(s => s.id === saleId);

	// Le manda al comprador la misma confirmación que recibe quien compra por la
	// web. Requiere que la venta tenga cliente con mail.
	const enviarConfirmacion = useMutation({
		mutationFn: sendManualSaleConfirmation,
		onSuccess: () => toast.success('Mail de confirmación enviado al cliente'),
		onError: (e: Error) => toast.error(e.message),
	});

	// Cobro pendiente: le manda al cliente cómo pagar (link de MP, datos de
	// Abitab, o las dos cosas si es combinado). En transferencia no aplica: esos
	// datos los pasa el admin en persona.
	const enviarCobro = useMutation({
		mutationFn: sendManualSalePaymentLink,
		onSuccess: r => toast.success(`Cobro enviado a ${r.sentTo}`),
		onError: (e: Error) => toast.error(e.message),
	});

	if (!sale) return <p className='text-sm text-ink-500'>Cargando…</p>;

	const puedeEnviarCobro =
		!sale.paid &&
		!!sale.customer?.email &&
		['mercadopago', 'hybrid', 'deposit'].includes(sale.paymentMethod);

	return (
		<div className='space-y-4'>
			<div className='grid grid-cols-2 gap-3 text-sm'>
				<Info label='Fecha' value={formatDateLong(sale.created_at)} />
				<Info label='Concepto' value={sale.conceptName ?? '—'} />
				<Info label='Descripción' value={sale.description || '—'} full />
			</div>

			{/* Cómo se cobra. Antes no se guardaba y todas figuraban como MercadoPago. */}
			<div className='rounded-xl border border-ink-200 bg-white p-3'>
				<div className='grid grid-cols-2 gap-3 text-sm'>
					<Info
						label='Método de pago'
						value={
							sale.paymentMethod
								? manualPaymentMethodLabels[sale.paymentMethod]
								: 'Sin especificar'
						}
					/>
					<Info label='Estado' value={sale.paid ? 'Cobrada' : 'Pendiente de cobro'} />
					{sale.paymentSplit && (
						<Info
							label='Reparto'
							value={`MercadoPago ${formatMoneyCur(
								sale.paymentSplit.mercadopago,
								sale.currency
							)} · Transferencia ${formatMoneyCur(
								sale.paymentSplit.transfer,
								sale.currency
							)}`}
							full
						/>
					)}
				</div>

				{!sale.paid && (
					<div className='mt-3 space-y-2'>
						<p className='rounded-md bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900'>
							Todavía no entró la plata, así que <b>no descontó stock</b>. Cuando
							cobres, marcala como cobrada desde el listado de órdenes.
						</p>

						{puedeEnviarCobro ? (
							<button
								type='button'
								disabled={enviarCobro.isPending}
								onClick={() => enviarCobro.mutate(sale.id)}
								className='rounded-lg bg-ink-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50'
							>
								{enviarCobro.isPending
									? 'Enviando…'
									: sale.paymentMethod === 'hybrid'
									? 'Enviar link de MP + datos bancarios'
									: sale.paymentMethod === 'mercadopago'
									? 'Enviar link de MercadoPago'
									: 'Enviar datos de Abitab / Redpagos'}
							</button>
						) : (
							<p className='text-[12px] text-ink-500'>
								{!sale.paymentMethod
									? 'Editá la venta y elegí el método de pago para poder mandarle el cobro.'
									: sale.paymentMethod === 'transfer'
									? 'En transferencia los datos de la cuenta se los pasás vos: no se manda mail.'
									: 'Cargale el mail del cliente para poder mandarle el cobro.'}
							</p>
						)}
					</div>
				)}
			</div>

			{/* Cliente: sólo si la venta lo tiene cargado. Es lo que habilita el
			    mail de confirmación. */}
			{sale.customer ? (
				<div className='space-y-2 rounded-xl border border-ink-200 bg-white p-3'>
					<div className='grid grid-cols-2 gap-3 text-sm'>
						<Info label='Cliente' value={sale.customer.fullName || '—'} />
						<Info label='Email' value={sale.customer.email} />
						{sale.customer.phone && (
							<Info label='Teléfono' value={sale.customer.phone} />
						)}
						{sale.address && (
							<Info
								label='Entrega'
								value={[sale.address.line1, sale.address.city, sale.address.state]
									.filter(Boolean)
									.join(', ')}
								full
							/>
						)}
						{sale.invoice && (
							<Info
								label='Factura con RUT'
								value={`${sale.invoice.businessName} — ${sale.invoice.rut}`}
								full
							/>
						)}
					</div>
					<button
						type='button'
						onClick={() => enviarConfirmacion.mutate(sale.id)}
						disabled={enviarConfirmacion.isPending}
						className='w-full rounded-lg border border-brand-300 bg-brand-50 py-2 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-100 disabled:opacity-60'
					>
						{enviarConfirmacion.isPending
							? 'Enviando…'
							: 'Enviar mail de confirmación al cliente'}
					</button>
				</div>
			) : (
				<p className='rounded-lg border border-dashed border-ink-300 bg-ink-50/60 px-3 py-2.5 text-[13px] text-ink-600'>
					Esta venta no tiene cliente cargado. Editala y agregale el mail para
					poder enviarle la confirmación de compra.
				</p>
			)}

			{/* Desglose */}
			<div className='space-y-1.5 rounded-xl border border-ink-100 bg-ink-50/40 p-3 text-sm'>
				<Row label='Precio de venta' value={formatMoneyCur(sale.saleAmount, sale.currency)} strong />
				<Row label='Costo' value={`− ${formatMoneyCur(sale.cost, sale.currency)}`} />
				{sale.commission > 0 && (
					<Row label='Comisión' value={`− ${formatMoneyCur(sale.commission, sale.currency)}`} />
				)}
				{sale.shipping > 0 && (
					<Row label='Envío' value={`− ${formatMoneyCur(sale.shipping, sale.currency)}`} />
				)}
				{sale.other > 0 && (
					<Row label='Otros costos' value={`− ${formatMoneyCur(sale.other, sale.currency)}`} />
				)}
			</div>
			{sale.items.length > 0 && (
				<div>
					<p className='mb-1 text-xs font-medium text-ink-500'>
						Productos (descontaron stock)
					</p>
					<ul className='space-y-1'>
						{sale.items.map((it, idx) => (
							<li
								key={idx}
								className='rounded-lg bg-ink-50 px-3 py-1.5 text-sm text-ink-700'
							>
								<b>{it.quantity}×</b> {it.label}
							</li>
						))}
					</ul>
				</div>
			)}

			<div className='rounded-xl border border-emerald-200 bg-emerald-50/60 p-3'>
				<div className='flex items-center justify-between'>
					<span className='font-semibold text-emerald-800'>
						Ganancia neta real
					</span>
					<span className='text-lg font-bold text-emerald-700'>
						{formatMoneyCur(sale.profit, sale.currency)}
					</span>
				</div>
				<div className='mt-0.5 flex items-center justify-between text-xs text-emerald-700/70'>
					<span>Bruta (s/costo)</span>
					<span>{formatMoneyCur(sale.grossProfit, sale.currency)}</span>
				</div>
			</div>
			<div className='flex flex-wrap justify-end gap-2'>
				<button
					onClick={onEdit}
					className='inline-flex items-center gap-1.5 rounded-full border border-ink-300 px-4 py-2 text-sm font-semibold text-ink-700 hover:bg-ink-50'
				>
					<HiOutlinePencilSquare size={16} /> Editar venta
				</button>
				<button
					onClick={() => {
						if (confirm('¿Eliminar esta venta manual?'))
							deleteSale.mutate(sale.id, { onSuccess: onClose });
					}}
					disabled={deleteSale.isPending}
					className='inline-flex items-center gap-1.5 rounded-full border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50'
				>
					<HiOutlineTrash size={16} /> Eliminar venta
				</button>
			</div>
		</div>
	);
};

const Info = ({
	label,
	value,
	full,
}: {
	label: string;
	value: string;
	full?: boolean;
}) => (
	<div className={full ? 'col-span-2' : ''}>
		<p className='text-xs font-medium text-ink-500'>{label}</p>
		<p className='font-medium text-ink-800'>{value}</p>
	</div>
);

const Row = ({
	label,
	value,
	strong,
}: {
	label: string;
	value: string;
	strong?: boolean;
}) => (
	<div className='flex items-center justify-between'>
		<span className='text-ink-600'>{label}</span>
		<span className={strong ? 'font-semibold text-ink-900' : 'text-ink-700'}>
			{value}
		</span>
	</div>
);

/* --------------------------- Crear / editar venta --------------------------- */
// Mismo formulario para el alta y la edición: si viene `sale`, arranca precargado
// y guarda con update (el RPC reconcilia el stock de los productos vinculados).
const ManualSaleForm = ({
	sale,
	onClose,
}: {
	sale?: ManualSale;
	onClose: () => void;
}) => {
	const { data: concepts = [] } = useSaleConcepts();
	const createConcept = useCreateSaleConcept();
	const deleteConcept = useDeleteSaleConcept();
	const createSale = useCreateManualSale();
	const updateSale = useUpdateManualSale();
	const { data: fx } = useUsdUyuRate();

	const isEdit = !!sale;
	// En edición mostramos los montos ya convertidos a la moneda real de la venta.
	const num = (v: number | undefined) => (v ? String(v) : '');

	const [conceptId, setConceptId] = useState(sale?.conceptId ?? '');
	const [description, setDescription] = useState(sale?.description ?? '');
	const [currency, setCurrency] = useState<Currency>(sale?.currency ?? 'UYU');
	const [saleAmount, setSaleAmount] = useState(num(sale?.saleAmount));
	const [cost, setCost] = useState(num(sale?.cost));
	const [commission, setCommission] = useState(num(sale?.commission));
	const [shipping, setShipping] = useState(num(sale?.shipping));
	const [other, setOther] = useState(num(sale?.other));
	const [fxRate, setFxRate] = useState(
		sale && sale.currency === 'UYU' ? String(sale.fxRate) : ''
	);
	const [saleDate, setSaleDate] = useState(
		sale ? toISODate(sale.created_at) : todayISODate()
	);
	const [newConcept, setNewConcept] = useState('');
	const [showConcepts, setShowConcepts] = useState(false);
	const [items, setItems] = useState<ManualSaleItem[]>(sale?.items ?? []);

	// Datos del comprador: los mismos que cargaría él comprando por la web. Con
	// el mail cargado, la venta queda asociada al cliente y se le puede mandar la
	// confirmación.
	const [cliente, setCliente] = useState({
		fullName: sale?.customer?.fullName ?? '',
		email: sale?.customer?.email ?? '',
		phone: sale?.customer?.phone ?? '',
	});
	const [direccion, setDireccion] = useState({
		line1: sale?.address?.line1 ?? '',
		line2: sale?.address?.line2 ?? '',
		city: sale?.address?.city ?? '',
		state: sale?.address?.state ?? '',
		postalCode: sale?.address?.postalCode ?? '',
	});
	// Cómo paga y si ya pagó. Antes esto no se preguntaba: la venta se guardaba
	// sin método y el listado la mostraba como MercadoPago.
	// Arranca VACÍO a propósito, también en el alta: el bug que reportó el dueño
	// era justamente que la venta se guardaba con un método que nadie eligió.
	// En una venta vieja, dejarlo vacío manda null y el RPC no lo toca.
	const [metodoPago, setMetodoPago] = useState<ManualPaymentMethod | ''>(
		sale?.paymentMethod ?? ''
	);
	const [yaCobrada, setYaCobrada] = useState(sale ? sale.paid : true);
	const [montoMp, setMontoMp] = useState(
		sale?.paymentSplit ? String(Math.round(sale.paymentSplit.mercadopago * 100) / 100) : ''
	);

	const [quiereFactura, setQuiereFactura] = useState(!!sale?.invoice);
	const [factura, setFactura] = useState({
		rut: sale?.invoice?.rut ?? '',
		businessName: sale?.invoice?.businessName ?? '',
		tradeName: sale?.invoice?.tradeName ?? '',
		address: sale?.invoice?.address ?? '',
		city: sale?.invoice?.city ?? '',
		state: sale?.invoice?.state ?? '',
		email: sale?.invoice?.email ?? '',
	});
	const rutDigits = factura.rut.replace(/\D/g, '');

	const n = (s: string) => Number(s) || 0;
	const cobrada = yaCobrada;
	const esCombinado = metodoPago === 'hybrid';
	const restoTransfer = Math.round((n(saleAmount) - n(montoMp)) * 100) / 100;
	const splitOk =
		!esCombinado || (n(montoMp) > 0 && restoTransfer > 0);

	const grossProfit = n(saleAmount) - n(cost);
	const profit = grossProfit - n(commission) - n(shipping) - n(other);
	const effectiveFx = currency === 'UYU' ? n(fxRate) || fx?.rate || 0 : 1;
	const saving = createSale.isPending || updateSale.isPending;

	const handleSubmit = () => {
		if (n(saleAmount) <= 0) {
			alert('Ingresá el precio de venta.');
			return;
		}
		if (currency === 'UYU' && effectiveFx <= 0) {
			alert('Falta la cotización del dólar (pesos por USD).');
			return;
		}
		// El mail es lo único que hace falta para asociar la venta a un cliente;
		// si lo cargaron mal, mejor frenar acá que crear un cliente basura.
		if (cliente.email.trim() && !/^.+@.+\..+$/.test(cliente.email.trim())) {
			alert('El email del cliente no es válido.');
			return;
		}
		// En el alta el método es obligatorio: guardarlo sin elegir es exactamente
		// el bug que hacía figurar todas las ventas como MercadoPago.
		if (!isEdit && !metodoPago) {
			alert('Elegí el método de pago de la venta.');
			return;
		}
		if (esCombinado && !splitOk) {
			alert(
				'En el pago combinado los dos montos tienen que ser mayores a cero y sumar el total.'
			);
			return;
		}
		// Sin mail del cliente no hay a quién mandarle el cobro.
		if (!cobrada && !cliente.email.trim() && metodoPago !== 'transfer') {
			alert(
				'Para poder mandarle el cobro hace falta el mail del cliente.\n\n' +
					'Si no lo tenés, cargala como ya cobrada o elegí transferencia (ahí los datos se los pasás vos).'
			);
			return;
		}
		if (quiereFactura) {
			if (rutDigits.length !== 12) {
				alert('El RUT tiene que tener 12 dígitos.');
				return;
			}
			if (!factura.businessName.trim() || !factura.address.trim()) {
				alert('Para la factura hacen falta razón social y domicilio fiscal.');
				return;
			}
		}
		const input = {
			conceptId: conceptId || null,
			description,
			currency,
			saleAmount: n(saleAmount),
			cost: n(cost),
			commission: n(commission),
			shipping: n(shipping),
			other: n(other),
			fxRate: effectiveFx,
			saleDate: saleDate
				? new Date(`${saleDate}T12:00:00`).toISOString()
				: null,
			paymentMethod: metodoPago || null,
			paid: cobrada,
			paymentSplit: esCombinado
				? { mercadopago: n(montoMp), transfer: restoTransfer }
				: null,
			items,
			customer: cliente.email.trim()
				? {
						fullName: cliente.fullName,
						email: cliente.email,
						phone: cliente.phone ?? '',
				  }
				: null,
			address: direccion.line1.trim() ? direccion : null,
			invoice: quiereFactura ? factura : null,
		};
		if (sale) updateSale.mutate({ id: sale.id, input }, { onSuccess: onClose });
		else createSale.mutate(input, { onSuccess: onClose });
	};

	const addItem = (item: ManualSaleItem) =>
		setItems(prev => [...prev, item]);
	const removeItem = (idx: number) =>
		setItems(prev => prev.filter((_, i) => i !== idx));

	return (
		<div className='space-y-4'>
			<div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
				<Field label='Concepto'>
					<div className='flex gap-2'>
						<select
							className='inp'
							value={conceptId}
							onChange={e => setConceptId(e.target.value)}
						>
							<option value=''>Sin concepto</option>
							{concepts.map(c => (
								<option key={c.id} value={c.id}>
									{c.name}
								</option>
							))}
						</select>
						<button
							type='button'
							onClick={() => setShowConcepts(v => !v)}
							className='shrink-0 rounded-lg border border-ink-300 px-3 text-sm font-semibold text-ink-600 hover:bg-ink-50'
							title='Gestionar conceptos'
						>
							{showConcepts ? 'Listo' : 'Conceptos'}
						</button>
					</div>
				</Field>
				<Field label='Fecha'>
					<input
						type='date'
						className='inp'
						value={saleDate}
						max={todayISODate()}
						onChange={e => setSaleDate(e.target.value)}
					/>
				</Field>
			</div>

			{showConcepts && (
				<div className='space-y-2 rounded-xl border border-ink-200 bg-ink-50/50 p-3'>
					<div className='flex flex-wrap gap-2'>
						{concepts.length === 0 ? (
							<span className='text-xs text-ink-400'>
								Todavía no hay conceptos.
							</span>
						) : (
							concepts.map(c => (
								<span
									key={c.id}
									className='inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-sm font-medium text-ink-700 ring-1 ring-ink-200'
								>
									{c.name}
									<button
										onClick={() => {
											if (
												confirm(
													`¿Eliminar el concepto "${c.name}"? Las ventas registradas no se borran.`
												)
											)
												deleteConcept.mutate(c.id);
										}}
										className='text-ink-400 hover:text-rose-600'
										aria-label='Eliminar concepto'
									>
										<HiOutlineTrash size={14} />
									</button>
								</span>
							))
						)}
					</div>
					<div className='flex gap-2'>
						<input
							className='inp'
							value={newConcept}
							onChange={e => setNewConcept(e.target.value)}
							placeholder='Nuevo concepto (ej: Sunfer)'
							onKeyDown={e => {
								if (e.key === 'Enter' && newConcept.trim()) {
									e.preventDefault();
									createConcept.mutate(
										{ name: newConcept },
										{ onSuccess: () => setNewConcept('') }
									);
								}
							}}
						/>
						<button
							type='button'
							onClick={() =>
								newConcept.trim() &&
								createConcept.mutate(
									{ name: newConcept },
									{ onSuccess: () => setNewConcept('') }
								)
							}
							disabled={createConcept.isPending || !newConcept.trim()}
							className='shrink-0 rounded-lg border border-ink-300 px-4 text-sm font-semibold text-ink-700 hover:bg-ink-50 disabled:opacity-50'
						>
							Agregar
						</button>
					</div>
				</div>
			)}

			<Field label='Descripción'>
				<input
					className='inp'
					value={description}
					onChange={e => setDescription(e.target.value)}
					placeholder='Qué vendiste'
				/>
			</Field>

			{/* Datos del comprador: los mismos que cargaría comprando por la web.
			    Con el mail, la venta queda asociada al cliente (aparece en su
			    historial) y se le puede mandar la confirmación de compra. */}
			<div className='space-y-3 rounded-xl border border-ink-200 bg-ink-50/40 p-3'>
				<p className='text-xs font-semibold uppercase tracking-wider text-ink-500'>
					Datos del cliente (opcional — con el mail se le puede enviar la confirmación)
				</p>
				<div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
					<Field label='Nombre y apellido'>
						<input
							className='inp'
							value={cliente.fullName}
							onChange={e => setCliente({ ...cliente, fullName: e.target.value })}
							placeholder='Juan Pérez'
						/>
					</Field>
					<Field label='Email'>
						<input
							type='email'
							className='inp'
							value={cliente.email}
							onChange={e => setCliente({ ...cliente, email: e.target.value })}
							placeholder='cliente@mail.com'
						/>
					</Field>
					<Field label='Teléfono'>
						<input
							className='inp'
							value={cliente.phone ?? ''}
							onChange={e => setCliente({ ...cliente, phone: e.target.value })}
							placeholder='099 123 456'
						/>
					</Field>
				</div>

				<div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
					<Field label='Dirección de entrega'>
						<input
							className='inp'
							value={direccion.line1}
							onChange={e => setDireccion({ ...direccion, line1: e.target.value })}
							placeholder='Calle y número'
						/>
					</Field>
					<Field label='Apartamento / referencias'>
						<input
							className='inp'
							value={direccion.line2 ?? ''}
							onChange={e => setDireccion({ ...direccion, line2: e.target.value })}
						/>
					</Field>
					<Field label='Ciudad / localidad'>
						<input
							className='inp'
							value={direccion.city}
							onChange={e => setDireccion({ ...direccion, city: e.target.value })}
						/>
					</Field>
					<Field label='Departamento'>
						<input
							className='inp'
							value={direccion.state}
							onChange={e => setDireccion({ ...direccion, state: e.target.value })}
						/>
					</Field>
				</div>

				{/* ── Cobro ───────────────────────────────────────────────────── */}
				<div className='rounded-lg border border-ink-200 bg-ink-50/50 p-3'>
					<h4 className='mb-3 text-xs font-semibold uppercase tracking-wide text-ink-600'>
						Cobro
					</h4>

					<div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
						<Field label='Método de pago'>
							<select
								className='inp'
								value={metodoPago}
								onChange={e =>
									setMetodoPago(e.target.value as ManualPaymentMethod | '')
								}
							>
								<option value=''>Elegí cómo paga…</option>
								{/* Sólo los métodos que ofrece una venta manual. `deposit`
								    existe en la web pero acá no se ofrece; si una venta vieja
								    lo tuviera, se agrega abajo para no perderlo al editar. */}
								{manualPaymentMethodOptions.map(m => (
									<option key={m} value={m}>
										{manualPaymentMethodLabels[m]}
									</option>
								))}
								{sale?.paymentMethod &&
									!manualPaymentMethodOptions.includes(sale.paymentMethod) && (
										<option value={sale.paymentMethod}>
											{manualPaymentMethodLabels[sale.paymentMethod]}
										</option>
									)}
							</select>
							{isEdit && metodoPago === '' && (
								<span className='mt-1 block text-[11px] text-ink-500'>
									Venta vieja sin método. Elegilo sólo si sabés cuál fue: si lo
									dejás así, no se toca.
								</span>
							)}
						</Field>

						<Field label='Estado del cobro'>
							<select
								className='inp'
								value={cobrada ? 'paid' : 'pending'}
								onChange={e => setYaCobrada(e.target.value === 'paid')}
							>
								<option value='paid'>Ya cobrada</option>
								<option value='pending'>Pendiente de cobro</option>
							</select>
						</Field>
					</div>

					{esCombinado && (
						<div className='mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2'>
							<Field label={`Con MercadoPago (${currency})`}>
								<input
									className='inp'
									inputMode='decimal'
									value={montoMp}
									onChange={e => setMontoMp(e.target.value)}
								/>
							</Field>
							<Field label={`Por transferencia (${currency})`}>
								<input
									className='inp bg-ink-100'
									value={restoTransfer > 0 ? restoTransfer : ''}
									readOnly
								/>
								<span className='mt-1 block text-[11px] text-ink-500'>
									Se calcula solo: el resto del total.
								</span>
							</Field>
							{!splitOk && n(saleAmount) > 0 && (
								<p className='sm:col-span-2 text-[12px] text-rose-600'>
									Los dos montos tienen que ser mayores a cero.
								</p>
							)}
						</div>
					)}

					{!cobrada && (
						<p className='mt-3 rounded-md bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900'>
							{metodoPago === 'transfer' ? (
								<>
									Queda <b>Pendiente</b> y <b>no descuenta stock</b> hasta que
									registres el cobro. Los datos de la cuenta se los pasás vos: en
									transferencia no se manda mail.
								</>
							) : (
								<>
									Queda <b>Pendiente</b> y <b>no descuenta stock</b> hasta que
									entre la plata. Al guardar vas a poder mandarle el cobro por
									mail desde el detalle de la venta.
								</>
							)}
						</p>
					)}
				</div>

				<label className='flex items-center gap-2 pt-1 text-sm'>
					<input
						type='checkbox'
						checked={quiereFactura}
						onChange={e => setQuiereFactura(e.target.checked)}
					/>
					<span className='font-medium text-ink-700'>Pide factura con RUT</span>
				</label>

				{quiereFactura && (
					<div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
						<Field label='RUT (12 dígitos)'>
							<input
								className='inp'
								value={factura.rut}
								onChange={e => setFactura({ ...factura, rut: e.target.value })}
							/>
							{factura.rut && rutDigits.length !== 12 && (
								<span className='mt-1 block text-[11px] text-rose-600'>
									Van {rutDigits.length} de 12.
								</span>
							)}
						</Field>
						<Field label='Razón social'>
							<input
								className='inp'
								value={factura.businessName}
								onChange={e =>
									setFactura({ ...factura, businessName: e.target.value })
								}
							/>
						</Field>
						<Field label='Domicilio fiscal'>
							<input
								className='inp'
								value={factura.address}
								onChange={e => setFactura({ ...factura, address: e.target.value })}
							/>
						</Field>
						<Field label='Mail para la factura'>
							<input
								type='email'
								className='inp'
								value={factura.email ?? ''}
								onChange={e => setFactura({ ...factura, email: e.target.value })}
								placeholder={cliente.email || 'Opcional'}
							/>
						</Field>
					</div>
				)}
			</div>

			{/* Productos del catálogo: opcional. Si agregás, descuentan stock (RF + ML). */}
			<div className='space-y-2 rounded-xl border border-ink-200 bg-ink-50/40 p-3'>
				<p className='text-xs font-semibold uppercase tracking-wider text-ink-500'>
					Productos del catálogo (opcional — descuentan stock en RF y ML)
				</p>
				{items.length > 0 && (
					<ul className='space-y-1'>
						{items.map((it, idx) => (
							<li
								key={idx}
								className='flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-1.5 text-sm ring-1 ring-ink-200'
							>
								<span className='min-w-0 truncate text-ink-700'>
									<b>{it.quantity}×</b> {it.label}
								</span>
								<button
									type='button'
									onClick={() => removeItem(idx)}
									className='shrink-0 text-ink-400 hover:text-rose-600'
									aria-label='Quitar producto'
								>
									<HiOutlineTrash size={14} />
								</button>
							</li>
						))}
					</ul>
				)}
				<ProductPicker onAdd={addItem} />
				<p className='text-[11px] text-ink-400'>
					Si es una venta externa de algo que no tenés cargado en RF, dejalo
					vacío.
				</p>
			</div>

			<div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
				<Field label='Moneda'>
					<select
						className='inp'
						value={currency}
						onChange={e => setCurrency(e.target.value as Currency)}
					>
						<option value='UYU'>Pesos (UYU)</option>
						<option value='USD'>Dólares (USD)</option>
					</select>
				</Field>
				{currency === 'UYU' && (
					<Field label='Cotización (pesos por USD)'>
						<input
							type='number'
							className='inp'
							value={fxRate}
							min={0}
							onChange={e => setFxRate(e.target.value)}
							placeholder={
								fx?.rate ? `${fx.rate.toFixed(2)} (BROU hoy)` : 'rate'
							}
						/>
					</Field>
				)}
				<Field label={`Precio de venta (${currency})`}>
					<input
						type='number'
						className='inp'
						value={saleAmount}
						min={0}
						onChange={e => setSaleAmount(e.target.value)}
						placeholder='0'
					/>
				</Field>
				<Field label={`Costo (${currency})`}>
					<input
						type='number'
						className='inp'
						value={cost}
						min={0}
						onChange={e => setCost(e.target.value)}
						placeholder='0'
					/>
				</Field>
				<Field label={`Comisión (${currency})`}>
					<input
						type='number'
						className='inp'
						value={commission}
						min={0}
						onChange={e => setCommission(e.target.value)}
						placeholder='0'
					/>
				</Field>
				<Field label={`Envío (${currency})`}>
					<input
						type='number'
						className='inp'
						value={shipping}
						min={0}
						onChange={e => setShipping(e.target.value)}
						placeholder='0'
					/>
				</Field>
				<Field label={`Otros costos (${currency})`}>
					<input
						type='number'
						className='inp'
						value={other}
						min={0}
						onChange={e => setOther(e.target.value)}
						placeholder='0'
					/>
				</Field>
			</div>

			<div className='flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-4'>
				<div className='text-sm'>
					<p>
						Ganancia neta:{' '}
						<span
							className={`font-bold ${
								profit >= 0 ? 'text-emerald-600' : 'text-rose-600'
							}`}
						>
							{formatMoneyCur(profit, currency)}
						</span>
					</p>
					<p className='text-xs text-ink-400'>
						Bruta (s/costo): {formatMoneyCur(grossProfit, currency)}
					</p>
				</div>
				<div className='flex gap-2'>
					<button
						onClick={onClose}
						className='rounded-full border border-ink-300 px-5 py-2 text-sm font-semibold text-ink-700 hover:bg-ink-50'
					>
						Cancelar
					</button>
					<button
						onClick={handleSubmit}
						disabled={saving}
						className='rounded-full bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60'
					>
						{saving
							? 'Guardando…'
							: isEdit
							? 'Guardar cambios'
							: 'Registrar venta'}
					</button>
				</div>
			</div>
		</div>
	);
};

const Field = ({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) => (
	<div>
		<label className='mb-1 block text-xs font-medium text-ink-600'>
			{label}
		</label>
		{children}
	</div>
);

// Busca un producto del catálogo, elige variante y cantidad, y lo agrega a la venta.
const ProductPicker = ({ onAdd }: { onAdd: (item: ManualSaleItem) => void }) => {
	const [search, setSearch] = useState('');
	const [debounced, setDebounced] = useState('');
	const [product, setProduct] = useState<ProductRow | null>(null);
	const [variantId, setVariantId] = useState('');
	const [qty, setQty] = useState(1);

	useEffect(() => {
		const t = setTimeout(() => setDebounced(search), 350);
		return () => clearTimeout(t);
	}, [search]);

	const { data: results = [] } = useQuery({
		queryKey: ['manual-product-search', debounced],
		queryFn: async () => {
			if (debounced.trim().length < 2) return [] as ProductRow[];
			const { data } = await (supabase as any)
				.from('products')
				.select('id, name, variants(id, color_name, storage, stock)')
				.ilike('name', `%${debounced.trim()}%`)
				.limit(8);
			return (data ?? []) as ProductRow[];
		},
	});

	const variant = product?.variants.find(v => v.id === variantId) ?? null;

	const handleAdd = () => {
		if (!product || !variant || qty <= 0) return;
		const variantLabel = [variant.color_name, variant.storage]
			.filter(Boolean)
			.join(' / ');
		onAdd({
			variantId: variant.id,
			quantity: qty,
			label: [product.name, variantLabel].filter(Boolean).join(' · '),
		});
		setProduct(null);
		setVariantId('');
		setQty(1);
		setSearch('');
	};

	if (!product) {
		return (
			<div>
				<input
					className='inp'
					value={search}
					onChange={e => setSearch(e.target.value)}
					placeholder='Buscar producto por nombre…'
				/>
				{results.length > 0 && (
					<ul className='mt-1 max-h-40 overflow-auto rounded-lg border border-ink-100 bg-white text-sm'>
						{results.map(p => (
							<li key={p.id}>
								<button
									type='button'
									onClick={() => {
										setProduct(p);
										setVariantId(p.variants[0]?.id ?? '');
									}}
									className='block w-full px-3 py-1.5 text-left hover:bg-ink-50'
								>
									{p.name}
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
		);
	}

	return (
		<div className='space-y-2 rounded-lg border border-brand-200 bg-white p-2'>
			<div className='flex items-center justify-between gap-2'>
				<span className='min-w-0 truncate text-sm font-medium text-ink-800'>
					{product.name}
				</span>
				<button
					type='button'
					onClick={() => setProduct(null)}
					className='shrink-0 text-xs font-semibold text-ink-500 hover:text-ink-800'
				>
					Cambiar
				</button>
			</div>
			<div className='flex flex-wrap items-center gap-2'>
				<select
					className='inp flex-1'
					value={variantId}
					onChange={e => setVariantId(e.target.value)}
				>
					{product.variants.map(v => (
						<option key={v.id} value={v.id}>
							{[v.color_name, v.storage].filter(Boolean).join(' / ') ||
								'Única'}{' '}
							(stock {v.stock})
						</option>
					))}
				</select>
				<input
					type='number'
					min={1}
					value={qty}
					onChange={e => setQty(Math.max(1, Number(e.target.value) || 1))}
					className='inp w-20'
				/>
				<button
					type='button'
					onClick={handleAdd}
					className='inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700'
				>
					<HiOutlinePlus size={16} /> Agregar
				</button>
			</div>
		</div>
	);
};
