import { useState } from 'react';
import { FiPlus } from 'react-icons/fi';
import { Link } from 'react-router-dom';
import { VariantProduct } from '../../interfaces';
import { formatPrice, salePrice } from '../../helpers';
import { Tag } from '../shared/Tag';
import { useCartStore } from '../../store/cart.store';
import { usePaymentsEnabled, usePricingConfig } from '../../hooks';
import toast from 'react-hot-toast';

interface Props {
	img: string;
	name: string;
	price: number;
	slug: string;
	colors: { name: string; color: string }[];
	variants: VariantProduct[];
	brandName?: string;
	categoryName?: string;
	source?: 'local' | 'cdr';
	externalCode?: string | null;
}

export const CardProduct = ({
	img,
	name,
	price,
	slug,
	colors,
	variants,
	brandName,
	categoryName,
	source,
	externalCode,
}: Props) => {
	const [activeColor, setActiveColor] = useState<{
		name: string;
		color: string;
	}>(colors[0]);

	const addItem = useCartStore(state => state.addItem);
	const { enabled: paymentsEnabled } = usePaymentsEnabled();
	const pricing = usePricingConfig();

	const selectedVariant = variants.find(
		variant => variant.color === activeColor.color
	);

	// Precio de venta final (margen + IVA). "Desde" = mínimo entre variantes.
	const displayPrice = variants.length
		? Math.min(...variants.map(v => salePrice(v.price, pricing)))
		: salePrice(price, pricing);

	const stock = selectedVariant?.stock || 0;
	const isOutOfStock = stock === 0;

	const handleAddClick = (e: React.MouseEvent<HTMLButtonElement>) => {
		e.preventDefault();
		e.stopPropagation();

		if (selectedVariant && selectedVariant.stock > 0) {
			addItem({
				variantId: selectedVariant.id,
				productId: slug,
				name,
				image: img,
				color: activeColor.name,
				storage: selectedVariant.storage,
				price: salePrice(selectedVariant.price, pricing),
				quantity: 1,
				source: source ?? 'local',
				externalCode: externalCode ?? null,
			});
			toast.success('Producto añadido al carrito', {
				position: 'bottom-right',
			});
		} else {
			toast.error('Producto agotado', {
				position: 'bottom-right',
			});
		}
	};

	return (
		<div className='group relative flex flex-col bg-white border border-ink-200/70 rounded-xl overflow-hidden shadow-card hover:shadow-card-hover hover:-translate-y-1 hover:border-brand-200 transition-all duration-300'>
			{/* BADGES */}
			<div className='absolute top-3 left-3 z-10 flex flex-col gap-1.5'>
				{isOutOfStock && <Tag contentTag='agotado' />}
				{source === 'cdr' && paymentsEnabled && (
					<span className='bg-emerald-600 text-white text-[10px] font-semibold px-2 py-1 rounded-full uppercase tracking-wide'>
						Pago online
					</span>
				)}
			</div>

			{/* IMAGEN */}
			<Link
				to={`/producto/${slug}`}
				className='relative block aspect-square bg-gradient-to-br from-ink-50 to-white overflow-hidden'
			>
				<div
					aria-hidden
					className='absolute inset-0 bg-grid-light bg-grid-sm opacity-40'
				/>
				<img
					src={img}
					alt={name}
					loading='lazy'
					className='relative h-full w-full object-contain p-6 group-hover:scale-105 transition-transform duration-500 ease-out'
				/>

				{/* QUICK ADD on hover */}
				<button
					onClick={handleAddClick}
					disabled={isOutOfStock}
					className='absolute bottom-3 right-3 grid place-items-center w-10 h-10 bg-ink-900 text-white rounded-full shadow-soft opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 hover:bg-brand-600 hover:scale-105 transition-all duration-300 disabled:bg-ink-300 disabled:cursor-not-allowed disabled:opacity-50'
					aria-label='Añadir al carrito'
				>
					<FiPlus size={18} />
				</button>
			</Link>

			{/* INFO */}
			<div className='flex flex-col gap-2 p-4'>
				{(brandName || categoryName) && (
					<p className='text-[10px] font-semibold tracking-wider uppercase text-brand-700'>
						{brandName || ''}
						{brandName && categoryName ? ' · ' : ''}
						{categoryName || ''}
					</p>
				)}

				<Link to={`/producto/${slug}`}>
					<h3 className='text-sm font-semibold text-ink-900 line-clamp-2 min-h-[2.5rem] hover:text-brand-700 transition-colors'>
						{name}
					</h3>
				</Link>

				<div className='flex items-baseline gap-1.5 pt-1'>
					<p className='text-base font-bold text-ink-900'>
						{formatPrice(displayPrice)}
					</p>
					<span className='text-[10px] text-ink-500 font-medium'>
						IVA incluido
					</span>
				</div>

				{colors.length > 0 && (
					<div className='flex items-center gap-2 pt-2 mt-auto border-t border-ink-100'>
						<span className='text-[10px] font-medium text-ink-500'>Color:</span>
						<div className='flex gap-1.5'>
							{colors.map(color => (
								<button
									key={color.color}
									type='button'
									aria-label={color.name}
									onClick={e => {
										e.preventDefault();
										setActiveColor(color);
									}}
									className={`relative w-4 h-4 rounded-full transition-all ${
										activeColor.color === color.color
											? 'ring-2 ring-offset-1 ring-brand-600'
											: 'ring-1 ring-ink-200 hover:ring-ink-400'
									}`}
									style={{ backgroundColor: color.color }}
								/>
							))}
						</div>
					</div>
				)}
			</div>
		</div>
	);
};
