import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { getAppSettings, updateAppSetting } from '../../actions';
import {
	DEFAULT_INVOICE_CONFIG,
	testFixedConnection,
	type FixedConnection,
	type InvoiceConfig,
} from '../../actions/invoices';

/* ======================================================================= */
/*  Configuración de la facturación con Fixed (app_settings.invoice_config).*/
/*  Las claves de Fixed NO van acá: son secrets de Supabase                 */
/*  (FIXED_BASE_URL / FIXED_API_KEY / FIXED_API_SECRET).                    */
/* ======================================================================= */

const CFE_NAMES: Record<number, string> = {
	101: 'e-Ticket',
	102: 'NC e-Ticket',
	111: 'e-Factura',
	112: 'NC e-Factura',
};

export const InvoiceSettingsSection = () => {
	const qc = useQueryClient();
	const { data: settings } = useQuery({ queryKey: ['app_settings'], queryFn: getAppSettings });
	const [cfg, setCfg] = useState<InvoiceConfig>(DEFAULT_INVOICE_CONFIG);
	const [conn, setConn] = useState<FixedConnection | null>(null);

	useEffect(() => {
		const saved = settings?.get('invoice_config') as Partial<InvoiceConfig> | undefined;
		if (saved) setCfg({ ...DEFAULT_INVOICE_CONFIG, ...saved });
	}, [settings]);

	const save = useMutation({
		mutationFn: () => updateAppSetting('invoice_config', cfg),
		onSuccess: () => {
			toast.success('Facturación guardada');
			qc.invalidateQueries({ queryKey: ['app_settings'] });
		},
		onError: e => toast.error((e as Error).message),
	});

	const test = useMutation({
		mutationFn: testFixedConnection,
		onSuccess: r => {
			setConn(r);
			// Con un solo local, se completa solo.
			if (r.ok && !cfg.local_id && r.locales.length === 1) setCfg(c => ({ ...c, local_id: r.locales[0].id }));
		},
		onError: e => toast.error((e as Error).message),
	});

	const set = <K extends keyof InvoiceConfig>(k: K, v: InvoiceConfig[K]) => setCfg(c => ({ ...c, [k]: v }));
	const thresholdUyu = Math.round(cfg.id_required_above_ui * cfg.ui_value_uyu);

	return (
		<section className='space-y-4 rounded-lg border border-gray-200 bg-white p-5'>
			<div>
				<h2 className='font-semibold'>Facturación electrónica (Fixed)</h2>
				<p className='text-sm text-gray-500'>
					Con esto prendido aparece el botón "Facturar" en cada orden. Nada se factura solo.
				</p>
			</div>

			<label className='flex items-center gap-2 text-sm font-medium'>
				<input type='checkbox' checked={cfg.enabled} onChange={e => set('enabled', e.target.checked)} />
				Facturación activa
			</label>

			<div className='space-y-2 rounded-md bg-gray-50 p-3 text-sm'>
				<button
					onClick={() => test.mutate()}
					disabled={test.isPending}
					className='rounded-md border border-gray-300 bg-white px-3 py-1.5 font-medium disabled:opacity-50'
				>
					{test.isPending ? 'Probando…' : 'Probar conexión con Fixed'}
				</button>
				{conn && !conn.ok && <p className='text-red-700'>{conn.error}</p>}
				{conn?.ok && (
					<div className='space-y-1'>
						<p>
							<b>{conn.environment === 'testing' ? 'Ambiente de PRUEBA' : 'PRODUCCIÓN'}</b> · {conn.empresa?.nombre} · RUT{' '}
							{conn.empresa?.rut}
						</p>
						{conn.cae_error && (
							<p className='text-red-700'>
								Fixed no devolvió la numeración: {conn.cae_error}
							</p>
						)}
						<p className='text-gray-600'>
							Numeración vigente:{' '}
							{conn.cae.filter(c => c.vigente).length === 0
								? 'ninguna (no se puede facturar)'
								: conn.cae
										.filter(c => c.vigente)
										.map(c => `${CFE_NAMES[c.tipo] ?? c.tipo} ${c.serie}: ${c.disponibles} (vence ${c.vence})`)
										.join(' · ')}
						</p>
						{conn.cae.some(c => !c.vigente) && (
							<p className='text-xs text-gray-500'>
								Sin uso:{' '}
								{conn.cae
									.filter(c => !c.vigente)
									.map(c => `${CFE_NAMES[c.tipo] ?? c.tipo} ${c.serie} ${c.desde}–${c.hasta} (${c.motivo}, vence ${c.vence})`)
									.join(' · ')}
							</p>
						)}
					</div>
				)}
			</div>

			<div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
				<label className='text-sm'>
					Local de Fixed
					{conn?.ok && conn.locales.length > 0 ? (
						<select
							className='mt-1 w-full rounded border px-3 py-2'
							value={cfg.local_id}
							onChange={e => set('local_id', e.target.value)}
						>
							<option value=''>El que tenga Fixed por defecto</option>
							{conn.locales.map(l => (
								<option key={l.id} value={l.id}>
									{l.nombre} — {l.direccion}
								</option>
							))}
						</select>
					) : (
						<input
							className='mt-1 w-full rounded border px-3 py-2'
							placeholder='Probá la conexión para elegirlo'
							value={cfg.local_id}
							onChange={e => set('local_id', e.target.value)}
						/>
					)}
				</label>

				<label className='text-sm'>
					Rubro de cada producto en la factura
					<select
						className='mt-1 w-full rounded border px-3 py-2'
						value={cfg.rubro_mode}
						onChange={e => set('rubro_mode', e.target.value as InvoiceConfig['rubro_mode'])}
					>
						<option value='category'>La categoría del producto (Celulares, Notebooks…)</option>
						<option value='fixed'>Siempre el mismo</option>
					</select>
				</label>

				<label className='text-sm'>
					Rubro por defecto (sin categoría o "siempre el mismo")
					<input className='mt-1 w-full rounded border px-3 py-2' value={cfg.default_rubro} onChange={e => set('default_rubro', e.target.value)} />
				</label>

				<label className='text-sm'>
					Rubro del envío
					<input className='mt-1 w-full rounded border px-3 py-2' value={cfg.shipping_rubro} onChange={e => set('shipping_rubro', e.target.value)} />
				</label>

				<label className='text-sm'>
					Valor de la Unidad Indexada (UI) en pesos
					<input
						type='number'
						step='0.0001'
						className='mt-1 w-full rounded border px-3 py-2'
						value={cfg.ui_value_uyu}
						onChange={e => set('ui_value_uyu', Number(e.target.value) || 0)}
					/>
					<span className='mt-1 block text-xs text-gray-500'>
						Desde {cfg.id_required_above_ui} UI (≈ $ {thresholdUyu.toLocaleString('es-UY')}) DGI exige cédula y domicilio: el
						checkout los pide. Actualizalo cada tanto (lo publica el INE).
					</span>
				</label>
			</div>

			<button className='rounded-md bg-stone-800 px-4 py-2 text-white' disabled={save.isPending} onClick={() => save.mutate()}>
				Guardar
			</button>
		</section>
	);
};
