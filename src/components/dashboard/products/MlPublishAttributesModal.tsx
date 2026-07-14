import { useMemo, useState } from 'react';
import { HiXMark } from 'react-icons/hi2';
import type { MlAttrInput, MlMissingAttr } from '../../../actions/ml';

interface Props {
	open: boolean;
	productName: string;
	// Atributos obligatorios que ML pide y no pudimos completar solos.
	missing: MlMissingAttr[];
	submitting: boolean;
	onClose: () => void;
	// El admin cargó los valores y le dio publicar -> reintentamos con estos atributos.
	onSubmit: (attrs: MlAttrInput[]) => void;
}

// Form dinámico: por cada atributo que ML pide, un input. Si el atributo tiene una lista de
// valores permitidos por ML -> desplegable (así el valor va en el formato exacto). Si no ->
// campo de texto libre. El admin completa y le da "Publicar en ML" para reintentar.
export const MlPublishAttributesModal = ({ open, productName, missing, submitting, onClose, onSubmit }: Props) => {
	// value_id (para desplegables) o value_name (texto libre), por id de atributo.
	const [values, setValues] = useState<Record<string, { value_id?: string; value_name?: string }>>({});

	// Reset cuando cambia la lista de faltantes (ej. ML pidió otros en un reintento).
	const missingKey = useMemo(() => missing.map(m => m.id).join(','), [missing]);
	const [lastKey, setLastKey] = useState(missingKey);
	if (missingKey !== lastKey) {
		setLastKey(missingKey);
		setValues({});
	}

	if (!open) return null;

	const setText = (id: string, value_name: string) => setValues(v => ({ ...v, [id]: { value_name } }));
	const setOption = (attr: MlMissingAttr, optKey: string) => {
		const opt = (attr.values ?? []).find(o => (o.id ?? o.name) === optKey);
		setValues(v => ({ ...v, [attr.id]: opt ? { value_id: opt.id, value_name: opt.name } : {} }));
	};

	const allFilled = missing.every(m => {
		const val = values[m.id];
		return !!(val && (val.value_id || (val.value_name && val.value_name.trim())));
	});

	const handleSubmit = () => {
		const attrs: MlAttrInput[] = missing
			.map(m => ({ id: m.id, ...values[m.id] }))
			.filter(a => a.value_id || (a.value_name && a.value_name.trim()));
		onSubmit(attrs);
	};

	return (
		<div className='fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/50 p-4 backdrop-blur-sm'>
			<div className='my-8 w-full max-w-lg rounded-2xl bg-white shadow-2xl'>
				<div className='flex items-center justify-between border-b border-ink-100 px-5 py-4'>
					<h2 className='text-lg font-bold text-ink-900'>Datos que pide Mercado Libre</h2>
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
					<p className='mb-4 text-sm text-ink-600'>
						Para publicar <span className='font-semibold text-ink-900'>{productName}</span>, Mercado Libre
						necesita estos datos. Completalos y dale publicar.
					</p>

					<div className='space-y-4'>
						{missing.map(attr => {
							const hasList = Array.isArray(attr.values) && attr.values.length > 0;
							const current = values[attr.id];
							return (
								<div key={attr.id}>
									<label className='mb-1 block text-sm font-semibold text-ink-800'>{attr.name}</label>
									{hasList ? (
										<select
											className='inp'
											value={current?.value_id ?? ''}
											onChange={e => setOption(attr, e.target.value)}
											disabled={submitting}
										>
											<option value=''>Elegí una opción…</option>
											{attr.values!.map(o => (
												<option key={o.id ?? o.name} value={o.id ?? o.name}>
													{o.name}
												</option>
											))}
										</select>
									) : (
										<input
											className='inp'
											type='text'
											value={current?.value_name ?? ''}
											onChange={e => setText(attr.id, e.target.value)}
											placeholder={`Ingresá ${attr.name.toLowerCase()}`}
											disabled={submitting}
										/>
									)}
								</div>
							);
						})}
					</div>

					<div className='mt-6 flex items-center justify-end gap-2'>
						<button
							onClick={onClose}
							disabled={submitting}
							className='rounded-lg border border-ink-200 px-4 py-2 text-sm font-semibold text-ink-700 hover:bg-ink-50 disabled:opacity-50'
						>
							Cancelar
						</button>
						<button
							onClick={handleSubmit}
							disabled={submitting || !allFilled}
							className='inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50'
						>
							{submitting && (
								<span className='inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent' />
							)}
							{submitting ? 'Publicando…' : 'Publicar en ML'}
						</button>
					</div>
				</div>

				<style>{`.inp{width:100%;border:1px solid #d6d3d1;border-radius:0.5rem;padding:0.5rem 0.75rem;font-size:0.875rem;outline:none;background:#fff}.inp:focus{box-shadow:0 0 0 2px rgba(59,130,246,.35)}`}</style>
			</div>
		</div>
	);
};
