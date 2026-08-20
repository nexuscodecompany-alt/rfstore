import { useEffect, useRef, useState } from 'react';
import { useCartStore } from '../../store/cart.store';
import { useCheckoutShippingStore } from '../../store/checkoutShipping.store';
import {
	createMpPreference,
	getAppSettings,
	checkCdrStock,
	sendPaymentInstructionsEmail,
	trackCheckoutLead,
	type CartItemForMP,
	type InvoiceDataForOrder,
} from '../../actions';
import { useUser, useUsdUyuRate } from '../../hooks';
import { validateCoupon, type CouponValidation } from '../../actions/coupons';
import { leerCuponRecuperado, guardarCuponRecuperado } from '../../actions/abandonedCart';
import {
	ShippingZoneSelector,
	ShippingSelection,
	emptyShippingSelection,
} from './ShippingZoneSelector';
import { URUGUAY_DEPARTMENTS_INTERIOR } from '../../constants/shipping';
import toast from 'react-hot-toast';
import {
	formatPrice,
	shippingSummary,
	qualifiesForFreeShipping,
	shippingIsChargedOnline,
	FREE_SHIPPING_MIN_USD,
} from '../../helpers';
import { ItemsCheckout } from './ItemsCheckout';
import { useNavigate } from 'react-router-dom';
import { ImSpinner2 } from 'react-icons/im';
import { supabase } from '../../supabase/client';

// 'hybrid' = una parte por MercadoPago y otra por transferencia. El pedido no se
// concreta hasta que entren las dos.
type Method = 'mercadopago' | 'transfer' | 'deposit' | 'hybrid';

interface TransferInfo {
	banco?: string;
	titular?: string;
	rut?: string;
	moneda?: string;
	cuenta_santander?: string;
	sucursal_santander?: string;
	cuenta_externa?: string;
}
interface DepositInfo {
	abitab?: string;
	redpagos?: string;
	instrucciones?: string;
}

