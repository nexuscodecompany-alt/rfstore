import { Link, useParams } from 'react-router-dom';
import { useOrder, useUser, useUsdUyuRate } from '../hooks';
import { Loader } from '../components/shared/Loader';
import { CiCircleCheck } from 'react-icons/ci';
import { formatPrice, shippingSummary, type ShippingZoneName } from '../helpers';
import { useEffect, useState } from 'react';
import {
	getAppSettings,
	uploadPaymentProof,
	notifyPaymentProofUploaded,
	getPlacetopayStatus,
	type PlacetopayStatus,
} from '../actions';
import { useCartStore } from '../store/cart.store';
import toast from 'react-hot-toast';
import { HiOutlineCloudUpload, HiOutlineMail } from 'react-icons/hi';
import { FaWhatsapp } from 'react-icons/fa';
import { trackPurchase } from '../lib/pixel';

interface TransferInfo {
	banco?: string;
	titular?: string;
	rut?: string;
	moneda?: string;
	cuenta_santander?: string;
	sucursal_santander?: string;
	cuenta_externa?: string;
}

export const ThankyouPage = () => {
	const { id } = useParams<{ id: string }>();

	const { data, isLoading, isError } = useOrder(Number(id));
	const { isLoading: isLoadingSession } = useUser();
	const [transferInfo, setTransferInfo] = useState<TransferInfo | null>(null);
	const { data: fx } = useUsdUyuRate();
	const cleanCart = useCartStore(s => s.cleanCart);

	// Pago con tarjeta (Getnet): el resultado se consulta al servidor, que a su
	// vez le pregunta a Placetopay si todavía no llegó el aviso.
	const [ptp, setPtp] = useState<PlacetopayStatus | null>(null);
	const isPtp = data?.paymentMethod === 'placetopay';
	useEffect(() => {
		if (!isPtp || !data) return;
		let stop = false;
		let tries = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const tick = async () => {
			try {
				const r = await getPlacetopayStatus(data.id);
				if (stop) return;
				setPtp(r);
				if (r.result !== 'pending') return;
			} catch (e) {
				console.warn('placetopay-status:', e);
			}
			tries++;
			// Primero seguido (el aviso suele llegar en segundos), después más espaciado.
			if (!stop && tries < 40) timer = setTimeout(tick, tries < 10 ? 3000 : 10000);
		};
		tick();
		return () => {
			stop = true;
			if (timer) clearTimeout(timer);
		};
	}, [isPtp, data]);

	// Limpiamos el carrito recién cuando el cliente llega a la confirmación.
	// Antes lo limpiábamos antes del redirect a MP, lo que causaba un flash
	// momentáneo de "carrito vacío". Con tarjeta (Getnet) sólo se limpia con el
	// pago APROBADO: si se rechazó o sigue sin resolverse, el carrito queda para
	// volver a intentar.
	useEffect(() => {
		if (!data) return; // hasta saber el medio de pago
		if (isPtp && ptp?.result !== 'paid') return;
		cleanCart();
	}, [cleanCart, data, isPtp, ptp]);

	// Meta Pixel: Purchase cuando la orden confirmada está cargada.
	// trackPurchase deduplica por id de orden (no cuenta de más si refrescan).
	useEffect(() => {
		if (!data) return;
		// Con tarjeta (Getnet) sólo cuenta como compra si el pago se aprobó.
		if (data.paymentMethod === 'placetopay' && ptp?.result !== 'paid') return;
		trackPurchase(
			data.id,
			data.orderItems.map((item: any) => ({
				// content_id = id del producto (igual que en el feed del catálogo).
				id: (item as any).productId || item.productName,
				quantity: item.quantity,
				price: item.price,
			})),
			data.totalAmount
		);
	}, [data, ptp?.result]);

	useEffect(() => {
		// El pago combinado también necesita los datos bancarios: una de sus dos
		// partes se abona por transferencia.
		if (data?.paymentMethod !== 'transfer' && data?.paymentMethod !== 'hybrid')
			return;
		(async () => {
			try {
				const map = await getAppSettings();
				setTransferInfo((map.get('payment_transfer_info') as TransferInfo) ?? null);
			} catch (e) {
				console.warn('settings:', e);
			}
		})();
	}, [data?.paymentMethod]);

	// Sin sesión no se puede leer el pedido: pasa si se compró como invitado y el
	// pago (MercadoPago o tarjeta) volvió en otro navegador o en otro celular. El
	// pedido existe igual y el detalle le llega por mail.
	if (isError)
		return (
			<div className='mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-24 text-center'>
				<CiCircleCheck size={64} className='text-emerald-600' />
				<p className='text-lg font-semibold'>Recibimos tu pedido #{id}</p>
				<p className='text-sm text-slate-600'>
					Te mandamos el detalle y el estado del pago a tu mail. Si tenés alguna duda,
					escribinos por WhatsApp al 098 732 327.
				</p>
				<Link
					to='/'
					className='rounded-full bg-black px-7 py-4 text-xs font-semibold uppercase tracking-widest text-white'
				>
					Volver a la tienda
				</Link>
			</div>
		);

	if (isLoading || !data || isLoadingSession) return <Loader />;

	const userName = data.customer.full_name || '';
	// Cotización CONGELADA en la orden: es la que vio el cliente al comprar y la
	// misma que sale en el mail. Sólo si la orden no la tiene (órdenes viejas)
	// caemos a la del día.
	const totalUyu =
		data.totalUyuFrozen != null
			? Math.round(Number(data.totalUyuFrozen))
			: data.fxRate
			? Math.round(data.totalAmount * Number(data.fxRate))
			: fx
			? Math.round(data.totalAmount * fx.rate)
			: null;
	const formatUyu = (n: number) => `UYU ${n.toLocaleString('es-UY')}`;
	// Envío: mismo texto que el checkout y los mails.
	const shippingInfo = shippingSummary({
		zone: data.shipping.zone as ShippingZoneName | null,
		barrio: data.shipping.barrio,
		department: data.shipping.department,
		costUsd: data.shipping.costUsd,
		freeByThreshold:
			(data.shipping.zone === 'montevideo' || data.shipping.zone === 'canelones') &&
			data.shipping.costUsd === 0,
	});

	return (
		<div className='flex flex-col h-screen'>
			<header className='flex flex-col items-center justify-center px-10 py-12 text-black'>
			<Link
    to='/'
    className='self-center md:self-start' // Mantenemos las clases de alineación
>
    <img
        src="/img/img-docs/logoblancorf.jpg" // La ruta correcta a tu imagen
        alt="Logo de RF Store"
        className="h-14 w-auto" // Ajusta el tamaño aquí (ej. h-14 son 56px de alto)
    />
</Link>
			</header>

			<main className='container flex flex-col items-center flex-1 gap-10'>
				<div className='flex items-center gap-3'>
					<CiCircleCheck size={40} />

					<p className='text-4xl'>
						{userName ? `¡Gracias, ${userName}!` : '¡Gracias!'}
					</p>
				</div>

				{isPtp && <PlacetopayResult status={ptp} />}

				{/* Pago combinado: lo primero que tiene que entender el cliente es que
				    su pedido no se procesa hasta que estén las DOS partes. */}
				{data.paymentMethod === 'hybrid' && data.paymentSplit && (
					<div className='w-full space-y-2 rounded-md border-2 border-blue-200 bg-blue-50/70 p-5 md:w-[600px]'>
						<h3 className='font-bold text-blue-900'>
							Tu pedido es con pago combinado
						</h3>
						<div className='flex justify-between text-sm text-blue-900'>
							<span>Con MercadoPago</span>
							<span className='font-semibold tabular-nums'>
								USD {(Number(data.paymentSplit.mercadopago) || 0).toFixed(2)}
							</span>
						</div>
						<div className='flex justify-between text-sm text-blue-900'>
							<span>Por transferencia</span>
							<span className='font-semibold tabular-nums'>
								USD {(Number(data.paymentSplit.transfer) || 0).toFixed(2)}
							</span>
						</div>
						<p className='border-t border-blue-200 pt-2 text-[13px] leading-relaxed text-blue-800'>
							<b>Procesamos tu pedido cuando estén acreditados los dos pagos.</b> Te
							lo reservamos por <b>24 horas</b>: pasado ese plazo, si no entraron las
							dos partes, la reserva se libera.
						</p>
					</div>
				)}

				{(data.paymentMethod === 'transfer' || data.paymentMethod === 'hybrid') && (
					<div className='border-2 border-emerald-200 bg-emerald-50/60 w-full p-5 rounded-md space-y-3 md:w-[600px]'>
						<div className='flex items-center justify-between'>
							<h3 className='font-bold text-emerald-900'>
								{data.paymentMethod === 'hybrid'
									? `Datos para la parte por transferencia — Pedido #${data.id}`
									: `Datos para transferir — Pedido #${data.id}`}
							</h3>
							<span className='text-xs text-emerald-700 font-medium'>
								Te mandamos también un mail
							</span>
						</div>
						<TransferDetails
							info={transferInfo}
							orderId={data.id}
							// En el combinado se transfiere SÓLO esa parte, no el total.
							totalAmount={
								data.paymentMethod === 'hybrid' && data.paymentSplit
									? Number(data.paymentSplit.transfer) || 0
									: data.totalAmount
							}
							totalUyu={
								data.paymentMethod === 'hybrid' && data.paymentSplit && data.fxRate
									? Math.round(
											(Number(data.paymentSplit.transfer) || 0) * Number(data.fxRate)
									  )
									: totalUyu
							}
							formatUyu={formatUyu}
						/>
					</div>
				)}

				{(data.paymentMethod === 'transfer' ||
					data.paymentMethod === 'deposit' ||
					data.paymentMethod === 'hybrid') && (
					<PaymentProofBlock orderId={data.id} />
				)}

				<div className='border border-slate-200 w-full p-5 rounded-md space-y-3 md:w-[600px]'>
					<h3 className='font-medium'>Detalles del pedido</h3>

					<div className='flex flex-col gap-5'>
						<ul className='space-y-3'>
							{data.orderItems.map((item: any, index: number) => (
								<li
									key={index}
									className='flex items-center justify-between gap-3'
								>
									<div className='flex'>
										<img
											src={item.productImage}
											alt={item.productName}
											className='object-contain w-16 h-16'
										/>
									</div>

									<div className='flex-1 space-y-2'>
										<div className='flex justify-between'>
											<p className='font-semibold'>
												{item.productName}
											</p>
											<p className='mt-1 text-sm font-medium text-gray-600'>
												{formatPrice(item.price)} x {item.quantity}
											</p>
										</div>
									</div>
								</li>
							))}
						</ul>

						{/* Desglose: sin la línea de envío, una compra al interior mostraba
						    un total igual al subtotal y se leía como "envío incluido". */}
						{shippingInfo.zoneLabel && (
							<div className='flex justify-between items-start text-sm text-gray-600'>
								<span>Envío ({shippingInfo.zoneLabel})</span>
								<span>{shippingInfo.label}</span>
							</div>
						)}
						{data.discountUsd > 0 && (
							<div className='flex justify-between items-start text-sm text-emerald-700'>
								<span>Descuento{data.couponCode ? ` (${data.couponCode})` : ''}</span>
								<span>- {formatPrice(data.discountUsd)}</span>
							</div>
						)}

						<div className='flex justify-between items-start'>
							<span className='font-semibold'>Total:</span>
							<div className='text-right'>
								<p className='font-semibold'>
									{formatPrice(data.totalAmount)}
								</p>
								{totalUyu !== null && (
									<p className='text-xs text-gray-500'>
										≈ {formatUyu(totalUyu)} (al BROU)
									</p>
								)}
							</div>
						</div>

						{shippingInfo.note && (
							<p className='rounded-md bg-amber-50 p-2 text-xs text-amber-800'>
								{shippingInfo.note}
							</p>
						)}
					</div>
				</div>

				<div className='flex flex-col justify-between items-center w-full mb-5 gap-3 sm:flex-row md:w-[600px] md:gap-0'>
					<p className='text-sm'>
						¿Necesitas ayuda? Ponte en contacto con nosotros
					</p>

					<Link
						to='/tienda'
						className='px-5 py-4 text-sm font-semibold tracking-tight text-white bg-black rounded-md'
					>
						Seguir comprando
					</Link>
				</div>
			</main>
		</div>
	);
};

