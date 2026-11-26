import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../../supabase/client';
import { useCartStore } from '../../store/cart.store';
import {
	getAppSettings,
	getPlacetopayStatus,
	refundPlacetopay,
	updateAppSetting,
	type PlacetopayMode,
} from '../../actions/cdr';

/* ==========================================================================
 * Getnet (Placetopay) · Homologación
 * Todo en un lugar para la reunión de pruebas: interruptor, botón para armar un
 * pago de prueba, tarjetas de prueba por escenario y el registro en vivo de
 * cada sesión con sus acciones (consultar estado, reembolsar, ver orden).
 * Las tarjetas son las de la doc oficial (docs.placetopay.dev/gateway/testing-card):
 * sólo funcionan en el ambiente de PRUEBAS (uy-uat-checkout.placetopay.com).
 * ========================================================================== */

interface Scenario {
	id: string;
	title: string;
	card: string;
	extra?: string;
	expected: string;
	check: string;
	product?: 'cheap' | 'expensive';
}

const SCENARIOS: Scenario[] = [
	{
		id: 'aprobada',
		title: '1. Pago aprobado',
		card: '4110760000000081',
		extra: 'Visa · vencimiento futuro cualquiera · CVV cualquiera',
		expected: 'APPROVED',
		check: 'Vuelve a la página de gracias con "Pago aprobado"; la orden pasa a Concretado y se descuenta stock; llega el mail de confirmación.',
	},
	{
		id: 'aprobada-mc',
		title: '2. Aprobado Mastercard',
		card: '5367680000000005',
		extra: 'Mastercard',
		expected: 'APPROVED',
		check: 'Igual que el 1, con otra franquicia.',
	},
	{
		id: 'rechazada',
		title: '3. Pago rechazado',
		card: '4110760000000016',
		extra: 'Visa',
		expected: 'REJECTED',
		check: 'Página de gracias muestra "rechazado" y deja reintentar; la orden NO queda paga y no descuenta stock.',
	},
	{
		id: 'pend-aprob',
		title: '4. Pendiente → aprobado',
		card: '4110760000000073',
		extra: 'Visa',
		expected: 'PENDING → APPROVED',
		check: 'Queda "en revisión"; cuando Getnet lo resuelve entra la notificación (webhook) o la conciliación (cada 10 min, o el botón de abajo) y la orden pasa a Concretado.',
	},
	{
		id: 'pend-rech',
		title: '5. Pendiente → rechazado',
		card: '4048370000000037',
		extra: 'Visa',
		expected: 'PENDING → REJECTED',
		check: 'Queda "en revisión"; al resolverse la orden se cancela y libera.',
	},
	{
		id: 'demora',
		title: '6. Demora 180 s → aprobado',
		card: '4110760000000024',
		extra: 'Visa · tarda 3 minutos',
		expected: 'PENDING ~3 min → APPROVED',
		check: 'Muestra pendiente; usar "Consultar estado" o esperar la notificación.',
	},
	{
		id: '3ds',
		title: '7. 3D Secure (challenge)',
		card: '4110760000000008',
		extra: 'Visa · OTP del desafío: 12345',
		expected: 'APPROVED (3DS-C)',
		check: 'Pide el código de autenticación y aprueba.',
	},
	{
		id: 'monto',
		title: '8. Según monto (>USD 200 rechaza)',
		card: '4110760000000057',
		extra: 'Visa · usar el producto CARO',
		expected: 'REJECTED si supera USD 200',
		check: 'Con el producto barato aprueba; con el caro rechaza.',
		product: 'expensive',
	},
	{
		id: 'reintento',
		title: '8b. Rechazo y reintento en la misma sesión',
		card: '4110760000000016',
		extra: 'Primero esta (rechaza), después en la MISMA página de Getnet la 4110 7600 0000 0081',
		expected: 'REJECTED → APPROVED',
		check: 'Getnet deja reintentar dentro de la sesión (queda PENDING hasta que aprueba o se cierra). Al aprobar, la orden pasa a Concretado.',
	},
	{
		id: '3ds-rech',
		title: '8c. 3D Secure pendiente → rechazado',
		card: '4110760000000040',
		extra: 'Visa · 3DS-A',
		expected: 'PENDING → REJECTED',
		check: 'Igual que el 5: al resolverse se cancela la orden.',
	},
	{
		id: 'datos',
		title: '8d. Valida vencimiento y CVV',
		card: '4012888888881881',
		extra: 'Aprueba SÓLO con vencimiento 11/28 y CVV 917; con otros datos rechaza',
		expected: 'APPROVED / REJECTED',
		check: 'Muestra que el resultado viene del procesador, no de la tienda.',
	},
	{
		id: 'manual',
		title: '8e. Revisión manual → aprobado',
		card: '4212121212121214',
		extra: 'Visa · queda en validación manual',
		expected: 'PENDING → APPROVED',
		check: 'La orden queda en espera (no se vence sola mientras la sesión está PENDING) y se aprueba cuando Getnet la resuelve.',
	},
	{
		id: 'excepcion',
		title: '8f. Error del procesador',
		card: '4110760000000065',
		extra: 'Visa · el procesador tira excepción',
		expected: 'FAILED / REJECTED',
		check: 'No se marca pago; se muestra el mensaje de Getnet y se puede reintentar.',
	},
	{
		id: 'amex',
		title: '8g. American Express aprobada',
		card: '377222581193005',
		extra: 'Amex · CVV de 4 dígitos',
		expected: 'APPROVED',
		check: 'Otra franquicia.',
	},
	{
		id: 'diners',
		title: '8h. Diners aprobada',
		card: '36545400000008',
		extra: 'Diners',
		expected: 'APPROVED',
		check: 'Otra franquicia.',
	},
	{
		id: 'doble',
		title: '8i. Pago duplicado / doble pestaña',
		card: '—',
		extra: 'Con un pago en curso, volver al checkout del mismo pedido',
		expected: 'Reusa la sesión',
		check: 'No crea una segunda sesión: devuelve la misma página de pago; si ya no se puede reusar avisa "Ya hay un pago en curso". Una orden paga no se puede volver a cobrar.',
	},
	{
		id: 'cancel',
		title: '9. Cliente cancela / vuelve sin pagar',
		card: '—',
		extra: 'En la página de Getnet tocar "No deseo continuar" (cancelUrl) o "Volver al comercio" (returnUrl)',
		expected: 'REJECTED / sin pago',
		check: 'Vuelve a la tienda, la orden no queda paga, se puede pagar de nuevo.',
	},
	{
		id: 'reembolso',
		title: '10. Reembolso total',
		card: '—',
		extra: 'Sobre una orden aprobada',
		expected: 'REFUNDED',
		check: 'Botón "Reembolsar" en la tabla de abajo: Getnet devuelve, la orden queda reembolsada y sale el mail al cliente.',
	},
];

