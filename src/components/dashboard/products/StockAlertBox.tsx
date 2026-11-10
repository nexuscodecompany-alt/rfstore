import { useEffect, useState } from 'react';
import { useSetProductStockAlert } from '../../../hooks';

/**
 * Aviso por mail de stock bajo en CDR. Se guarda al toque (no espera al botón
 * "Guardar" del formulario) porque no es un dato del producto sino una alarma.
 *
 * El mail sale una vez cuando el stock de CDR baja del mínimo; si CDR repone y
 * vuelve a bajar, avisa de nuevo. Ojo: CDR informa como máximo 10, así que un
 * mínimo de 10 avisa apenas empieza a bajar (9).
 */
interface StockAlertProduct {
	id: string;
	stock_alert_enabled?: boolean;
	stock_alert_threshold?: number;
	variants?: { id: string; cdr_stock?: number | null }[];
}

export const StockAlertBox = ({ product }: { product: StockAlertProduct }) => {
	const { setStockAlert, isSettingStockAlert } = useSetProductStockAlert();
	const enabled = product.stock_alert_enabled === true;
	const [threshold, setThreshold] = useState(product.stock_alert_threshold ?? 10);

	useEffect(() => {
		setThreshold(product.stock_alert_threshold ?? 10);
	}, [product.stock_alert_threshold]);

	const cdrStock = product.variants?.[0]?.cdr_stock;
	const validThreshold = Number.isInteger(threshold) && threshold >= 1 && threshold <= 1000;
	const thresholdChanged = threshold !== (product.stock_alert_threshold ?? 10);

	const save = (nextEnabled: boolean) => {
		if (!validThreshold) return;
		setStockAlert({ id: product.id, enabled: nextEnabled, threshold });
	};

	return (
		<div className='p-3 mt-4 border rounded-lg bg-slate-50 border-slate-200'>
			<label className='flex items-start gap-3 cursor-pointer'>
				<input
					type='checkbox'
					className='mt-0.5 h-4 w-4 accent-emerald-600'
					checked={enabled}
					disabled={isSettingStockAlert || !validThreshold}
					onChange={e => save(e.target.checked)}
				/>
				<span className='text-sm'>
					<span className='font-semibold text-slate-800'>
						Avisarme por mail cuando CDR tenga poco stock
					</span>
					<span className='block mt-0.5 text-xs text-slate-500'>
						{enabled
							? `Te llega un mail cuando el stock de CDR baje de ${product.stock_alert_threshold ?? 10}. Avisa una vez; si CDR repone y vuelve a bajar, avisa de nuevo.`
							: 'Sirve para saber si se está vendiendo mucho y conviene comprar stock propio.'}
					</span>
				</span>
			</label>

			<div className='flex flex-wrap items-center gap-2 mt-3 ml-7 text-sm'>
				<span className='text-slate-600'>Avisar con menos de</span>
				<input
					type='number'
					min={1}
					max={1000}
					step={1}
					className='w-20 px-2 py-1 border rounded-md border-slate-300'
					value={Number.isNaN(threshold) ? '' : threshold}
					onChange={e => setThreshold(parseInt(e.target.value, 10))}
				/>
				<span className='text-slate-600'>unidades</span>
				{enabled && thresholdChanged && validThreshold && (
					<button
						type='button'
						className='px-2 py-1 text-xs font-semibold text-white rounded-md bg-slate-800 disabled:opacity-50'
						disabled={isSettingStockAlert}
						onClick={() => save(true)}
					>
						Guardar mínimo
					</button>
				)}
			</div>

			{cdrStock != null && (
				<p className='mt-2 ml-7 text-xs text-slate-500'>
					Hoy CDR tiene <b>{cdrStock}</b>
					{cdrStock >= 10 ? ' (CDR informa como máximo 10)' : ''}.
					{enabled && cdrStock < (product.stock_alert_threshold ?? 10)
						? ' Ya está por debajo del mínimo: el próximo cambio a la baja te avisa.'
						: ''}
				</p>
			)}
		</div>
	);
};
