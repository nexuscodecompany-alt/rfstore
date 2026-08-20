import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
	HiOutlineShieldCheck,
	HiOutlineExclamationTriangle,
	HiOutlinePaperAirplane,
} from 'react-icons/hi2';
import { getAppSettings, updateAppSetting } from '../../actions';
import { NumInput } from './NumInput';

/**
 * Configuración de la campaña de carritos abandonados.
 *
 * Vive dentro de Cupones porque lo que hace, en el fondo, es fabricar cupones
 * personales de forma automática.
 *
 * El punto delicado de esta pantalla son los DOS candados: la campaña sólo
 * manda mails si está encendida Y el modo prueba está apagado. Están arriba de
 * todo y explicados, para que nadie los desactive sin entender qué significa.
 */

export interface AbandonedCartConfig {
	enabled: boolean;
	test_mode: boolean;
	test_recipients: string[];
	delay_minutes: number;
	second_delay_hours: number;
	max_reminders: number;
	min_total_usd: number;
	quiet_hours: [number, number];
	max_per_run: number;
	exclude_emails: string[];
	coupon: { percent: number; valid_hours: number; payment_methods: string[] };
}

const DEFAULTS: AbandonedCartConfig = {
	enabled: false,
	test_mode: true,
	test_recipients: [],
	delay_minutes: 30,
	second_delay_hours: 24,
	max_reminders: 2,
	min_total_usd: 30,
	quiet_hours: [22, 9],
	max_per_run: 50,
	exclude_emails: [],
	coupon: { percent: 5, valid_hours: 48, payment_methods: ['transfer'] },
};

const KEY = 'abandoned_cart_config';
const listaATexto = (a: string[]) => (a ?? []).join(', ');
const textoALista = (s: string) =>
	s.split(',').map(x => x.trim()).filter(Boolean);