const FAQ: [string, string][] = [
	['Integración', 'WebCheckout (redirección). Todo servidor a servidor desde edge functions: las credenciales nunca llegan al navegador.'],
	['Autenticación', 'tranKey = Base64(SHA-256(nonce + seed + secretKey)), seed ISO 8601, nonce Base64, Content-Type application/json, TLS 1.2.'],
	['Moneda y monto', 'UYU. Precio de la tienda en USD convertido al dólar BROU venta congelado en la orden (igual que MercadoPago).'],
	['Referencia', 'RF-<número de pedido>. Descripción = los productos (máx. 250). Se mandan los ítems y los datos del comprador.'],
	['Expiración', 'Sesión de 60 minutos. Mientras la sesión sigue PENDING la orden no se vence ni libera stock.'],
	['returnUrl / cancelUrl', 'Ambas a /checkout/<pedido>/thank-you?pago=tarjeta. Al volver SIEMPRE consultamos la sesión (getRequestInformation), no confiamos en la redirección.'],
	['Notificación (webhook)', '…/functions/v1/placetopay-webhook. Valida la firma SHA-256 (requestId + status + date + secretKey, prefijo "sha256:"; acepta SHA-1 viejo), responde enseguida y re-consulta la sesión.'],
	['Si no llega la notificación', 'Conciliación automática cada 10 minutos de las sesiones PENDING (y el botón de esta página).'],
	['Aprobado', 'Se marca pagada en forma atómica, se descuenta stock, mail de confirmación. Si el monto/moneda cobrado no coincide con el pedido NO se marca pagada y se alerta.'],
	['Rechazado / vencido', 'REJECTED o PARTIAL_EXPIRED: la orden se cae y libera; el cliente puede volver a intentar (nuevo pedido).'],
	['Reembolso', 'Total, con action "reverse" sobre el internalReference de la transacción aprobada; la orden queda reembolsada y se avisa al cliente.'],
	['No usamos', 'Pagos parciales (allowPartial=false), pagos mixtos, tokenización/recurrencia, preautorización, dispersión. locale es_UY.'],
	['Página de respuesta', 'Muestra referencia, estado, fecha y hora, monto, medio de pago y últimos 4, banco, autorización, recibo, nº de transacción y mensaje de Getnet.'],
];

