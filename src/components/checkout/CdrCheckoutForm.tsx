import { useEffect, useState } from 'react';
import { useCartStore } from '../../store/cart.store';
import {
	createMpPreference,
	getAppSettings,
	uploadPaymentProof,
	checkCdrStock,
	type CartItemForMP,
} from '../../actions';
import { useUser } from '../../hooks';
import toast from 'react-hot-toast';
import { formatPrice } from '../../helpers';
import { ItemsCheckout } from './ItemsCheckout';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabase/client';

type Method = 'mercadopago' | 'transfer' | 'deposit';

interface TransferInfo {
	banco?: string;
	cuenta?: string;
	titular?: string;
	rut?: string;
}
interface DepositInfo {
	abitab?: string;
	redpagos?: string;
	instrucciones?: string;
}

export const CdrCheckoutForm = () => {
	const navigate = useNavigate();
	const { session } = useUser();
	const cleanCart = useCartStore(s => s.cleanCart);
	const cartItems = useCartStore(s => s.items);
	const totalAmount = useCartStore(s => s.totalAmount);

	const [method, setMethod] = useState<Method>('mercadopago');
	const [submitting, setSubmitting] = useState(false);
	const [transferInfo, setTransferInfo] = useState<TransferInfo>({});
	const [depositInfo, setDepositInfo] = useState<DepositInfo>({});
	const [proofFile, setProofFile] = useState<File | null>(null);

	const [form, setForm] = useState({
		fullName: '',
		email: '',
		phone: '',
		line1: '',
		line2: '',
		city: '',
		state: 'Montevideo',
		postalCode: '',
		country: 'Uruguay',
	});

	useEffect(() => {
		if (session?.user?.email) setForm(f => ({ ...f, email: session.user.email ?? '' }));
	}, [session?.user?.email]);

	useEffect(() => {
		(async () => {
			try {
				const map = await getAppSettings();
				setTransferInfo((map.get('payment_transfer_info') as TransferInfo) ?? {});
				setDepositInfo((map.get('payment_deposit_info') as DepositInfo) ?? {});
			} catch (e) {
				console.warn('settings load:', e);
			}
		})();
	}, []);

	const onSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!session) {
			toast.error('Tenés que iniciar sesión para comprar');
			navigate('/login');
			return;
		}
		if (!form.line1 || !form.city) {
			toast.error('Completá la dirección de envío');
			return;
		}

		setSubmitting(true);
		try {
			// 1. Validar stock real contra CDR
			const codes = cartItems.map(i => i.externalCode!).filter(Boolean);
			const qtyMap: Record<string, number> = {};
			for (const it of cartItems) {
				if (!it.externalCode) continue;
				qtyMap[it.externalCode] = (qtyMap[it.externalCode] ?? 0) + it.quantity;
			}
			const stockRes = await checkCdrStock(codes, qtyMap);
			if (!stockRes.ok) {
				toast.error(
					`Sin stock para: ${[
						...stockRes.insufficient,
						...stockRes.missing,
					].join(', ')}`
				);
				setSubmitting(false);
				return;
			}

			if (method === 'mercadopago') {
				const items: CartItemForMP[] = cartItems.map(i => ({
					external_code: i.externalCode!,
					variant_id: i.variantId,
					quantity: i.quantity,
					title: i.name,
					unit_price_usd: i.price,
				}));
				const res = await createMpPreference({
					items,
					address: {
						line1: form.line1,
						line2: form.line2,
						city: form.city,
						state: form.state,
						postal_code: form.postalCode,
						country: form.country,
					},
					customer_email: form.email,
					customer_name: form.fullName,
				});
				cleanCart();
				// Redirect a MP. En PROD usar init_point; en dev se puede usar sandbox.
				window.location.href = res.init_point;
				return;
			}

			// Método manual: creamos la orden con payment_method=transfer/deposit y estado pending.
			// Re-usamos lógica creando la orden vía cliente Supabase (tabla pública).
			const { data: userData } = await supabase.auth.getUser();
			if (!userData.user) throw new Error('no autenticado');
			const { data: customer } = await supabase
				.from('customers')
				.select('id')
				.eq('user_id', userData.user.id)
				.single();
			if (!customer) throw new Error('no se encontró el customer');

			const { data: addrRow, error: addrErr } = await supabase
				.from('addresses')
				.insert({
					address_line1: form.line1,
					address_line2: form.line2 || null,
					city: form.city,
					state: form.state,
					postal_code: form.postalCode,
					country: form.country,
					customer_id: customer.id,
				})
				.select()
				.single();
			if (addrErr) throw new Error(addrErr.message);

			const { data: orderRow, error: orderErr } = await supabase
				.from('orders')
				.insert({
					customer_id: customer.id,
					address_id: addrRow.id,
					total_amount: totalAmount,
					status: 'pago_pendiente',
					payment_method: method,
					payment_status: 'pending',
				})
				.select()
				.single();
			if (orderErr) throw new Error(orderErr.message);

			await supabase.from('order_items').insert(
				cartItems.map(i => ({
					order_id: orderRow.id,
					variant_id: i.variantId,
					price: i.price,
					quantity: i.quantity,
				}))
			);

			if (proofFile) {
				await uploadPaymentProof(orderRow.id, proofFile);
			}

			cleanCart();
			toast.success('Pedido registrado. Te avisamos cuando confirmemos el pago.');
			navigate(`/checkout/${orderRow.id}/thank-you?status=pending`);
		} catch (err) {
			toast.error((err as Error).message);
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<form className='flex flex-col gap-6' onSubmit={onSubmit}>
			<section className='space-y-3'>
				<h3 className='text-lg font-semibold'>Datos de contacto</h3>
				<input
					className='border rounded p-2 w-full'
					placeholder='Nombre completo'
					value={form.fullName}
					onChange={e => setForm({ ...form, fullName: e.target.value })}
				/>
				<input
					type='email'
					className='border rounded p-2 w-full'
					placeholder='Email'
					value={form.email}
					onChange={e => setForm({ ...form, email: e.target.value })}
					required
				/>
				<input
					className='border rounded p-2 w-full'
					placeholder='Teléfono'
					value={form.phone}
					onChange={e => setForm({ ...form, phone: e.target.value })}
				/>
			</section>

			<section className='space-y-3'>
				<h3 className='text-lg font-semibold'>Dirección de envío</h3>
				<input
					className='border rounded p-2 w-full'
					placeholder='Calle y número'
					value={form.line1}
					onChange={e => setForm({ ...form, line1: e.target.value })}
					required
				/>
				<input
					className='border rounded p-2 w-full'
					placeholder='Apartamento / referencias (opcional)'
					value={form.line2}
					onChange={e => setForm({ ...form, line2: e.target.value })}
				/>
				<div className='grid grid-cols-2 gap-3'>
					<input
						className='border rounded p-2'
						placeholder='Ciudad'
						value={form.city}
						onChange={e => setForm({ ...form, city: e.target.value })}
						required
					/>
					<input
						className='border rounded p-2'
						placeholder='Departamento'
						value={form.state}
						onChange={e => setForm({ ...form, state: e.target.value })}
					/>
					<input
						className='border rounded p-2'
						placeholder='Código postal'
						value={form.postalCode}
						onChange={e => setForm({ ...form, postalCode: e.target.value })}
					/>
					<input
						className='border rounded p-2'
						placeholder='País'
						value={form.country}
						onChange={e => setForm({ ...form, country: e.target.value })}
					/>
				</div>
			</section>

			<section className='space-y-3'>
				<h3 className='text-lg font-semibold'>Método de pago</h3>
				<div className='space-y-2'>
					<label className='flex items-center gap-2 border rounded p-3 cursor-pointer'>
						<input
							type='radio'
							name='method'
							value='mercadopago'
							checked={method === 'mercadopago'}
							onChange={() => setMethod('mercadopago')}
						/>
						<span className='font-medium'>MercadoPago (tarjeta, débito, Abitab)</span>
					</label>
					<label className='flex items-center gap-2 border rounded p-3 cursor-pointer'>
						<input
							type='radio'
							name='method'
							value='transfer'
							checked={method === 'transfer'}
							onChange={() => setMethod('transfer')}
						/>
						<span className='font-medium'>Transferencia bancaria</span>
					</label>
					<label className='flex items-center gap-2 border rounded p-3 cursor-pointer'>
						<input
							type='radio'
							name='method'
							value='deposit'
							checked={method === 'deposit'}
							onChange={() => setMethod('deposit')}
						/>
						<span className='font-medium'>Depósito en redes (Abitab / Redpagos)</span>
					</label>
				</div>

				{method === 'transfer' && (
					<div className='bg-gray-50 p-3 rounded text-sm space-y-1'>
						<p>
							<strong>Banco:</strong> {transferInfo.banco || '(configurar)'}
						</p>
						<p>
							<strong>Cuenta:</strong> {transferInfo.cuenta || '(configurar)'}
						</p>
						<p>
							<strong>Titular:</strong> {transferInfo.titular || '(configurar)'}
						</p>
						<p>
							<strong>RUT:</strong> {transferInfo.rut || '(configurar)'}
						</p>
						<p className='pt-2'>Subí tu comprobante:</p>
						<input
							type='file'
							accept='image/*,application/pdf'
							onChange={e => setProofFile(e.target.files?.[0] ?? null)}
						/>
					</div>
				)}

				{method === 'deposit' && (
					<div className='bg-gray-50 p-3 rounded text-sm space-y-1'>
						<p>
							<strong>Abitab:</strong> {depositInfo.abitab || '(configurar)'}
						</p>
						<p>
							<strong>Redpagos:</strong> {depositInfo.redpagos || '(configurar)'}
						</p>
						{depositInfo.instrucciones && (
							<p className='whitespace-pre-line'>{depositInfo.instrucciones}</p>
						)}
						<p className='pt-2'>Subí tu comprobante:</p>
						<input
							type='file'
							accept='image/*,application/pdf'
							onChange={e => setProofFile(e.target.files?.[0] ?? null)}
						/>
					</div>
				)}
			</section>

			{/* Resumen (mobile) */}
			<div className='md:hidden'>
				<ItemsCheckout />
			</div>

			<div className='flex items-center justify-between'>
				<p className='text-sm text-gray-600'>Total a pagar</p>
				<p className='font-bold text-lg'>USD {formatPrice(totalAmount)}</p>
			</div>

			<button
				type='submit'
				className='bg-black text-white py-3.5 font-bold tracking-wide rounded-md disabled:opacity-70'
				disabled={submitting}
			>
				{submitting
					? 'Procesando…'
					: method === 'mercadopago'
					? 'Pagar con MercadoPago'
					: 'Confirmar pedido'}
			</button>
		</form>
	);
};
