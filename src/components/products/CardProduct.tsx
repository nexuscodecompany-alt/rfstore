import { FiPlus } from 'react-icons/fi';
import { FaWhatsapp } from 'react-icons/fa';
import { Link } from 'react-router-dom';
import { VariantProduct } from '../../interfaces';
import { formatPrice, salePrice } from '../../helpers';
import { Tag } from '../shared/Tag';
import { useCartStore } from '../../store/cart.store';
import { usePaymentsEnabled, usePricingConfig } from '../../hooks';
import toast from 'react-hot-toast';

const WHATSAPP_NUMBER = '59894116299';
const whatsappLinkFor = (productName: string) =>
	`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
		`Hola, me interesa el producto "${productName}". ¿Está disponible?`
	)}`;

interface Props {
	img: string;
	name: string;
	price: number;
	slug: string;
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
	variants,
	brandName,
	categoryName,
	source,
	externalCode,
}: Props) => {
	const addItem = useCartStore(state => state.addItem);
	const { enabled: paymentsEnabled } = usePaymentsEnabled();
	const pricing = usePricingConfig();

	const selectedVariant = variants[0];

	const displayPrice = variants.length
		? Math.min(...variants.map(v => salePrice(v.price, pricing)))
		: salePrice(price, pricing);

	const stock = selectedVariant?.stock || 0;
	const isOutOfStock = stock === 0;
	const isCdr = source === 'cdr' && paymentsEnabled;

	const handleAddClick = (e: React.MouseEvent<HTMLButtonElement>) => {
		e.preventDefault();
		e.stopPropagation();

		if (selectedVariant && selectedVariant.stock > 0) {
			addItem({
				variantId: selectedVariant.id,
				productId: slug,
				name,
				image: img,
				color: '',
				storage: '',
				price: salePrice(selectedVariant.price, pricing),
				quantity: 1,
				source: source ?? 'local',
				externalCode: externalCode ?? null,
				stock: selectedVariant.stock,
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
				className='relative block aspect-square overflow-hidden bg-white'
			>
				<img
					src={img}
					alt={name}
					loading='lazy'
					className='relative h-full w-full object-contain p-3 transition-transform duration-500 ease-out group-hover:scale-105'
				/>
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

				{/* CTA: agregar al carrito si es CDR, WhatsApp si no */}
				<div className='mt-auto pt-3'>
					{isCdr ? (
						<button
							onClick={handleAddClick}
							disabled={isOutOfStock}
							className='w-full inline-flex items-center justify-center gap-2 bg-ink-900 text-white text-xs font-semibold rounded-lg py-2.5 hover:bg-brand-600 transition-colors disabled:bg-ink-300 disabled:cursor-not-allowed'
						>
							<FiPlus size={16} />
							{isOutOfStock ? 'Agotado' : 'Agregar al carrito'}
						</button>
					) : (
						<a
							href={whatsappLinkFor(name)}
							target='_blank'
							rel='noopener noreferrer'
							onClick={e => e.stopPropagation()}
							className='w-full inline-flex items-center justify-center gap-2 bg-[#25D366] text-white text-xs font-semibold rounded-lg py-2.5 hover:bg-[#1ebe5d] transition-colors'
						>
							<FaWhatsapp size={16} />
							Consultar por WhatsApp
						</a>
					)}
				</div>
			</div>
		</div>
	);
};