interface SessionRow {
	order_id: number;
	reference: string | null;
	request_id: number | string | null;
	status: string | null;
	message: string | null;
	payment_method_name: string | null;
	last_digits: string | null;
	authorization_code: string | null;
	receipt: string | null;
	internal_reference: number | string | null;
	currency: string | null;
	amount: number | null;
	paid_amount: number | null;
	refunded: boolean | null;
	refund_status: string | null;
	process_url: string | null;
	created_at: string;
	updated_at?: string | null;
}

interface OrderLite {
	id: number;
	status: string | null;
	payment_status: string | null;
	total_amount: number | null;
	total_original: number | null;
}

const STATUS_CLS: Record<string, string> = {
	APPROVED: 'bg-emerald-100 text-emerald-800',
	REJECTED: 'bg-red-100 text-red-800',
	PENDING: 'bg-amber-100 text-amber-800',
	FAILED: 'bg-red-100 text-red-800',
};

const copy = (txt: string) => {
	navigator.clipboard?.writeText(txt.replace(/\s/g, '')).then(
		() => toast.success(`Copiado: ${txt}`),
		() => toast.error('No se pudo copiar')
	);
};

export const DashboardGetnetPage = () => {
	const qc = useQueryClient();
	const navigate = useNavigate();
	const addItem = useCartStore(s => s.addItem);
	const cleanCart = useCartStore(s => s.cleanCart);
	const [busy, setBusy] = useState<string | null>(null);

	const { data: settings } = useQuery({ queryKey: ['app_settings'], queryFn: getAppSettings });
	const mode = (String(settings?.get('placetopay_mode') ?? 'off') as PlacetopayMode) || 'off';

	const setMode = useMutation({
		mutationFn: (m: PlacetopayMode) => updateAppSetting('placetopay_mode', m),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['app_settings'] });
			qc.invalidateQueries({ queryKey: ['feature_flag', 'placetopay_mode'] });
			toast.success('Modo actualizado');
		},
		onError: (e: Error) => toast.error(e.message),
	});

	// Registro en vivo: cada sesión de pago con su orden.
	const { data: rows = [], isFetching } = useQuery({
		queryKey: ['getnet_sessions'],
		refetchInterval: 5000,
		queryFn: async () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const { data, error } = await (supabase as any)
				.from('placetopay_sessions')
				.select('*')
				.order('created_at', { ascending: false })
				.limit(40);
			if (error) throw new Error(error.message);
			const sessions = (data ?? []) as SessionRow[];
			const ids = [...new Set(sessions.map(s => s.order_id))];
			const orders = new Map<number, OrderLite>();
			if (ids.length) {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const { data: os } = await (supabase as any)
					.from('orders')
					.select('id, status, payment_status, total_amount, total_original')
					.in('id', ids);
				((os ?? []) as OrderLite[]).forEach(o => orders.set(Number(o.id), o));
			}
			return sessions.map(s => ({ ...s, order: orders.get(s.order_id) ?? null }));
		},
	});

	const refresh = () => qc.invalidateQueries({ queryKey: ['getnet_sessions'] });

	// Arma el carrito con UN producto real (barato <USD 200 o caro >USD 200) y va
	// al checkout, que para admins ya viene con "Tarjeta (Getnet)" elegida.
	const startTestPurchase = async (kind: 'cheap' | 'expensive') => {
		setBusy(kind);
		try {
			let q = supabase
				.from('products_with_price')
				.select('id, name, slug, images, price, source, external_code, online_payment')
				.eq('source', 'cdr')
				.not('price', 'is', null);
			q = kind === 'cheap'
				? q.gte('price', 5).lte('price', 60).order('price', { ascending: true })
				: q.gt('price', 220).lte('price', 600).order('price', { ascending: true });
			const { data: prods, error } = await q.limit(15);
			if (error) throw new Error(error.message);
			// Nombres sin comillas ni símbolos: Getnet rechaza la descripción con
			// caracteres como " (p. ej. 16" OLED) mientras no se deploye el saneo.
			const SAFE = /^[\p{L}\p{N} .,\-()/+]+$/u;
			for (const p of (prods ?? []).filter(x => SAFE.test(String(x.name ?? '')))) {
				const { data: vars } = await supabase
					.from('variants')
					.select('id, stock')
					.eq('product_id', p.id as string)
					.gt('stock', 0)
					.order('stock', { ascending: false })
					.limit(1);
				const v = vars?.[0];
				if (!v) continue;
				cleanCart();
				addItem({
					variantId: v.id as string,
					productId: p.id as string,
					name: p.name as string,
					image: ((p.images as string[] | null) ?? [])[0] ?? '',
					color: '',
					storage: '',
					price: Number(p.price),
					quantity: 1,
					source: 'cdr',
					externalCode: (p.external_code as string | null) ?? null,
					onlinePayment: (p.online_payment as boolean | null) === true,
					stock: Number(v.stock),
				});
				toast.success(`Carrito de prueba: ${p.name} (USD ${p.price})`);
				navigate('/checkout');
				return;
			}
			toast.error('No encontré un producto con stock en ese rango de precio');
		} catch (e) {
			toast.error((e as Error).message);
		} finally {
			setBusy(null);
		}
	};

	const status = useMutation({
		mutationFn: (orderId: number) => getPlacetopayStatus(orderId),
		onSuccess: (r, orderId) => {
			toast.success(`#${orderId}: ${r.session_status ?? r.result} ${r.message ? `— ${r.message}` : ''}`, { duration: 6000 });
			refresh();
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const refund = useMutation({
		mutationFn: (orderId: number) => refundPlacetopay(orderId),
		onSuccess: (r, orderId) => {
			toast.success(`Reembolso #${orderId} OK${r.mail?.sent ? ` · mail a ${r.mail.to}` : ''}`, { duration: 6000 });
			refresh();
		},
		onError: (e: Error) => toast.error(e.message, { duration: 8000 }),
	});

	const reconcile = useMutation({
		mutationFn: async () => {
			const { data, error } = await supabase.functions.invoke('placetopay-reconcile', { body: {} });
			if (error) throw new Error(error.message);
			return data as { ok: boolean; checked?: number; error?: string };
		},
		onSuccess: r => {
			if (r?.ok) toast.success(`Conciliación: ${r.checked ?? 0} sesión(es) pendiente(s) revisada(s)`);
			else toast.error(r?.error ?? 'La conciliación falló');
			refresh();
		},
		onError: (e: Error) => toast.error(e.message),
	});

	return (
		<div className='space-y-6'>
			<div className='flex flex-wrap items-start justify-between gap-3'>
				<div>
					<h1 className='text-2xl font-bold text-ink-900'>Getnet · Homologación</h1>
					<p className='text-sm text-ink-500'>
						Pago con tarjeta por Placetopay. Ambiente de <b>PRUEBAS</b> (uy-uat-checkout.placetopay.com): no se cobra nada real.
					</p>
				</div>
				<div className='flex items-center gap-2 rounded-xl border border-ink-200 bg-white p-2 text-sm'>
					<span className='px-1 font-semibold text-ink-700'>Tarjeta en la tienda:</span>
					{(['off', 'admins', 'all'] as PlacetopayMode[]).map(m => (
						<button
							key={m}
							type='button'
							disabled={setMode.isPending}
							onClick={() => {
								if (m === 'all' && !window.confirm('Esto muestra "Tarjeta (Getnet)" a TODOS los clientes. ¿Seguro?')) return;
								setMode.mutate(m);
							}}
							className={`rounded-full px-3 py-1 font-semibold ${mode === m ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-ink-50'}`}
						>
							{m === 'off' ? 'Apagado' : m === 'admins' ? 'Sólo admins' : 'Todos'}
						</button>
					))}
				</div>
			</div>

			{mode === 'off' && (
				<p className='rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700'>
					La tarjeta está apagada: para probar poné "Sólo admins".
				</p>
			)}

			{/* Escenarios */}
			<section className='rounded-2xl border border-ink-200/70 bg-white p-5 shadow-soft'>
				<h2 className='mb-1 font-bold text-ink-900'>Casos de prueba ({SCENARIOS.length})</h2>
				<p className='mb-3 text-sm text-ink-500'>"▶ Probar" copia la tarjeta del caso y te lleva al checkout con el carrito armado. En la página de Getnet pegás la tarjeta (Ctrl+V). Al volver, el resultado aparece en "Sesiones de pago" (abajo).</p>
				<div className='overflow-x-auto'>
					<table className='w-full text-left text-sm'>
						<thead className='bg-ink-50 text-xs uppercase text-ink-500'>
							<tr>
								<th className='px-3 py-2'>Escenario</th>
								<th className='px-3 py-2'>Tarjeta</th>
								<th className='px-3 py-2'>Resultado</th>
								<th className='px-3 py-2'>Qué tiene que pasar</th>
								<th className='px-3 py-2'></th>
							</tr>
						</thead>
						<tbody className='divide-y divide-ink-100'>
							{SCENARIOS.map(s => (
								<tr key={s.id} className='align-top'>
									<td className='px-3 py-2 font-semibold text-ink-900'>{s.title}</td>
									<td className='px-3 py-2'>
										{s.card !== '—' ? (
											<button
												type='button'
												onClick={() => copy(s.card)}
												title='Copiar'
												className='rounded-md bg-ink-50 px-2 py-1 font-mono text-[13px] font-bold text-ink-900 ring-1 ring-ink-200 hover:bg-ink-100'
											>
												{s.card.replace(/(\d{4})(?=\d)/g, '$1 ')} 📋
											</button>
										) : (
											<span className='text-ink-400'>—</span>
										)}
										{s.extra && <p className='mt-1 text-xs text-ink-500'>{s.extra}</p>}
									</td>
									<td className='px-3 py-2 font-mono text-xs font-bold text-ink-700'>{s.expected}</td>
									<td className='px-3 py-2 text-xs text-ink-600'>{s.check}</td>
									<td className='px-3 py-2'>
										{s.id !== 'reembolso' && (
											<button
												type='button'
												disabled={!!busy || mode === 'off'}
												onClick={() => {
													if (s.card !== '—') copy(s.card);
													startTestPurchase(s.product ?? 'cheap');
												}}
												className='whitespace-nowrap rounded-full bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-ink-800 disabled:opacity-50'
											>
												▶ Probar
											</button>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
				<p className='mt-3 text-xs text-ink-500'>
					Vencimiento: cualquier fecha futura · CVV: cualquiera de 3 dígitos (Amex 4) · OTP: 123456 · OTP del desafío 3DS: 12345.
					Más tarjetas: docs.placetopay.dev/gateway/testing-card
				</p>
			</section>

			{/* Pago de prueba */}
			<section className='rounded-2xl border border-ink-200/70 bg-white p-5 shadow-soft'>
				<h2 className='mb-1 font-bold text-ink-900'>Hacer un pago de prueba</h2>
				<p className='mb-3 text-sm text-ink-500'>
					Arma el carrito con un producto real y te lleva al checkout con "Tarjeta (Getnet)" elegida. Completás los
					datos, tocás pagar, y en la página de Getnet usás la tarjeta del escenario. Al volver, la sesión aparece abajo.
				</p>
				<div className='flex flex-wrap gap-2'>
					<button
						type='button'
						disabled={!!busy || mode === 'off'}
						onClick={() => startTestPurchase('cheap')}
						className='rounded-full bg-ink-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-ink-800 disabled:opacity-50'
					>
						{busy === 'cheap' ? 'Armando…' : '▶ Pago de prueba (producto barato < USD 200)'}
					</button>
					<button
						type='button'
						disabled={!!busy || mode === 'off'}
						onClick={() => startTestPurchase('expensive')}
						className='rounded-full border border-ink-300 px-5 py-2.5 text-sm font-semibold text-ink-800 hover:bg-ink-50 disabled:opacity-50'
					>
						{busy === 'expensive' ? 'Armando…' : '▶ Pago de prueba (producto caro > USD 200)'}
					</button>
				</div>
				<p className='mt-2 text-xs text-ink-500'>
					Cobra en pesos (total en USD × dólar BROU), igual que MercadoPago. Si un pedido aprobado era de prueba, reembolsalo abajo.
				</p>
			</section>

			{/* Machete técnico */}
			<section className='rounded-2xl border border-ink-200/70 bg-white p-5 shadow-soft'>
				<h2 className='mb-3 font-bold text-ink-900'>Si te preguntan cómo está hecho</h2>
				<dl className='grid gap-x-6 gap-y-2 text-sm md:grid-cols-2'>
					{FAQ.map(([q, a]) => (
						<div key={q}>
							<dt className='font-semibold text-ink-900'>{q}</dt>
							<dd className='text-ink-600'>{a}</dd>
						</div>
					))}
				</dl>
			</section>

			{/* Registro en vivo */}
			<section className='rounded-2xl border border-ink-200/70 bg-white p-5 shadow-soft'>
				<div className='mb-3 flex flex-wrap items-center justify-between gap-2'>
					<h2 className='font-bold text-ink-900'>
						Sesiones de pago {isFetching && <span className='text-xs font-normal text-ink-400'>actualizando…</span>}
					</h2>
					<div className='flex gap-2'>
						<button
							type='button'
							disabled={reconcile.isPending}
							onClick={() => reconcile.mutate()}
							className='rounded-full border border-ink-300 px-4 py-1.5 text-xs font-semibold text-ink-800 hover:bg-ink-50 disabled:opacity-50'
						>
							{reconcile.isPending ? 'Conciliando…' : '↻ Conciliar pendientes ahora'}
						</button>
						<button
							type='button'
							onClick={refresh}
							className='rounded-full border border-ink-300 px-4 py-1.5 text-xs font-semibold text-ink-800 hover:bg-ink-50'
						>
							Refrescar
						</button>
					</div>
				</div>
				{rows.length === 0 ? (
					<p className='text-sm text-ink-500'>Todavía no hay sesiones.</p>
				) : (
					<div className='overflow-x-auto'>
						<table className='w-full text-left text-xs'>
							<thead className='bg-ink-50 uppercase text-ink-500'>
								<tr>
									<th className='px-2 py-2'>Fecha</th>
									<th className='px-2 py-2'>Orden / Ref.</th>
									<th className='px-2 py-2'>Sesión</th>
									<th className='px-2 py-2'>Estado Getnet</th>
									<th className='px-2 py-2'>Tarjeta · Autorización</th>
									<th className='px-2 py-2 text-right'>Monto</th>
									<th className='px-2 py-2'>Orden</th>
									<th className='px-2 py-2'>Acciones</th>
								</tr>
							</thead>
							<tbody className='divide-y divide-ink-100'>
								{rows.map(r => {
									const st = String(r.status ?? '').toUpperCase();
									const o = r.order;
									const canRefund = o?.payment_status === 'paid' && st === 'APPROVED' && !r.refunded;
									return (
										<tr key={`${r.order_id}-${r.request_id}`} className='align-top'>
											<td className='whitespace-nowrap px-2 py-2 text-ink-600'>
												{new Date(r.created_at).toLocaleString('es-UY', { dateStyle: 'short', timeStyle: 'medium' })}
											</td>
											<td className='px-2 py-2'>
												<Link to={`/dashboard/ordenes/${r.order_id}`} className='font-semibold text-brand-700 hover:underline'>
													#{r.order_id}
												</Link>
												<div className='text-ink-500'>{r.reference}</div>
											</td>
											<td className='px-2 py-2 font-mono text-ink-700'>{r.request_id}</td>
											<td className='px-2 py-2'>
												<span className={`rounded-full px-2 py-0.5 font-bold ${STATUS_CLS[st] ?? 'bg-ink-100 text-ink-700'}`}>
													{st || '—'}
												</span>
												{r.refunded && <span className='ml-1 rounded-full bg-violet-100 px-2 py-0.5 font-bold text-violet-800'>REEMBOLSADO</span>}
												{r.message && <div className='mt-1 max-w-[220px] text-ink-500'>{r.message}</div>}
												{!r.refunded && r.refund_status && (
													<div className='mt-1 text-red-700'>Reembolso: {r.refund_status}</div>
												)}
											</td>
											<td className='px-2 py-2 text-ink-700'>
												{r.payment_method_name ?? '—'}
												{r.last_digits ? ` ···${r.last_digits}` : ''}
												{r.authorization_code && <div className='text-ink-500'>Aut. {r.authorization_code}</div>}
												{r.receipt && <div className='text-ink-500'>Recibo {r.receipt}</div>}
												{r.internal_reference != null && <div className='text-ink-500'>Ref. int. {r.internal_reference}</div>}
											</td>
											<td className='whitespace-nowrap px-2 py-2 text-right font-semibold text-ink-900'>
												{r.currency} {Number(r.paid_amount ?? r.amount ?? 0).toLocaleString('es-UY')}
											</td>
											<td className='px-2 py-2 text-ink-700'>
												{o?.status ?? '—'}
												<div className='text-ink-500'>{o?.payment_status ?? ''}</div>
											</td>
											<td className='px-2 py-2'>
												<div className='flex flex-col items-start gap-1'>
													<button
														type='button'
														disabled={status.isPending}
														onClick={() => status.mutate(r.order_id)}
														className='font-semibold text-brand-700 hover:underline disabled:opacity-50'
													>
														Consultar estado
													</button>
													{st === 'PENDING' && r.process_url && (
														<a href={r.process_url} target='_blank' rel='noreferrer' className='font-semibold text-brand-700 hover:underline'>
															Abrir pago
														</a>
													)}
													{canRefund && (
														<button
															type='button'
															disabled={refund.isPending}
															onClick={() => {
																if (window.confirm(`¿Reembolsar el TOTAL de la orden #${r.order_id}?`)) refund.mutate(r.order_id);
															}}
															className='font-semibold text-red-700 hover:underline disabled:opacity-50'
														>
															Reembolsar
														</button>
													)}
												</div>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				)}
			</section>
		</div>
	);
};