export const AbandonedCartConfigSection = () => {
	const qc = useQueryClient();
	const { data: settings, isLoading } = useQuery({
		queryKey: ['app_settings'],
		queryFn: getAppSettings,
	});

	const [cfg, setCfg] = useState<AbandonedCartConfig>(DEFAULTS);
	const [testMails, setTestMails] = useState('');
	const [excluidos, setExcluidos] = useState('');

	useEffect(() => {
		if (!settings) return;
		const v = settings.get(KEY) as Partial<AbandonedCartConfig> | undefined;
		if (!v) return;
		const merged = { ...DEFAULTS, ...v, coupon: { ...DEFAULTS.coupon, ...(v.coupon ?? {}) } };
		setCfg(merged);
		setTestMails(listaATexto(merged.test_recipients));
		setExcluidos(listaATexto(merged.exclude_emails));
	}, [settings]);

	const { mutate: guardar, isPending } = useMutation({
		mutationFn: async (next: AbandonedCartConfig) => {
			if (next.enabled && !next.test_mode && next.coupon.percent > 25) {
				throw new Error('Un descuento mayor al 25% con la campaña abierta parece un error. Revisalo.');
			}
			if (next.enabled && next.test_mode && textoALista(testMails).length === 0) {
				throw new Error('En modo prueba tenés que poner al menos un mail de destino, si no no sale nada.');
			}
			await updateAppSetting(KEY, next);
		},
		onSuccess: () => {
			toast.success('Campaña guardada');
			qc.invalidateQueries({ queryKey: ['app_settings'] });
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const onSave = () =>
		guardar({
			...cfg,
			test_recipients: textoALista(testMails),
			exclude_emails: textoALista(excluidos),
		});

	if (isLoading) {
		return (
			<div className='rounded-2xl border border-ink-200 bg-white p-8 text-center text-sm text-ink-400'>
				Cargando…
			</div>
		);
	}

	// El estado real: hacen falta las dos cosas para que salga un mail.
	const mandaMails = cfg.enabled && !cfg.test_mode;

	return (
		<div className='space-y-4'>
			<div>
				<h2 className='text-xl font-bold text-ink-900'>Carritos abandonados</h2>
				<p className='text-sm text-ink-500'>
					Le escribe a quien llegó al pago y no compró, con un cupón personal que
					vale sólo por transferencia.
				</p>
			</div>

			{/* Estado, en grande y sin ambigüedad */}
			<div
				className={`flex items-start gap-3 rounded-xl border p-4 ${
					mandaMails
						? 'border-emerald-300 bg-emerald-50'
						: 'border-ink-200 bg-ink-50'
				}`}
			>
				{mandaMails ? (
					<HiOutlinePaperAirplane className='mt-0.5 shrink-0 text-emerald-600' size={20} />
				) : (
					<HiOutlineShieldCheck className='mt-0.5 shrink-0 text-ink-400' size={20} />
				)}
				<div>
					<p className='font-bold text-ink-900'>
						{mandaMails
							? 'La campaña está enviando mails a clientes reales'
							: cfg.enabled
							? 'Encendida, pero en modo prueba'
							: 'Apagada — no sale ningún mail'}
					</p>
					<p className='text-[13px] text-ink-600'>
						{mandaMails
							? 'Cada carrito abandonado que cumpla las condiciones va a recibir un mail automático.'
							: cfg.enabled
							? 'Sólo se le escribe a las direcciones de prueba. Ningún cliente recibe nada.'
							: 'Podés configurar todo tranquilo: nada se envía hasta que la enciendas.'}
					</p>
				</div>
			</div>

			{/* Los dos candados */}
			<div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
				<label className='flex cursor-pointer items-start gap-3 rounded-xl border border-ink-200 bg-white p-4'>
					<input
						type='checkbox'
						checked={cfg.enabled}
						onChange={e => setCfg(c => ({ ...c, enabled: e.target.checked }))}
						className='mt-1 h-4 w-4'
					/>
					<span>
						<span className='block text-sm font-semibold text-ink-800'>
							Campaña encendida
						</span>
						<span className='block text-[12px] text-ink-500'>
							Candado 1. Apagada, el motor no hace nada.
						</span>
					</span>
				</label>

				<label className='flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4'>
					<input
						type='checkbox'
						checked={cfg.test_mode}
						onChange={e => setCfg(c => ({ ...c, test_mode: e.target.checked }))}
						className='mt-1 h-4 w-4'
					/>
					<span>
						<span className='block text-sm font-semibold text-ink-800'>
							Modo prueba
						</span>
						<span className='block text-[12px] text-ink-600'>
							Candado 2. Prendido, sólo escribe a los mails de abajo. Ningún
							cliente real recibe nada.
						</span>
					</span>
				</label>
			</div>

			{cfg.test_mode && (
				<Campo
					label='Mails de prueba'
					hint='Separados por coma. Son los únicos que van a recibir el mail mientras el modo prueba esté prendido.'
				>
					<input
						className='w-full rounded-lg border border-ink-200 p-2 text-sm'
						value={testMails}
						onChange={e => setTestMails(e.target.value)}
						placeholder='tumail@rfstore.uy, otro@gmail.com'
					/>
				</Campo>
			)}

			{!cfg.test_mode && cfg.enabled && (
				<div className='flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3'>
					<HiOutlineExclamationTriangle className='mt-0.5 shrink-0 text-rose-600' size={18} />
					<p className='text-[13px] text-rose-800'>
						Con esta combinación <b>se le envían mails a clientes reales</b>. Antes
						de guardar, verificá el descuento y los tiempos.
					</p>
				</div>
			)}

			{/* Cupón */}
			<Bloque titulo='El cupón'>
				<div className='grid grid-cols-1 gap-4 sm:grid-cols-3'>
					<Campo label='Descuento (%)' hint='El mail no lo dice: se ve al entrar por el link.'>
						<NumInput
							className='w-full rounded-lg border border-ink-200 p-2 text-sm'
							value={cfg.coupon.percent}
							min={1}
							onChange={n => setCfg(c => ({ ...c, coupon: { ...c.coupon, percent: n } }))}
						/>
					</Campo>
					<Campo label='Vence a las (horas)' hint='El vencimiento corto es lo que genera urgencia.'>
						<NumInput
							className='w-full rounded-lg border border-ink-200 p-2 text-sm'
							value={cfg.coupon.valid_hours}
							min={1}
							onChange={n => setCfg(c => ({ ...c, coupon: { ...c.coupon, valid_hours: n } }))}
						/>
					</Campo>
					<Campo label='Sirve pagando con'>
						<div className='space-y-1 pt-1'>
							{([
								['transfer', 'Transferencia bancaria'],
								['deposit', 'Depósito en redes'],
								['mercadopago', 'MercadoPago'],
							] as [string, string][]).map(([m, label]) => (
								<label key={m} className='flex items-center gap-2 text-[13px] text-ink-700'>
									<input
										type='checkbox'
										checked={cfg.coupon.payment_methods.includes(m)}
										onChange={e => {
											const next = e.target.checked
												? [...cfg.coupon.payment_methods, m]
												: cfg.coupon.payment_methods.filter(x => x !== m);
											setCfg(c => ({ ...c, coupon: { ...c.coupon, payment_methods: next.length ? next : ['transfer'] } }));
										}}
									/>
									{label}
								</label>
							))}
						</div>
					</Campo>
				</div>
				{!cfg.coupon.payment_methods.includes('mercadopago') && (
					<p className='mt-2 text-[12px] text-emerald-700'>
						Con MercadoPago destildado, el descuento no se puede usar por pasarela
						— ni desde la web ni llamando la API a mano.
					</p>
				)}
			</Bloque>

			{/* Cuándo */}
			<Bloque titulo='Cuándo se manda'>
				<div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4'>
					<Campo label='Primer aviso (minutos)' hint='Menos de 30 min corre el riesgo de escribirle a alguien que está pagando.'>
						<NumInput
							className='w-full rounded-lg border border-ink-200 p-2 text-sm'
							value={cfg.delay_minutes}
							min={1}
							onChange={n => setCfg(c => ({ ...c, delay_minutes: n }))}
						/>
					</Campo>
					<Campo label='Segundo aviso (horas)'>
						<NumInput
							className='w-full rounded-lg border border-ink-200 p-2 text-sm'
							value={cfg.second_delay_hours}
							min={1}
							onChange={n => setCfg(c => ({ ...c, second_delay_hours: n }))}
						/>
					</Campo>
					<Campo label='Máximo de avisos'>
						<NumInput
							className='w-full rounded-lg border border-ink-200 p-2 text-sm'
							value={cfg.max_reminders}
							min={1}
							onChange={n => setCfg(c => ({ ...c, max_reminders: Math.min(n, 3) }))}
						/>
					</Campo>
					<Campo label='Carrito mínimo (USD)' hint='Debajo de esto, el descuento cuesta más de lo que recupera.'>
						<NumInput
							className='w-full rounded-lg border border-ink-200 p-2 text-sm'
							value={cfg.min_total_usd}
							min={0}
							onChange={n => setCfg(c => ({ ...c, min_total_usd: n }))}
						/>
					</Campo>
				</div>
				<div className='mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3'>
					<Campo label='No enviar desde (hora)'>
						<NumInput
							className='w-full rounded-lg border border-ink-200 p-2 text-sm'
							value={cfg.quiet_hours[0]}
							min={0}
							onChange={n => setCfg(c => ({ ...c, quiet_hours: [Math.min(n, 23), c.quiet_hours[1]] }))}
						/>
					</Campo>
					<Campo label='Hasta (hora)' hint='Hora de Uruguay. Evita mails a las 3 de la mañana.'>
						<NumInput
							className='w-full rounded-lg border border-ink-200 p-2 text-sm'
							value={cfg.quiet_hours[1]}
							min={0}
							onChange={n => setCfg(c => ({ ...c, quiet_hours: [c.quiet_hours[0], Math.min(n, 23)] }))}
						/>
					</Campo>
					<Campo label='Tope por corrida'>
						<NumInput
							className='w-full rounded-lg border border-ink-200 p-2 text-sm'
							value={cfg.max_per_run}
							min={1}
							onChange={n => setCfg(c => ({ ...c, max_per_run: n }))}
						/>
					</Campo>
				</div>
			</Bloque>

			<Campo
				label='Mails excluidos'
				hint='Separados por coma. Útil para las cuentas de prueba internas.'
			>
				<input
					className='w-full rounded-lg border border-ink-200 p-2 text-sm'
					value={excluidos}
					onChange={e => setExcluidos(e.target.value)}
					placeholder='prueba@rfstore.uy'
				/>
			</Campo>

			<div className='flex justify-end'>
				<button
					onClick={onSave}
					disabled={isPending}
					className='rounded-full bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white shadow-soft transition-all hover:bg-brand-700 disabled:opacity-60'
				>
					{isPending ? 'Guardando…' : 'Guardar campaña'}
				</button>
			</div>
		</div>
	);
};

const Bloque = ({ titulo, children }: { titulo: string; children: React.ReactNode }) => (
	<div className='rounded-2xl border border-ink-200/70 bg-white p-5 shadow-soft'>
		<h3 className='mb-4 font-bold text-ink-900'>{titulo}</h3>
		{children}
	</div>
);

const Campo = ({
	label,
	hint,
	children,
}: {
	label: string;
	hint?: string;
	children: React.ReactNode;
}) => (
	<label className='block'>
		<span className='mb-1 block text-[13px] font-semibold text-ink-700'>{label}</span>
		{children}
		{hint && <span className='mt-1 block text-[11px] text-ink-500'>{hint}</span>}
	</label>
);