interface TransferDetailsProps {
	info: TransferInfo | null;
	orderId: number;
	totalAmount: number;
	totalUyu: number | null;
	formatUyu: (n: number) => string;
}

const TransferDetails = ({ info, orderId, totalAmount, totalUyu, formatUyu }: TransferDetailsProps) => {
	const Row = ({ label, value }: { label: string; value?: string }) => {
		if (!value || !value.trim()) return null;
		return (
			<div className='flex justify-between border-b border-emerald-100 pb-2'>
				<span className='text-emerald-800'>{label}</span>
				<span className='font-semibold text-ink-900'>{value}</span>
			</div>
		);
	};

	const hasSantander =
		!!info?.cuenta_santander?.trim() || !!info?.sucursal_santander?.trim();
	const hasExterna = !!info?.cuenta_externa?.trim();

	return (
		<div className='grid grid-cols-1 gap-2 text-sm'>
			<Row label='Banco' value={info?.banco} />
			<Row label='Titular' value={info?.titular} />
			<Row label='RUT' value={info?.rut} />
			<Row label='Moneda' value={info?.moneda} />

			{hasSantander && (
				<div className='mt-2 border border-emerald-200 rounded-md p-3 bg-white/40'>
					<p className='text-xs font-semibold uppercase tracking-wider text-emerald-800 mb-2'>
						Transferencias dentro de Santander
					</p>
					<div className='space-y-2'>
						<Row label='Cuenta' value={info?.cuenta_santander} />
						<Row label='Sucursal' value={info?.sucursal_santander} />
					</div>
				</div>
			)}

			{hasExterna && (
				<div className='mt-2 border border-emerald-200 rounded-md p-3 bg-white/40'>
					<p className='text-xs font-semibold uppercase tracking-wider text-emerald-800 mb-2'>
						Transferencias desde otros bancos
					</p>
					<Row label='Cuenta' value={info?.cuenta_externa} />
				</div>
			)}

			<div className='flex justify-between items-start border-b border-emerald-100 pb-2 mt-2'>
				<span className='text-emerald-800'>Monto</span>
				<div className='text-right'>
					<p className='font-bold text-ink-900'>{formatPrice(totalAmount)}</p>
					{totalUyu !== null && (
						<p className='text-xs text-emerald-800'>
							≈ {formatUyu(totalUyu)} (al BROU)
						</p>
					)}
				</div>
			</div>
			<div className='flex justify-between'>
				<span className='text-emerald-800'>Concepto</span>
				<span className='font-semibold text-ink-900'>Pedido {orderId}</span>
			</div>
		</div>
	);
};

