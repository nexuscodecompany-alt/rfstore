import { useEffect, useState } from 'react';
import { useCartStore } from '../../store/cart.store';
import {
	createMpPreference,
	getAppSettings,
	uploadPaymentProof,
	checkCdrStock,
	sendTransferEmail,
	type CartItemForMP,
} from '../../actions';
import { useUser, useUsdUyuRate } from '../../hooks';
import {
	ShippingZoneSelector,
	ShippingSelection,
	emptyShippingSelection,
} from './ShippingZoneSelector';
import { URUGUAY_DEPARTMENTS_INTERIOR } from '../../constants/shipping';
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
	const { data: fx } = useUsdUyuRate();

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
	const [shipping, setShipping] = useState<ShippingSelection>(
		emptyShippingSelection
	);
	const shippingCostUsd = shipping.cost_usd;
	const grandTotalUsd = totalAmount + shippingCostUsd;
	const totalUyu = fx ? Math.round(grandTotalUsd * fx.rate) : null;

	// Sincroniza state/city con la selección de zona:
	// - Montevideo: state="Montevideo", city se autocompleta con el barrio detectado.
	// - Interior: state=departamento elegido, city queda libre para que el cliente
	//   ingrese su ciudad/localidad.
	useEffect(() => {
		if (shipping.zone === 'montevideo') {
			setForm(f => ({
				...f,
				state: 'Montevideo',
				city: shipping.barrio ?? '',
			}));
		} else if (shipping.zone === 'interior') {
			setForm(f => ({
				...f,
				state: shipping.department ?? '',
				city: f.state === 'Montevideo' ? '' : f.city,
			}));
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [shipping.zone, shipping.barrio, shipping.department]);

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
		if (!form.fullName.trim()) {
			toast.error('Ingresá tu nombre completo');
			return;
		}
		const phoneDigits = form.phone.replace(/\D/g, '');
		if (phoneDigits.length < 8) {
			toast.error('Ingresá un teléfono válido (mín. 8 dígitos)');
			return;
		}
		if (!form.email.trim() || !/^.+@.+\..+$/.test(form.email)) {
			toast.error('Ingresá un email válido');
			return;
		}
		if (!form.line1 || !form.city) {
			toast.error('Completá la dirección de envío');
			return;
		}

		// Validación de envío
		if (shipping.zone === 'montevideo' && !shipping.barrio) {
			toast.error('Elegí tu barrio para calcular el envío');
			return;
		}
		if (shipping.zone === 'interior' && !shipping.department) {
			toast.error('Elegí el departamento de destino');
			return;
		}

		setSubmitting(true);
		try {
			// 1. Validar stock real contra CDR.
			// IMPORTANTE: si el WS responde error o "sin stock" para todos los items,
			// no bloqueamos la compra. Logueamos para debug y avisamos al cliente que
			// confirmaremos el stock por WhatsApp. Esto evita perder ventas cuando el
			// SOAP de CDR está inestable o devuelve códigos que no matchean.
			const codes = cartItems.map(i => i.externalCode!).filter(Boolean);
			const qtyMap: Record<string, number> = {};
			for (const it of cartItems) {
				if (!it.externalCode) continue;
				qtyMap[it.externalCode] = (qtyMap[it.externalCode] ?? 0) + it.quantity;
			}
			// El edge function ya combina SOAP CDR + fallback a variants.stock,
			// así que confiamos en su resultado. Si "ok" es false, bloqueamos
			// con el detalle de los códigos sin stock.
			try {
				const stockRes = await checkCdrStock(codes, qtyMap);
				if (!stockRes.ok) {
					const all = [...stockRes.insufficient, ...stockRes.missing];
					console.warn('[checkout] CDR stock check no-ok:', stockRes);
					// Mapeamos códigos → nombres para que el toast sea útil al cliente.
					const namesByCode = new Map(
						cartItems
							.filter(i => i.externalCode)
							.map(i => [i.externalCode!, i.name])
					);
					const names = all.map(c => namesByCode.get(c) ?? c);
					toast.error(`Sin stock: ${names.join(', ')}`);
					setSubmitting(false);
					return;
				}
			} catch (stockErr) {
				// El edge function devolvió 5xx (red caída, etc.). En este caso no
				// pudimos validar nada — bloqueamos para evitar oversell y pedimos
				// reintentar.
				console.warn('[checkout] CDR stock check failed:', stockErr);
				toast.error(
					'No pudimos verificar disponibilidad. Reintentá en unos segundos.'
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
					shipping_zone: shipping.zone,
					shipping_barrio: shipping.barrio ?? undefined,
					shipping_department: shipping.department ?? undefined,
					shipping_cost_usd: shipping.cost_usd,
				});
				cleanCart();
				// Redirect a MP. En PROD usar init_point; en dev se puede usar sandbox.
				window.location.href = res.init_point;
				return;
			}

			// Método manual: creamos la orden vía RPC place_cdr_order, que valida
			// stock, crea address+order+items y RESERVA el stock de forma atómica.
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const { data: orderIdData, error: rpcErr } = await (supabase as any).rpc('place_cdr_order', {
				p_items: cartItems.map(i => ({
					variant_id: i.variantId,
					quantity: i.quantity,
					price: i.price,
				})),
				p_total: grandTotalUsd,
				p_address: {
					address_line1: form.line1,
					address_line2: form.line2 || null,
					city: form.city,
					state: form.state,
					postal_code: form.postalCode,
					country: form.country,
				},
				p_payment_method: method,
				p_shipping_zone: shipping.zone,
				p_shipping_barrio: shipping.barrio,
				p_shipping_department: shipping.department,
				p_shipping_cost_usd: shipping.cost_usd,
			});
			if (rpcErr) throw new Error(rpcErr.message);
			const orderId = orderIdData as number;

			if (proofFile) {
				await uploadPaymentProof(orderId, proofFile);
			}

			// Si es transferencia, mandamos el mail con datos bancarios al comprador.
			// No bloqueamos el checkout si el mail falla — el cliente igual ve los datos
			// en /thank-you.
			if (method === 'transfer') {
				try {
					await sendTransferEmail(orderId);
				} catch (mailErr) {
					console.warn('No se pudo enviar mail de transferencia:', mailErr);
				}
			}

			cleanCart();
			toast.success('Pedido registrado. Te avisamos cuando confirmemos el pago.');
			navigate(`/checkout/${orderId}/thank-you?status=pending`);
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
					className='border rounded p-2 w-full invalid:border-rose-400'
					placeholder='Nombre completo *'
					value={form.fullName}
					onChange={e => setForm({ ...form, fullName: e.target.value })}
					required
					minLength={2}
				/>
				<input
					type='email'
					className='border rounded p-2 w-full invalid:border-rose-400'
					placeholder='Email *'
					value={form.email}
					onChange={e => setForm({ ...form, email: e.target.value })}
					required
				/>
				<input
					type='tel'
					inputMode='tel'
					className='border rounded p-2 w-full invalid:border-rose-400'
					placeholder='Teléfono * (ej: 094 116 299)'
					value={form.phone}
					onChange={e => setForm({ ...form, phone: e.target.value })}
					required
					minLength={8}
					pattern='[0-9 +()-]{8,}'
				/>
			</section>

			<section className='space-y-3'>
				<ShippingZoneSelector value={shipping} onChange={setShipping} />
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
						placeholder={
							shipping.zone === 'interior' ? 'Ciudad / localidad' : 'Ciudad'
						}
						value={form.city}
						onChange={e => setForm({ ...form, city: e.target.value })}
						required
					/>
					<select
						className='border rounded p-2 bg-white'
						value={form.state}
						onChange={e => setForm({ ...form, state: e.target.value })}
					>
						<option value='Montevideo'>Montevideo</option>
						{URUGUAY_DEPARTMENTS_INTERIOR.map(d => (
							<option key={d} value={d}>
								{d}
							</option>
						))}
					</select>
					<input
						className='border rounded p-2'
						placeholder='Código postal (opcional)'
						value={form.postalCode}
						onChange={e => setForm({ ...form, postalCode: e.target.value })}
					/>
					<input
						className='border rounded p-2 bg-ink-50'
						value={form.country}
						readOnly
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

			<div className='space-y-1 border-t border-ink-200 pt-3'>
				<div className='flex items-center justify-between text-sm text-ink-600'>
					<span>Subtotal</span>
					<span>{formatPrice(totalAmount)}</span>
				</div>
				<div className='flex items-center justify-between text-sm text-ink-600'>
					<span>Envío {shipping.zone === 'interior' ? '(DAC)' : ''}</span>
					<span>
						{shipping.zone === 'interior'
							? 'Pago en agencia'
							: shippingCostUsd > 0
							? formatPrice(shippingCostUsd)
							: shipping.barrio
							? 'Gratis'
							: '—'}
					</span>
				</div>
				<div className='flex items-center justify-between gap-3 pt-2 border-t border-ink-100'>
					<p className='text-sm font-semibold text-gray-700'>Total a pagar</p>
					<div className='text-right'>
						<p className='font-bold text-lg'>{formatPrice(grandTotalUsd)}</p>
						{method === 'mercadopago' && totalUyu !== null && fx && (
							<p className='text-[11px] text-gray-500'>
								≈ UYU {totalUyu.toLocaleString('es-UY')}{' '}
								<span title={`Cotización: ${fx.rate.toFixed(2)} (${fx.source})`}>
									(al dólar BCU oficial de hoy)
								</span>
							</p>
						)}
					</div>
				</div>
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
