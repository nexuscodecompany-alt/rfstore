import { Link, useNavigate, useParams } from 'react-router-dom';
import { useOrder, useUser, useUsdUyuRate } from '../hooks';
import { Loader } from '../components/shared/Loader';
import { CiCircleCheck } from 'react-icons/ci';
import { formatPrice } from '../helpers';
import { useEffect, useState } from 'react';
import { supabase } from '../supabase/client';
import { getAppSettings } from '../actions';
import { useCartStore } from '../store/cart.store';

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
						<p className='text-xs text-emerald-800 leading-relaxed pt-2'>
							Una vez recibida la transferencia, despachamos tu pedido y te
							avisamos.
						</p>
					</div>
				)}

				<div className='border border-slate-200 w-full p-5 rounded-md space-y-3 md:w-[600px]'>
					<h3 className='font-medium'>Detalles del pedido</h3>

					<div className='flex flex-col gap-5'>
						<ul className='space-y-3'>
							{data.orderItems.map((item, index) => {
								const hasStorage =
									item.storage &&
									item.storage.trim() !== '' &&
									item.storage.trim() !== '-';
								const hasColor =
									item.color_name &&
									item.color_name.trim() !== '' &&
									item.color_name.trim().toLowerCase() !== 'unico' &&
									item.color_name.trim().toLowerCase() !== 'único';
								const variantLabel = [
									hasStorage ? item.storage : null,
									hasColor ? item.color_name : null,
								]
									.filter(Boolean)
									.join(' / ');
								return (
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

											{variantLabel && (
												<div className='flex gap-3'>
													<p className='text-[13px] text-gray-600'>
														{variantLabel}
													</p>
												</div>
											)}
										</div>
									</li>
								);
							})}
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