const SALES_EMAIL = 'ventas@rfstore.uy';
const SALES_WHATSAPP = '59898732327';

const PaymentProofBlock = ({ orderId }: { orderId: number }) => {
	const [file, setFile] = useState<File | null>(null);
	const [uploading, setUploading] = useState(false);
	const [uploaded, setUploaded] = useState(false);

	const handleUpload = async () => {
		if (!file) return;
		setUploading(true);
		try {
			await uploadPaymentProof(orderId, file);
			setUploaded(true);
			toast.success('Comprobante recibido. Vamos a verificarlo.');
			// Aviso al admin. No bloqueamos ni mostramos error al cliente: el
			// comprobante ya quedó guardado, el mail es sólo la alerta interna.
			notifyPaymentProofUploaded(orderId).catch(err =>
				console.warn('No se pudo avisar al admin del comprobante:', err)
			);
		} catch (err) {
			toast.error((err as Error).message || 'No se pudo subir el comprobante');
		} finally {
			setUploading(false);
		}
	};

	const mailSubject = encodeURIComponent(`Comprobante de pago — Pedido #${orderId}`);
	const mailBody = encodeURIComponent(
		`Hola, adjunto el comprobante del pago para el pedido #${orderId}. Gracias.`
	);
	const waText = encodeURIComponent(
		`Hola, te envío el comprobante de pago del pedido #${orderId}.`
	);

	return (
		<div className='w-full p-5 border-2 border-amber-200 bg-amber-50/60 rounded-md space-y-4 md:w-[600px]'>
			<h3 className='font-bold text-amber-900'>
				Enviar comprobante de pago
			</h3>
			<p className='text-sm text-amber-900/90 leading-relaxed'>
				Una vez hagas el pago, mandanos el comprobante por cualquiera de estas vías. En cuanto lo verifiquemos despachamos tu pedido.
			</p>

			{!uploaded ? (
				<div className='border border-amber-200 rounded-md bg-white p-4 space-y-3'>
					<div className='flex items-center gap-2 text-sm font-semibold text-amber-900'>
						<HiOutlineCloudUpload size={20} />
						Subirlo acá
					</div>
					<input
						type='file'
						accept='image/*,application/pdf'
						onChange={e => setFile(e.target.files?.[0] ?? null)}
						className='block w-full text-sm'
					/>
					<button
						type='button'
						onClick={handleUpload}
						disabled={!file || uploading}
						className='w-full bg-amber-700 text-white text-sm font-semibold py-2.5 rounded-md disabled:opacity-50'
					>
						{uploading ? 'Subiendo…' : 'Subir comprobante'}
					</button>
				</div>
			) : (
				<div className='border border-emerald-300 bg-emerald-50 rounded-md p-3 text-sm font-semibold text-emerald-800 text-center'>
					✓ Comprobante recibido
				</div>
			)}

			<div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
				<a
					href={`mailto:${SALES_EMAIL}?subject=${mailSubject}&body=${mailBody}`}
					className='flex items-center justify-center gap-2 border border-amber-300 bg-white px-3 py-2.5 rounded-md text-sm font-semibold text-amber-900 hover:bg-amber-100'
				>
					<HiOutlineMail size={18} />
					Por mail
				</a>
				<a
					href={`https://wa.me/${SALES_WHATSAPP}?text=${waText}`}
					target='_blank'
					rel='noreferrer'
					className='flex items-center justify-center gap-2 border border-emerald-300 bg-white px-3 py-2.5 rounded-md text-sm font-semibold text-emerald-900 hover:bg-emerald-100'
				>
					<FaWhatsapp size={18} />
					Por WhatsApp
				</a>
			</div>

			<p className='text-[11px] text-amber-800/80 text-center'>
				Mail: <strong>{SALES_EMAIL}</strong> · WhatsApp: <strong>098 732 327</strong>
			</p>
		</div>
	);
};