export const CdrCheckoutForm = () => {
	const navigate = useNavigate();
	const { session } = useUser();
	const cartItems = useCartStore(s => s.items);
	const totalAmount = useCartStore(s => s.totalAmount);

	const [method, setMethod] = useState<Method>('mercadopago');
	const [submitting, setSubmitting] = useState(false);
	const [transferInfo, setTransferInfo] = useState<TransferInfo>({});
	const [depositInfo, setDepositInfo] = useState<DepositInfo>({});
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

	// Regla única (helpers/shippingSummary): envío gratis SÓLO en Montevideo desde
	// USD 150. La zona metropolitana (agencia) se cobra siempre, y el interior va
	// por DAC: lo paga el cliente al retirar, así que nunca entra en este total.
	const qualifiesForFree = qualifiesForFreeShipping(shipping.zone, totalAmount);
	// El interior no se cobra online (va por DAC): su costo nunca entra al total.
	const shippingCostUsd =
		qualifiesForFree || !shippingIsChargedOnline(shipping.zone)
			? 0
			: shipping.cost_usd;

	// --- Cupón ---
	const [couponInput, setCouponInput] = useState('');
	const [coupon, setCoupon] = useState<CouponValidation | null>(null);
	const [couponMsg, setCouponMsg] = useState<string | null>(null);
	const [applyingCoupon, setApplyingCoupon] = useState(false);

	const couponFreeShipping = coupon?.valid && coupon.free_shipping === true;
	const effectiveShippingUsd = couponFreeShipping ? 0 : shippingCostUsd;
	const discountUsd = coupon?.valid ? Number(coupon.discount_usd ?? 0) : 0;
	const grandTotalUsd = Math.max(0, totalAmount + effectiveShippingUsd - discountUsd);
	const totalUyu = fx ? Math.round(grandTotalUsd * fx.rate) : null;

	/* ---------------- Pago combinado (MercadoPago + transferencia) ------------ */
	// Los montos se guardan como TEXTO mientras el cliente escribe: si se
	// guardaran como número, borrar el último dígito lo convertiría en 0 y el
	// campo pelearía con el teclado.
	const [splitMp, setSplitMp] = useState('');
	const [splitTr, setSplitTr] = useState('');
	const esHibrido = method === 'hybrid';

	const nMp = Number(splitMp.replace(',', '.')) || 0;
	const nTr = Number(splitTr.replace(',', '.')) || 0;
	const sumaSplit = Math.round((nMp + nTr) * 100) / 100;
	const faltaSplit = Math.round((grandTotalUsd - sumaSplit) * 100) / 100;
	// El total cambia si el cliente agrega un extra o toca el envío. El desglose
	// se revalida solo contra el total del momento, así que un pedido con el
	// reparto viejo no puede avanzar.
	const splitOk =
		esHibrido && nMp > 0 && nTr > 0 && Math.abs(faltaSplit) <= 0.01;
	// El equivalente en pesos del monto que va por transferencia (todo el total
	// si no es híbrido).
	const montoTransferUyu = fx
		? Math.round((esHibrido ? nTr : grandTotalUsd) * fx.rate)
		: null;

	// Al completar uno de los dos, el otro se autocompleta con el resto: es lo
	// que la gente espera y evita el ida y vuelta con los centavos.
	const completarResto = (campo: 'mp' | 'tr') => {
		if (grandTotalUsd <= 0) return;
		if (campo === 'mp') {
			const resto = Math.round((grandTotalUsd - nMp) * 100) / 100;
			if (nMp > 0 && resto > 0) setSplitTr(String(resto));
		} else {
			const resto = Math.round((grandTotalUsd - nTr) * 100) / 100;
			if (nTr > 0 && resto > 0) setSplitMp(String(resto));
		}
	};

	/* ---------------- Factura con RUT ---------------------------------------- */
	const [wantsInvoice, setWantsInvoice] = useState(false);
	const [invoice, setInvoice] = useState({
		rut: '',
		businessName: '',
		tradeName: '',
		address: '',
		city: '',
		state: '',
		email: '',
	});
	// El RUT uruguayo son 12 dígitos; el cliente lo escribe con puntos o guiones.
	const rutDigits = invoice.rut.replace(/\D/g, '');
	const rutOk = rutDigits.length === 12;
	const invoiceOk =
		!wantsInvoice ||
		(rutOk && invoice.businessName.trim() !== '' && invoice.address.trim() !== '');

	/** Los datos fiscales tal como los espera el servidor, o null si no pidió factura. */
	const datosFactura = (): InvoiceDataForOrder | null =>
		wantsInvoice
			? {
					requested: true as const,
					rut: rutDigits,
					business_name: invoice.businessName.trim(),
					trade_name: invoice.tradeName.trim() || null,
					address: invoice.address.trim(),
					city: invoice.city.trim() || null,
					state: invoice.state.trim() || null,
					// Si no puso uno aparte, la factura va al mail de la compra.
					email: invoice.email.trim() || form.email.trim() || null,
			  }
			: null;

	const applyCoupon = async (codeOverride?: string, silent = false) => {
		const code = (codeOverride ?? couponInput).trim();
		if (!code) return;
		setApplyingCoupon(true);
		if (!silent) setCouponMsg(null);
		try {
			const res = await validateCoupon({
				code,
				items: cartItems.map(i => ({ variant_id: i.variantId, price: i.price, quantity: i.quantity })),
				subtotal: totalAmount,
				shipping: shippingCostUsd,
				// El servidor necesita el método para decidir: hay cupones que sólo
				// valen por transferencia.
				paymentMethod: method,
			});
			if (res.valid) {
				setCoupon(res);
				setCouponMsg(null);
			} else {
				setCoupon(null);
				setCouponMsg(res.reason ?? 'Cupón inválido');
			}
		} catch (e) {
			setCoupon(null);
			setCouponMsg((e as Error).message);
		} finally {
			setApplyingCoupon(false);
		}
	};
	const removeCoupon = () => { setCoupon(null); setCouponInput(''); setCouponMsg(null); };

	// Cambiar el método de pago revalida el cupón. Es lo que hace visible la
	// regla: si tenés un cupón de sólo-transferencia y pasás a MercadoPago, se
	// desaplica en el momento con el motivo, y el total vuelve a su valor. Sin
	// esto el cliente vería un descuento que el servidor después le va a negar.
	const codigoAplicado = coupon?.valid ? coupon.code ?? null : null;
	useEffect(() => {
		if (!codigoAplicado) return;
		applyCoupon(codigoAplicado, true);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [method]);

	// --- Vuelta desde el mail de carrito abandonado ---
	// El cupón viene preparado por la página de recuperación. Se preselecciona
	// transferencia (es el único método con el que vale) y se aplica solo: el
	// cliente recién acá se entera de cuánto es el descuento.
	const [recuperado, setRecuperado] = useState<{ percent: number; expiresAt: string | null } | null>(null);
	const cuponPrecargado = useRef(false);
	useEffect(() => {
		if (cuponPrecargado.current || cartItems.length === 0) return;
		const c = leerCuponRecuperado();
		if (!c) return;
		cuponPrecargado.current = true;
		const soloTransferencia =
			c.payment_methods.length > 0 && !c.payment_methods.includes('mercadopago');
		if (soloTransferencia) setMethod('transfer');
		setCouponInput(c.code);
		setRecuperado({ percent: c.percent, expiresAt: c.expires_at });
		// Un respiro para que el método ya esté seteado cuando se valide.
		const t = setTimeout(() => applyCoupon(c.code, true), 250);
		return () => clearTimeout(t);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [cartItems.length]);

	// Sincronizamos el label con el resumen lateral.
	const setShippingLabel = useCheckoutShippingStore(s => s.setShippingLabel);
	const setSummary = useCheckoutShippingStore(s => s.setSummary);
	const resetShippingLabel = useCheckoutShippingStore(s => s.reset);

	// Empujamos el desglose real (envío, descuento, total) al resumen lateral para
	// que ItemsCheckout muestre exactamente lo que se va a cobrar.
	useEffect(() => {
		setSummary({
			shippingUsd: effectiveShippingUsd,
			discountUsd,
			couponCode: coupon?.valid ? coupon.code ?? null : null,
			grandTotalUsd,
		});
	}, [setSummary, effectiveShippingUsd, discountUsd, coupon, grandTotalUsd]);
	// Resumen de envío: MISMO texto en el checkout, en el resumen lateral, en la
	// página de gracias y en los mails.
	const shippingInfo = shippingSummary({
		zone: shipping.zone,
		barrio: shipping.barrio,
		department: shipping.department,
		costUsd: effectiveShippingUsd,
		freeByThreshold: qualifiesForFree,
		freeByCoupon: couponFreeShipping === true,
	});

	useEffect(() => {
		setShippingLabel(shippingInfo.label);
		return () => resetShippingLabel();
	}, [shippingInfo.label, setShippingLabel, resetShippingLabel]);

	// Sincroniza state/city con la selección de zona:
	// - Montevideo: city y state fijos en "Montevideo" (el barrio va en shipping_barrio).
	// - Interior: state=departamento elegido, city queda libre para que el cliente
	//   ingrese su ciudad/localidad.
	useEffect(() => {
		if (shipping.zone === 'montevideo') {
			setForm(f => ({
				...f,
				state: 'Montevideo',
				city: 'Montevideo',
			}));
		} else if (shipping.zone === 'metropolitana') {
			// Zona metropolitana: departamento Canelones y ciudad = la localidad detectada.
			setForm(f => ({
				...f,
				state: shipping.department ?? 'Canelones',
				city: shipping.barrio ?? '',
			}));
		} else if (shipping.zone === 'interior') {
			setForm(f => ({
				...f,
				state: shipping.department ?? '',
				city: f.state === 'Montevideo' || f.state === 'Canelones' ? '' : f.city,
			}));
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [shipping.zone, shipping.barrio, shipping.department]);

	// Registro del "llegó al checkout": guardamos contacto + foto del carrito
	// apenas el cliente tiene datos cargados. Sirve para el panel de clientes
	// (los "casi compran"). Se marca como convertido solo si termina comprando.
	// Best-effort y con respiro: si falla, la compra sigue igual.
	useEffect(() => {
		if (!session?.user?.id) return;
		if (cartItems.length === 0) return;
		if (!form.email && !form.phone) return;
		const t = setTimeout(() => {
			trackCheckoutLead({
				email: form.email,
				phone: form.phone,
				fullName: form.fullName,
				cart: cartItems.map(i => ({
					name: i.name,
					quantity: i.quantity,
					price: i.price,
				})),
				total: totalAmount,
				shippingZone: shipping.zone,
				shippingDepartment: shipping.department,
			});
		}, 1500);
		return () => clearTimeout(t);
	}, [
		session?.user?.id,
		cartItems,
		form.email,
		form.phone,
		form.fullName,
		totalAmount,
		shipping.zone,
		shipping.department,
	]);

	// Prefill datos del cliente desde la tabla customers (persistente entre
	// compras): nombre, teléfono y email se cargan al loguearse.
	useEffect(() => {
		if (!session?.user?.id) return;
		(async () => {
			try {
				const { data } = await supabase
					.from('customers')
					.select('full_name, phone, email')
					.eq('user_id', session.user.id)
					.maybeSingle();
				if (data) {
					setForm(f => ({
						...f,
						fullName: data.full_name ?? f.fullName,
						phone: data.phone ?? f.phone,
						email: data.email ?? session.user.email ?? f.email,
					}));
				} else if (session.user.email) {
					setForm(f => ({ ...f, email: session.user.email ?? '' }));
				}
			} catch (e) {
				console.warn('prefill customer:', e);
			}
		})();
	}, [session?.user?.id, session?.user?.email]);

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
		// Factura con RUT: si la pidió, los datos fiscales tienen que estar. El
		// servidor lo vuelve a validar; esto es para no hacerle esperar el viaje.
		if (wantsInvoice && !invoiceOk) {
			toast.error(
				!rutOk
					? 'El RUT tiene que tener 12 dígitos'
					: 'Completá razón social y domicilio fiscal para la factura'
			);
			return;
		}
		// Pago combinado: el reparto tiene que cubrir el total EXACTO del momento.
		if (esHibrido && !splitOk) {
			toast.error(
				nMp <= 0 || nTr <= 0
					? 'Cargá un monto en los dos medios de pago'
					: faltaSplit > 0
					? `Faltan ${formatPrice(faltaSplit)} para cubrir el total`
					: `Los montos se pasan por ${formatPrice(Math.abs(faltaSplit))}`
			);
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
			// Persistir los datos del cliente en customers para próximas compras.
			if (session?.user?.id) {
				try {
					await supabase
						.from('customers')
						.update({
							full_name: form.fullName,
							phone: form.phone,
							email: form.email,
						})
						.eq('user_id', session.user.id);
				} catch (e) {
					console.warn('persist customer:', e);
				}
			}
			// 1. Validar stock real contra CDR (sólo para los items CDR: los
			// productos manuales con pago online no están en el WS de CDR, su stock
			// es el de la base y lo validan place_cdr_order / mp-create-preference).
			// IMPORTANTE: si el WS responde error o "sin stock" para todos los items,
			// no bloqueamos la compra. Logueamos para debug y avisamos al cliente que
			// confirmaremos el stock por WhatsApp. Esto evita perder ventas cuando el
			// SOAP de CDR está inestable o devuelve códigos que no matchean.
			const codes = cartItems
				.filter(i => i.source === 'cdr')
				.map(i => i.externalCode!)
				.filter(Boolean);
			const qtyMap: Record<string, number> = {};
			for (const it of cartItems) {
				if (it.source !== 'cdr' || !it.externalCode) continue;
				qtyMap[it.externalCode] = (qtyMap[it.externalCode] ?? 0) + it.quantity;
			}
			// El edge function ya combina SOAP CDR + fallback a variants.stock,
			// así que confiamos en su resultado. Si "ok" es false, bloqueamos
			// con el detalle de los códigos sin stock.
			if (codes.length > 0) {
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
			}

			if (method === 'mercadopago') {
				const items: CartItemForMP[] = cartItems.map(i => ({
					// null en los manuales: la edge function resuelve origen y precio
					// por variant_id contra la base.
					external_code: i.externalCode ?? null,
					variant_id: i.variantId,
					quantity: i.quantity,
					title: i.name,
					unit_price_usd: i.price,
					is_extra: i.isExtra === true,
					extra_source: i.isExtra ? i.extraSource ?? null : null,
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
					shipping_cost_usd: shippingCostUsd,
					coupon_code: coupon?.valid ? coupon.code : undefined,
					invoice: datosFactura(),
				});
				// NO limpiamos el carrito acá. Si limpiáramos antes del redirect,
				// la CheckoutPage re-renderizaría mostrando "carrito vacío" por una
				// fracción de segundo. El carrito se limpia en ThankyouPage cuando
				// el usuario vuelva exitosamente desde MP.
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
					// Atribución del módulo de extras (no afecta el cobro).
					is_extra: i.isExtra === true,
					extra_source: i.isExtra ? i.extraSource ?? null : null,
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
				p_shipping_cost_usd: shippingCostUsd,
					p_coupon_code: coupon?.valid ? coupon.code : null,
				p_invoice: datosFactura(),
				// El servidor revalida que el reparto cubra el total que ÉL calcula:
				// si el cliente sumó un extra y no se recalculó, la orden no entra.
				p_payment_split: esHibrido ? { mercadopago: nMp, transfer: nTr } : null,
			});
			if (rpcErr) throw new Error(rpcErr.message);
			const orderId = orderIdData as number;

			// Transferencia Y depósito: le mandamos al comprador los datos para pagar
			// (y al admin el aviso de pedido pendiente). Antes esto sólo corría para
			// 'transfer', así que quien elegía depósito no recibía ningún mail.
			// No bloqueamos el checkout si el mail falla — el cliente igual ve los
			// datos en /thank-you.
			if (method === 'transfer' || method === 'deposit' || esHibrido) {
				try {
					await sendPaymentInstructionsEmail(orderId);
				} catch (mailErr) {
					console.warn('No se pudo enviar el mail con los datos de pago:', mailErr);
				}
			}

			// --- Pago combinado: falta cobrar la parte de MercadoPago ---
			// La orden ya existe y reservó el stock; acá sólo se pide la preferencia
			// por el monto de esa parte y se manda al cliente a pagarla. El mail con
			// los datos de la transferencia ya salió arriba.
			if (esHibrido) {
				guardarCuponRecuperado(null);
				try {
					const pref = await createMpPreference({
						existing_order_id: orderId,
						amount_usd: nMp,
					});
					window.location.href = pref.init_point;
					return;
				} catch (mpErr) {
					// La orden quedó creada y con el stock reservado: no se pierde nada.
					console.warn('preferencia MP del pago combinado:', mpErr);
					toast.error(
						'Registramos tu pedido, pero no pudimos abrir MercadoPago. Te contactamos para completarlo.'
					);
					navigate(`/checkout/${orderId}/thank-you?status=pending`);
					return;
				}
			}

			// El cleanCart sucede en ThankyouPage al montar; así evitamos el
			// flash de "carrito vacío" durante el navigate.
			// El cupón de recuperación ya se consumió: se limpia para que no se
			// vuelva a preaplicar en la próxima compra.
			guardarCuponRecuperado(null);

			toast.success('Pedido registrado. Te avisamos cuando confirmemos el pago.');
			navigate(`/checkout/${orderId}/thank-you?status=pending`);
		} catch (err) {
			toast.error((err as Error).message);
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<>
			{submitting && <CheckoutSubmittingOverlay method={method} />}
			<form className='flex flex-col gap-6' onSubmit={onSubmit}>
				{/* Vuelta desde el mail de recuperación: acá se revela el descuento. */}
				{recuperado && (
					<div
						className={`rounded-xl border p-4 ${
							coupon?.valid
								? 'border-emerald-300 bg-emerald-50'
								: 'border-amber-300 bg-amber-50'
						}`}
					>
						<p className='text-sm font-bold text-ink-900'>
							{coupon?.valid
								? `¡Listo! Tenés ${recuperado.percent}% de descuento en esta compra`
								: `Tu descuento del ${recuperado.percent}% está reservado`}
						</p>
						<p className='mt-1 text-[13px] leading-relaxed text-ink-700'>
							Es de <b>un solo uso</b> y sólo para tu cuenta. Se aplica{' '}
							<b>únicamente pagando por transferencia bancaria</b>: si elegís otro
							medio de pago, el pedido se toma sin descuento.
						</p>
						{discountUsd > 0 && (
							<p className='mt-2 text-sm font-semibold text-emerald-800'>
								Ahorrás {formatPrice(discountUsd)} — pagás{' '}
								{formatPrice(grandTotalUsd)} en vez de{' '}
								{formatPrice(totalAmount + effectiveShippingUsd)}
							</p>
						)}
						{recuperado.expiresAt && (
							<p className='mt-1 text-[11px] text-ink-500'>
								Válido hasta el{' '}
								{new Date(recuperado.expiresAt).toLocaleString('es-UY', {
									day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit',
								})}
								.
							</p>
						)}
					</div>
				)}

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
					{shipping.zone === 'montevideo' ? (
						// En Montevideo la ciudad es fija (Montevideo).
						<input
							className='border rounded p-2 bg-ink-50'
							value='Montevideo'
							readOnly
							aria-label='Ciudad'
						/>
					) : (
						<input
							className='border rounded p-2'
							placeholder='Ciudad / localidad'
							value={form.city}
							onChange={e => setForm({ ...form, city: e.target.value })}
							required
						/>
					)}
					{shipping.zone === 'montevideo' ? (
						// El "departamento" es Montevideo y queda fijo para que matchee
						// con la ciudad. No mostramos el select porque sería redundante.
						<input
							className='border rounded p-2 bg-ink-50'
							value='Montevideo'
							readOnly
							aria-label='Departamento'
						/>
					) : (
						<select
							className='border rounded p-2 bg-white'
							value={form.state}
							onChange={e => setForm({ ...form, state: e.target.value })}
							required
						>
							<option value=''>Departamento…</option>
							{URUGUAY_DEPARTMENTS_INTERIOR.map(d => (
								<option key={d} value={d}>
									{d}
								</option>
							))}
						</select>
					)}
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

			{/* Factura con RUT. Los campos son los que pide DGI para una e-Factura:
			    sin RUT, razón social y domicilio fiscal el comprobante no se puede
			    emitir, así que son obligatorios apenas se tilda la casilla. */}
			<section className='space-y-3'>
				<label className='flex items-start gap-2 cursor-pointer'>
					<input
						type='checkbox'
						checked={wantsInvoice}
						onChange={e => setWantsInvoice(e.target.checked)}
						className='mt-1'
					/>
					<span>
						<span className='block font-medium'>Necesito factura con RUT</span>
						<span className='block text-xs text-ink-500'>
							Para empresas. Si no la pedís, te emitimos un ticket a consumidor final.
						</span>
					</span>
				</label>

				{wantsInvoice && (
					<div className='space-y-3 rounded-lg border border-ink-200 bg-ink-50/60 p-4'>
						<div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
							<label className='block'>
								<span className='mb-1 block text-xs font-semibold text-ink-700'>
									RUT *
								</span>
								<input
									className={`w-full rounded border p-2 ${
										invoice.rut && !rutOk ? 'border-rose-400' : ''
									}`}
									placeholder='12 dígitos'
									inputMode='numeric'
									value={invoice.rut}
									onChange={e => setInvoice({ ...invoice, rut: e.target.value })}
								/>
								{invoice.rut && !rutOk && (
									<span className='mt-1 block text-[11px] text-rose-600'>
										El RUT tiene 12 dígitos (van {rutDigits.length}).
									</span>
								)}
							</label>
							<label className='block'>
								<span className='mb-1 block text-xs font-semibold text-ink-700'>
									Razón social *
								</span>
								<input
									className='w-full rounded border p-2'
									placeholder='Como figura en DGI'
									value={invoice.businessName}
									onChange={e =>
										setInvoice({ ...invoice, businessName: e.target.value })
									}
								/>
							</label>
							<label className='block sm:col-span-2'>
								<span className='mb-1 block text-xs font-semibold text-ink-700'>
									Domicilio fiscal *
								</span>
								<input
									className='w-full rounded border p-2'
									placeholder='Calle y número'
									value={invoice.address}
									onChange={e => setInvoice({ ...invoice, address: e.target.value })}
								/>
							</label>
							<label className='block'>
								<span className='mb-1 block text-xs font-semibold text-ink-700'>
									Localidad
								</span>
								<input
									className='w-full rounded border p-2'
									value={invoice.city}
									onChange={e => setInvoice({ ...invoice, city: e.target.value })}
								/>
							</label>
							<label className='block'>
								<span className='mb-1 block text-xs font-semibold text-ink-700'>
									Departamento
								</span>
								<input
									className='w-full rounded border p-2'
									value={invoice.state}
									onChange={e => setInvoice({ ...invoice, state: e.target.value })}
								/>
							</label>
							<label className='block'>
								<span className='mb-1 block text-xs font-semibold text-ink-700'>
									Nombre comercial
								</span>
								<input
									className='w-full rounded border p-2'
									placeholder='Opcional'
									value={invoice.tradeName}
									onChange={e =>
										setInvoice({ ...invoice, tradeName: e.target.value })
									}
								/>
							</label>
							<label className='block'>
								<span className='mb-1 block text-xs font-semibold text-ink-700'>
									Mail para la factura
								</span>
								<input
									type='email'
									className='w-full rounded border p-2'
									placeholder={form.email || 'Opcional'}
									value={invoice.email}
									onChange={e => setInvoice({ ...invoice, email: e.target.value })}
								/>
							</label>
						</div>
						<p className='text-[11px] text-ink-500'>
							* Obligatorios. Sin estos datos no podemos emitir la factura.
						</p>
					</div>
				)}
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

					{/* Pago combinado: para cuando la tarjeta no cubre todo el pedido. */}
					<label
						className={`flex items-start gap-2 rounded border p-3 cursor-pointer ${
							esHibrido ? 'border-brand-400 bg-brand-50/50' : ''
						}`}
					>
						<input
							type='checkbox'
							checked={esHibrido}
							onChange={e => {
								setMethod(e.target.checked ? 'hybrid' : 'mercadopago');
								setSplitMp('');
								setSplitTr('');
							}}
							className='mt-1'
						/>
						<span>
							<span className='block font-medium'>
								Pago combinado: MercadoPago + transferencia
							</span>
							<span className='block text-xs text-ink-500'>
								Pagás una parte con tarjeta y el resto por transferencia.
							</span>
						</span>
					</label>
				</div>

				{esHibrido && (
					<div className='space-y-3 rounded-lg border border-brand-200 bg-brand-50/40 p-4'>
						<p className='text-sm text-ink-700'>
							Repartí el total de <b>{formatPrice(grandTotalUsd)}</b> entre los dos
							medios. Completá uno y el otro se calcula solo.
						</p>

						<div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
							<label className='block'>
								<span className='mb-1 block text-xs font-semibold text-ink-700'>
									Con MercadoPago (USD)
								</span>
								<input
									type='text'
									inputMode='decimal'
									className='w-full rounded border p-2'
									placeholder='0,00'
									value={splitMp}
									onChange={e => setSplitMp(e.target.value.replace(/[^\d.,]/g, ''))}
									onBlur={() => completarResto('mp')}
								/>
							</label>
							<label className='block'>
								<span className='mb-1 block text-xs font-semibold text-ink-700'>
									Por transferencia (USD)
								</span>
								<input
									type='text'
									inputMode='decimal'
									className='w-full rounded border p-2'
									placeholder='0,00'
									value={splitTr}
									onChange={e => setSplitTr(e.target.value.replace(/[^\d.,]/g, ''))}
									onBlur={() => completarResto('tr')}
								/>
							</label>
						</div>

						{/* Estado del reparto, siempre a la vista. */}
						{splitOk ? (
							<p className='rounded-md bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800'>
								✓ El reparto cubre el total: {formatPrice(nMp)} con MercadoPago y{' '}
								{formatPrice(nTr)} por transferencia.
							</p>
						) : (
							<p className='rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800'>
								{nMp <= 0 || nTr <= 0
									? 'Cargá un monto en los dos medios para continuar.'
									: faltaSplit > 0
									? `Faltan ${formatPrice(faltaSplit)} para llegar al total.`
									: `Te estás pasando por ${formatPrice(Math.abs(faltaSplit))}.`}
							</p>
						)}

						<p className='text-xs text-ink-600'>
							Tu pedido queda <b>reservado 24 horas</b> y se procesa cuando estén
							acreditados los dos pagos. Después de confirmar te mostramos los datos
							para la transferencia y te llevamos a MercadoPago.
						</p>
					</div>
				)}

				{(method === 'transfer' || esHibrido) && (
					<div className='bg-gray-50 p-3 rounded text-sm space-y-2'>
						<div className='flex items-center justify-between rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2'>
							<span className='font-semibold text-emerald-800'>
								{esHibrido ? 'A transferir (parte del pago)' : 'Monto a transferir'}
							</span>
							<span className='text-right'>
								<span className='block font-bold text-base text-ink-900'>
									{formatPrice(esHibrido ? nTr : grandTotalUsd)}
								</span>
								{montoTransferUyu !== null && (
									<span className='block text-[11px] text-emerald-700'>
										≈ UYU {montoTransferUyu.toLocaleString('es-UY')} (al dólar BROU de hoy)
									</span>
								)}
							</span>
						</div>
						{transferInfo.banco && (
							<p><strong>Banco:</strong> {transferInfo.banco}</p>
						)}
						{transferInfo.titular && (
							<p><strong>Titular:</strong> {transferInfo.titular}</p>
						)}
						{transferInfo.rut && (
							<p><strong>RUT:</strong> {transferInfo.rut}</p>
						)}
						{transferInfo.moneda && (
							<p><strong>Moneda:</strong> {transferInfo.moneda}</p>
						)}
						{(transferInfo.cuenta_santander || transferInfo.sucursal_santander) && (
							<div className='border-t border-gray-200 pt-2 mt-2'>
								<p className='font-semibold text-xs uppercase text-gray-600 mb-1'>
									Dentro de Santander
								</p>
								{transferInfo.cuenta_santander && (
									<p><strong>Cuenta:</strong> {transferInfo.cuenta_santander}</p>
								)}
								{transferInfo.sucursal_santander && (
									<p><strong>Sucursal:</strong> {transferInfo.sucursal_santander}</p>
								)}
							</div>
						)}
						{transferInfo.cuenta_externa && (
							<div className='border-t border-gray-200 pt-2 mt-2'>
								<p className='font-semibold text-xs uppercase text-gray-600 mb-1'>
									Desde otros bancos
								</p>
								<p><strong>Cuenta:</strong> {transferInfo.cuenta_externa}</p>
							</div>
						)}
						<p className='pt-2 text-xs text-gray-600'>
							Vas a poder enviarnos el comprobante después de confirmar el pedido (subiéndolo, por mail o WhatsApp).
						</p>
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
						<p className='pt-2 text-xs text-gray-600'>
							Vas a poder enviarnos el comprobante después de confirmar el pedido (subiéndolo, por mail o WhatsApp).
						</p>
					</div>
				)}
			</section>

			{/* Resumen (mobile) */}
			<div className='md:hidden'>
				<ItemsCheckout />
			</div>

{/* Cupon de descuento */}
				<div className='border-t border-ink-200 pt-3'>
					{!coupon?.valid ? (
						<div className='flex flex-col gap-1'>
							<label className='text-sm font-medium text-ink-700'>¿Tenés un código de descuento?</label>
							<div className='flex gap-2'>
								<input
									className='border rounded p-2 flex-1 uppercase'
									placeholder='Ingresá tu código'
									value={couponInput}
									onChange={e => setCouponInput(e.target.value.toUpperCase())}
									onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyCoupon(); } }}
								/>
								<button
									type='button'
									onClick={() => applyCoupon()}
									disabled={applyingCoupon || !couponInput.trim()}
									className='px-4 py-2 bg-stone-800 text-white rounded-md text-sm disabled:opacity-50'
								>
									{applyingCoupon ? '...' : 'Aplicar'}
								</button>
							</div>
							{couponMsg && <p className='text-xs text-rose-600'>{couponMsg}</p>}
						</div>
					) : (
						<div className='flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-md p-2.5'>
							<p className='text-sm text-emerald-800'>
								Cupón <b>{coupon.code}</b> aplicado
								{couponFreeShipping ? ' — envío gratis' : discountUsd > 0 ? ` — ${formatPrice(discountUsd)} off` : ''}
							</p>
							<button type='button' onClick={removeCoupon} className='text-xs font-semibold text-rose-600 hover:text-rose-800'>Quitar</button>
						</div>
					)}
				</div>

			<div className='space-y-1 border-t border-ink-200 pt-3'>
				<div className='flex items-center justify-between text-sm text-ink-600'>
					<span>Subtotal</span>
					<span>{formatPrice(totalAmount)}</span>
				</div>
				<div className='flex items-center justify-between text-sm text-ink-600'>
					<span>
						Envío{' '}
						{shipping.zone === 'interior'
							? '(DAC)'
							: shipping.zone === 'metropolitana'
							? '(agencia)'
							: ''}
					</span>
					<span>{shippingInfo.label}</span>
				</div>
				{shippingInfo.note && (
					<p className='text-[11px] text-ink-500'>{shippingInfo.note}</p>
				)}
				{shipping.zone === 'montevideo' &&
					!qualifiesForFree &&
					totalAmount < FREE_SHIPPING_MIN_USD && (
						<p className='text-[11px] text-amber-700'>
							Sumá USD {(FREE_SHIPPING_MIN_USD - totalAmount).toFixed(0)} más para
							obtener envío gratis en Montevideo.
						</p>
					)}
{discountUsd > 0 && (
						<div className='flex items-center justify-between text-sm text-emerald-700'>
							<span>Descuento ({coupon?.code})</span>
							<span>- {formatPrice(discountUsd)}</span>
						</div>
					)}
					{couponFreeShipping && (
						<div className='flex items-center justify-between text-sm text-emerald-700'>
							<span>Envío (cupón {coupon?.code})</span>
							<span>Gratis</span>
						</div>
					)}
				<div className='flex items-center justify-between gap-3 pt-2 border-t border-ink-100'>
					<p className='text-sm font-semibold text-gray-700'>Total a pagar</p>
					<div className='text-right'>
						<p className='font-bold text-lg'>{formatPrice(grandTotalUsd)}</p>
						{method === 'mercadopago' && totalUyu !== null && fx && (
							<p className='text-[11px] text-gray-500'>
								≈ UYU {totalUyu.toLocaleString('es-UY')}{' '}
								<span title={`Cotización: ${fx.rate.toFixed(2)} (${fx.source})`}>
									(al dólar BROU de hoy)
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
		</>
	);
};

const CheckoutSubmittingOverlay = ({ method }: { method: Method }) => {
	const message =
		method === 'mercadopago'
			? 'Te estamos redirigiendo a Mercado Pago…'
			: 'Procesando tu pedido…';
	const sub =
		method === 'mercadopago'
			? 'No cierres ni recargues esta ventana.'
			: 'Estamos confirmando los datos. Esto demora unos segundos.';
	return (
		<div className='fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center animate-fade-in'>
			<div className='bg-white rounded-2xl shadow-2xl px-8 py-7 max-w-sm w-[90%] flex flex-col items-center gap-4'>
				<ImSpinner2 className='w-10 h-10 animate-spin text-brand-600' />
				<p className='text-base font-semibold text-ink-900 text-center'>
					{message}
				</p>
				<p className='text-xs text-ink-500 text-center leading-relaxed'>{sub}</p>
			</div>
		</div>
	);
};
