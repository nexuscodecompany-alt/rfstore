import { useEffect, useState } from 'react';
import { HiXMark } from 'react-icons/hi2';
import type { CdrSyncLocks } from '../../../actions';

export interface CdrSyncLocksValue {
	price: boolean;
	content: boolean;
	stock: boolean;
}

interface Props {
	open: boolean;
	productName: string;
	/** Estado actual de los candados del producto. */
	value: CdrSyncLocksValue;
	submitting?: boolean;
	/**
	 * Texto de contexto arriba de la lista. Se usa para explicar por qué se abrió
	 * solo (ej. recién guardaste un precio manual).
	 */
	intro?: string;
	onClose: () => void;
	onSubmit: (locks: CdrSyncLocks) => void;
}

interface Row {
	key: keyof CdrSyncLocksValue;
	title: string;
	/** Qué pasa cuando el candado está PRENDIDO (pausado). */
	pausedHint: string;
	/** Qué pasa cuando está apagado (sincronizando). */
	syncedHint: string;
}

const ROWS: Row[] = [
	{
		key: 'price',
		title: 'Costo',
		pausedHint:
			'Queda clavado el costo que tenés cargado. Tu precio de venta deja de moverse.',
		syncedHint:
			'CDR manda el costo. Cuando lo cambia, tu precio de venta se recalcula con el margen que tengas puesto.',
	},
	{
		key: 'stock',
		title: 'Stock',
		pausedHint:
			'El stock lo manejás vos desde el panel. Sirve cuando tenés unidades propias y CDR está en 0.',
		syncedHint: 'El stock lo manda CDR (menos lo reservado por pedidos).',
	},
	{
		key: 'content',
		title: 'Nombre y descripción',
		pausedHint: 'Tus textos quedan como están, CDR no los pisa.',
		syncedHint:
			'Si CDR cambia el título o la descripción, se actualizan en la web.',
	},
];

// Elegir QUÉ deja de sincronizar CDR para este producto, en vez del todo-o-nada
// de antes. Lo que queda destildado se sigue actualizando normal.
export const CdrSyncLocksModal = ({
	open,
	productName,
	value,
	submitting = false,
	intro,
	onClose,
	onSubmit,
}: Props) => {
	const [locks, setLocks] = useState<CdrSyncLocksValue>(value);

	// Cada vez que se abre, arranca del estado real del producto (o del que pida
	// quien lo abre, ej. precio pre-tildado tras poner un margen manual).
	useEffect(() => {
		if (open) setLocks(value);
	}, [open, value.price, value.content, value.stock]); // eslint-disable-line react-hooks/exhaustive-deps

	if (!open) return null;

	const toggle = (key: keyof CdrSyncLocksValue) =>
		setLocks(prev => ({ ...prev, [key]: !prev[key] }));

	const pausedCount = ROWS.filter(r => locks[r.key]).length;

	return (
		<div className='fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/50 p-4 backdrop-blur-sm'>
			<div className='my-8 w-full max-w-lg rounded-2xl bg-white shadow-2xl'>
				<div className='flex items-center justify-between border-b border-ink-100 px-5 py-4'>
					<h2 className='text-lg font-bold text-ink-900'>Qué le copia CDR</h2>
					<button
						onClick={onClose}
						disabled={submitting}
						className='grid h-9 w-9 place-items-center rounded-lg text-ink-400 hover:bg-ink-100 disabled:opacity-50'
						aria-label='Cerrar'
					>
						<HiXMark size={20} />
					</button>
				</div>

				<div className='p-5'>
					<p className='mb-1 text-sm text-ink-600'>
						{intro ?? '¿Qué querés que CDR deje de tocar en este producto?'}
					</p>
					<p className='mb-4 text-sm font-semibold text-ink-900'>{productName}</p>

					<div className='space-y-2'>
						{ROWS.map(row => {
							const paused = locks[row.key];
							return (
								<label
									key={row.key}
									className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
										paused
											? 'border-amber-300 bg-amber-50'
											: 'border-ink-200 bg-white hover:bg-ink-50'
									}`}
								>
									<input
										type='checkbox'
										className='mt-0.5 h-4 w-4 accent-amber-600'
										checked={paused}
										disabled={submitting}
										onChange={() => toggle(row.key)}
									/>
									<span className='text-sm'>
										<span className='font-semibold text-ink-900'>
											{row.title}
										</span>
										<span
											className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-bold ${
												paused
													? 'bg-amber-200 text-amber-900'
													: 'bg-emerald-100 text-emerald-800'
											}`}
										>
											{paused ? 'pausado' : 'sincronizando'}
										</span>
										<span className='mt-1 block text-xs text-ink-500'>
											{paused ? row.pausedHint : row.syncedHint}
										</span>
									</span>
								</label>
							);
						})}
					</div>

					<p className='mt-4 text-xs text-ink-500'>
						{pausedCount === 0
							? 'Todo se sincroniza con CDR, como siempre.'
							: pausedCount === ROWS.length
							? 'El producto queda 100% manual: CDR no lo toca en nada.'
							: 'Lo que quedó destildado se sigue actualizando con CDR normalmente.'}
					</p>

					<div className='mt-6 flex items-center justify-end gap-2'>
						<button
							onClick={onClose}
							disabled={submitting}
							className='rounded-lg border border-ink-200 px-4 py-2 text-sm font-semibold text-ink-700 hover:bg-ink-50 disabled:opacity-50'
						>
							Cancelar
						</button>
						<button
							onClick={() =>
								onSubmit({
									price: locks.price,
									content: locks.content,
									stock: locks.stock,
								})
							}
							disabled={submitting}
							className='inline-flex items-center gap-2 rounded-lg bg-ink-900 px-4 py-2 text-sm font-semibold text-white hover:bg-ink-800 disabled:opacity-50'
						>
							{submitting && (
								<span className='inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent' />
							)}
							{submitting ? 'Guardando…' : 'Guardar'}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
};
