import { Link, useNavigate, useParams } from 'react-router-dom';
import { useOrder, useUser, useUsdUyuRate } from '../hooks';
import { Loader } from '../components/shared/Loader';
import { CiCircleCheck } from 'react-icons/ci';
import { formatPrice } from '../helpers';
import { useEffect, useState } from 'react';
import { supabase } from '../supabase/client';
import { getAppSettings, uploadPaymentProof } from '../actions';
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

	const navigate = useNavigate();

	// Limpiamos el carrito recién cuando el cliente llega a la confirmación.
	// Antes lo limpiábamos antes del redirect a MP, lo que causaba un flash
	// momentáneo de "carrito vacío".
	useEffect(() => {
		cleanCart();
	}, [cleanCart]);

	useEffect(() => {
		supabase.auth.onAuthStateChange(async (event, session) => {
			if (event === 'SIGNED_OUT' || !session) {
				navigate('/login');
			}
		});
	}, [navigate]);

	// Meta Pixel: Purchase cuando la orden confirmada está cargada.
	// trackPurchase deduplica por id de orden (no cuenta de más si refrescan).
	useEffect(() => {
		if (!data) return;
		trackPurchase(
			data.id,
			data.orderItems.map(item => ({
				id:
					(item as any).variantId ??
					(item as any).productId ??
					item.productName,
				quantity: item.quantity,
				price: item.price,
			})),
			data.totalAmount
		);
	}, [data]);

	useEffect(() => {
		if (data?.paymentMethod !== 'transfer') return;
		(async () => {
			try {
				const map = await getAppSettings();
				setTransferInfo((map.get('payment_transfer_info') as TransferInfo) ?? null);
			} catch (e) {
				console.warn('settings:', e);
			}
		})();
	}, [data?.paymentMethod]);

	if (isError) return <div>Error al cargar la orden</div>;

	if (isLoading || !data || isLoadingSession) return <Loader />;

	const userName = data.customer.full_name || '';
	const totalUyu = fx ? Math.round(data.totalAmount * fx.rate) : null;
	const formatUyu = (n: number) => `UYU ${n.toLocaleString('es-UY')}`;

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

				{data.paymentMethod === 'transfer' && (
					<div className='border-2 border-emerald-200 bg-emerald-50/60 w-full p-5 rounded-md space-y-3 md:w-[600px]'>
						<div className='flex items-center justify-between'>
							<h3 className='font-bold text-emerald-900'>
								Datos para transferir — Pedido #{data.id}
							</h3>
							<span className='text-xs text-emerald-700 font-medium'>
								Te mandamos también un mail
							</span>
						</div>
						<TransferDetails
							info={transferInfo}
							orderId={data.id}
							totalAmount={data.totalAmount}
							totalUyu={totalUyu}
							formatUyu={formatUyu}
						/>
					</div>
				)}

				{(data.paymentMethod === 'transfer' || data.paymentMethod === 'deposit') && (
					<PaymentProofBlock orderId={data.id} />
				)}

				<div className='border border-slate-200 w-full p-5 rounded-md space-y-3 md:w-[600px]'>
					<h3 className='font-medium'>Detalles del pedido</h3>

					<div className='flex flex-col gap-5'>
						<ul className='space-y-3'>
							{data.orderItems.map((item, index) => (
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

						<div className='flex justify-between items-start'>
							<span className='font-semibold'>Total:</span>
							<div className='text-right'>
								<p className='font-semibold'>
									{formatPrice(data.totalAmount)}
								</p>
								{totalUyu !== null && (
									<p className='text-xs text-gray-500'>
										≈ {formatUyu(totalUyu)} (al BCU de hoy)
									</p>
								)}
							</div>
						</div>
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
							≈ {formatUyu(totalUyu)} (al BCU de hoy)
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
const SALES_WHATSAPP = '59894116299';

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
				Mail: <strong>{SALES_EMAIL}</strong> · WhatsApp: <strong>094 116 299</strong>
			</p>
		</div>
	);
};
