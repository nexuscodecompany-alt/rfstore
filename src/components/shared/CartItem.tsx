import { LuMinus, LuPlus } from 'react-icons/lu';
import toast from 'react-hot-toast';
import { formatPrice } from '../../helpers';
import { useCartStore } from '../../store/cart.store';

export interface ICartItem {
	variantId: string;
	productId: string;
	name: string;
	color: string;
	storage: string;
	price: number;
	quantity: number;
	image: string;
	source?: 'local' | 'cdr';
	externalCode?: string | null;
	stock?: number;
}

interface Props {
	item: ICartItem;
}

export const CartItem = ({ item }: Props) => {
	const removeItem = useCartStore(state => state.removeItem);
	const updateQuantity = useCartStore(state => state.updateQuantity);

	const maxStock = item.stock ?? Infinity;
	const atMax = item.quantity >= maxStock;

	const increment = () => {
		if (atMax) {
			toast.error(
				maxStock === 1
					? 'Solo queda 1 disponible'
					: `Solo quedan ${maxStock} disponibles`,
				{ position: 'bottom-right' }
			);
			return;
		}
		updateQuantity(item.variantId, item.quantity + 1);
	};

	const decrement = () => {
		if (item.quantity > 1) {
			updateQuantity(item.variantId, item.quantity - 1);
		}
	};

	return (
		<li className='flex justify-between items-center gap-5'>
			<div className='flex'>
				<img
					src={item.image}
					alt={item.name}
					className='w-20 h-20 object-contain'
				/>
			</div>

			<div className='flex-1 space-y-3'>
				<div className='flex justify-between'>
					<p className='font-semibold'>{item.name}</p>
					<p className='text-sm font-medium text-gray-600 mt-1'>
						{formatPrice(item.price)}
					</p>
				</div>

				<div className='flex gap-4'>
					<div className='flex items-center gap-5 px-2 py-1 border border-slate-200 w-fit rounded-full'>
						<button
							onClick={decrement}
							disabled={item.quantity === 1}
						>
							<LuMinus size={15} />
						</button>
						<span className='text-slate-500 text-sm'>
							{item.quantity}
						</span>
						<button onClick={increment} disabled={atMax}>
							<LuPlus size={15} />
						</button>
					</div>

					<button
						className='underline font-medium text-[10px]'
						onClick={() => removeItem(item.variantId)}
					>
						Eliminar
					</button>
				</div>
			</div>
		</li>
	);
};
