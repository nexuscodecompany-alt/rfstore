import { useState } from 'react';
import { PreparedProducts } from '../../interfaces';
import { CardProduct } from '../products/CardProduct';
import { HiOutlineArrowDown, HiOutlineArrowUp } from 'react-icons/hi2';
import { salePrice } from '../../helpers';
import { usePricingConfig } from '../../hooks';

interface Props {
	title: string;
	products: PreparedProducts[];
}

export const ProductGrid = ({ title, products }: Props) => {
	const [searchTerm] = useState('');
	const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
	const pricing = usePricingConfig();

	const filteredProducts = products.filter(
		product =>
			product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
			product.slug.toLowerCase().includes(searchTerm.toLowerCase()) ||
			(product.brandName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
			(product.categoryName || '').toLowerCase().includes(searchTerm.toLowerCase())
	);

	const finalPrice = (p: PreparedProducts) =>
		p.variants?.length
			? Math.min(...p.variants.map(v => salePrice(v.price, pricing)))
			: salePrice(p.price, pricing);

	const sortedProducts = [...filteredProducts].sort((a, b) => {
		const pa = finalPrice(a);
		const pb = finalPrice(b);
		return sortOrder === 'desc' ? pb - pa : pa - pb;
	});

	return (
		<section className='my-24'>
			<div className='text-center mb-12 space-y-3'>
				<p className='section-eyebrow'>Catálogo</p>
				<h2 className='section-title'>{title}</h2>
				<div className='mx-auto h-1 w-16 rounded-full bg-gradient-to-r from-brand-500 to-brand-700' />
			</div>

			<div className='flex flex-col items-center justify-between gap-4 mb-8 sm:flex-row'>
				<p className='text-sm text-ink-500'>
					{searchTerm
						? `${filteredProducts.length} resultado${filteredProducts.length !== 1 ? 's' : ''} para "${searchTerm}"`
						: `Mostrando ${sortedProducts.length} producto${sortedProducts.length !== 1 ? 's' : ''}`}
				</p>

				{/* SEGMENTED CONTROL */}
				<div className='inline-flex items-center gap-1 p-1 bg-ink-100 rounded-lg border border-ink-200/70'>
					<button
						onClick={() => setSortOrder('desc')}
						className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
							sortOrder === 'desc'
								? 'bg-white text-ink-900 shadow-soft'
								: 'text-ink-500 hover:text-ink-900'
						}`}
					>
						<HiOutlineArrowDown />
						Mayor precio
					</button>
					<button
						onClick={() => setSortOrder('asc')}
						className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
							sortOrder === 'asc'
								? 'bg-white text-ink-900 shadow-soft'
								: 'text-ink-500 hover:text-ink-900'
						}`}
					>
						<HiOutlineArrowUp />
						Menor precio
					</button>
				</div>
			</div>

			<div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5'>
				{sortedProducts.map(product => (
					<CardProduct
						key={product.id}
						name={product.name}
						price={product.price}
						img={product.images[0]}
						slug={product.slug}
						variants={product.variants}
						brandName={product.brandName}
						categoryName={product.categoryName}
						source={product.source}
						externalCode={product.external_code}
					/>
				))}
			</div>
		</section>
	);
};