/* Resultado del pago con tarjeta (Getnet / Placetopay). */
const PlacetopayResult = ({ status }: { status: PlacetopayStatus | null }) => {
	if (!status || status.result === 'pending') {
		return (
			<div className='w-full space-y-2 rounded-md border-2 border-amber-200 bg-amber-50/70 p-5 md:w-[600px]'>
				<h3 className='font-bold text-amber-900'>Estamos confirmando tu pago…</h3>
				<p className='text-sm text-amber-800'>
					Esto suele tardar unos segundos. No hace falta que pagues de nuevo: te
					avisamos por mail apenas se confirme.
				</p>
				{status?.process_url && (
					<a href={status.process_url} className='inline-block text-sm font-semibold text-amber-900 underline'>
						¿No terminaste de pagar? Volver a la página de pago
					</a>
				)}
			</div>
		);
	}
	if (status.result === 'paid') {
		return (
			<div className='w-full space-y-1 rounded-md border-2 border-emerald-200 bg-emerald-50/70 p-5 md:w-[600px]'>
				<h3 className='font-bold text-emerald-900'>¡Pago aprobado!</h3>
				<p className='text-sm text-emerald-800'>
					{status.card ? `Pagaste con ${status.card}. ` : ''}Te mandamos la confirmación por mail.
				</p>
			</div>
		);
	}
	return (
		<div className='w-full space-y-3 rounded-md border-2 border-red-200 bg-red-50/70 p-5 md:w-[600px]'>
			<h3 className='font-bold text-red-900'>El pago no se completó</h3>
			<p className='text-sm text-red-800'>
				{status.message ? `${status.message}. ` : ''}No se te cobró nada. Tu carrito sigue
				guardado: podés intentar de nuevo o elegir otro medio de pago.
			</p>
			<Link
				to='/checkout'
				className='inline-block rounded-md bg-black px-5 py-3 text-sm font-semibold text-white'
			>
				Volver a intentar
			</Link>
		</div>
	);
};
