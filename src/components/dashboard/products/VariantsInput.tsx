import {
	Control,
	FieldErrors,
	UseFormRegister,
	useFieldArray,
} from 'react-hook-form';
import { useEffect } from 'react';
import { ProductFormValues } from '../../../lib/validators';

interface Props {
	control: Control<ProductFormValues>;
	errors: FieldErrors<ProductFormValues>;
	register: UseFormRegister<ProductFormValues>;
}

// Pasamos a un único set de precio + stock por producto (sin variantes).
// Internamente seguimos guardando una fila en `variants` con placeholders
// para mantener compatibilidad con order_items / place_order / sync CDR.
export const VariantsInput = ({ control, errors, register }: Props) => {
	const { fields, append, remove } = useFieldArray({
		control,
		name: 'variants',
	});

	// Aseguramos exactamente UNA variante. Si vienen varias (productos viejos),
	// dejamos solo la primera. Si no hay ninguna, agregamos una vacía.
	useEffect(() => {
		if (fields.length === 0) {
			append({
				stock: 0,
				price: 0,
				storage: '',
				color: '#000000',
				colorName: 'Único',
			});
		} else if (fields.length > 1) {
			for (let i = fields.length - 1; i >= 1; i--) {
				remove(i);
			}
		}
	}, [fields.length, append, remove]);

	const variantErrors = errors.variants?.[0];

	if (fields.length === 0) return null;

	return (
		<div className='flex flex-col gap-4'>
			<div className='grid grid-cols-2 gap-4'>
				<div className='flex flex-col gap-1'>
					<label className='text-xs font-semibold text-slate-800'>
						Precio (USD, costo sin IVA)
					</label>
					<input
						type='number'
						step='0.01'
						placeholder='0.00'
						{...register('variants.0.price', { valueAsNumber: true })}
						className='border rounded-md px-3 py-2 text-sm font-semibold placeholder:font-normal focus:outline-none appearance-none'
					/>
					{variantErrors?.price && (
						<p className='text-red-500 text-xs'>{variantErrors.price.message}</p>
					)}
				</div>

				<div className='flex flex-col gap-1'>
					<label className='text-xs font-semibold text-slate-800'>Stock</label>
					<input
						type='number'
						placeholder='0'
						{...register('variants.0.stock', { valueAsNumber: true })}
						className='border rounded-md px-3 py-2 text-sm font-semibold placeholder:font-normal focus:outline-none appearance-none'
					/>
					{variantErrors?.stock && (
						<p className='text-red-500 text-xs'>{variantErrors.stock.message}</p>
					)}
				</div>
			</div>

			{/* Placeholders ocultos para mantener compatibilidad con el modelo viejo. */}
			<input type='hidden' {...register('variants.0.storage')} />
			<input type='hidden' {...register('variants.0.color')} />
			<input type='hidden' {...register('variants.0.colorName')} />

			<p className='text-xs text-slate-500'>
				Cada producto tiene un único precio y stock. Las variantes (color /
				almacenamiento) ya no se usan.
			</p>
		</div>
	);
};
