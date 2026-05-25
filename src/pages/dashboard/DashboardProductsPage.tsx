import { Link } from 'react-router-dom';
import { HiOutlinePlus, HiOutlineRectangleGroup } from 'react-icons/hi2';
import { TableProduct } from '../../components/dashboard/products/TableProduct';

export const DashboardProductsPage = () => {
	return (
		<div className='flex h-full flex-col gap-5'>
			<div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
				<div>
					<h1 className='text-2xl font-bold text-ink-900'>Productos</h1>
					<p className='text-sm text-ink-500'>
						Gestioná tu catálogo, stock y variantes.
					</p>
				</div>

				<div className='flex flex-wrap gap-2'>
					<Link
						to='/dashboard/taxonomias'
						className='inline-flex items-center gap-2 rounded-full border border-ink-200 bg-white px-4 py-2 text-sm font-semibold text-ink-700 transition-all hover:bg-ink-50'
					>
						<HiOutlineRectangleGroup size={18} />
						Categorías y Marcas
					</Link>
					<Link
						to='/dashboard/productos/new'
						className='inline-flex items-center gap-2 rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-soft transition-all hover:bg-brand-700'
					>
						<HiOutlinePlus size={18} />
						Agregar Producto
					</Link>
				</div>
			</div>

			<TableProduct />
		</div>
	);
};
