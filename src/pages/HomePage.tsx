import { Link } from 'react-router-dom';
import { HiArrowRight } from 'react-icons/hi2';
import { ProductGrid } from '../components/home/ProductGrid';
import { FeatureGrid } from '../components/home/FeatureGrid';
import { Brands } from '../components/home/Brands';
import WhatsAppButton from '../components/shared/WhatsAppButton';
import { prepareProducts } from '../helpers';
import { useHomeSections } from '../hooks';

export const HomePage = () => {
	const { featured, recent, popular, isLoading, isError } = useHomeSections();
	const preparedFeatured = prepareProducts(featured);
	const preparedRecent = prepareProducts(recent);
	const preparedPopular = prepareProducts(popular);

	return (
		<div>
			<FeatureGrid />

			{!isLoading && !isError && preparedFeatured.length > 0 && (
				<ProductGrid title='Productos Destacados' products={preparedFeatured} />
			)}

			<Brands />

			{!isLoading && !isError && preparedRecent.length > 0 && (
				<ProductGrid title='Recién Llegados' products={preparedRecent} />
			)}

			{/* CTA dark */}
			<section className='relative section-dark py-20 my-16 overflow-hidden bleed-full'>
				<div
					aria-hidden
					className='absolute inset-0 bg-grid-dark bg-grid-md [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]'
				/>
				<div
					aria-hidden
					className='absolute -top-32 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-brand-600/30 blur-3xl rounded-full'
				/>
				<div className='relative z-10 container text-center max-w-3xl'>
					<p className='section-eyebrow text-brand-400 mb-4'>¿Cotización a medida?</p>
					<h2 className='text-3xl md:text-4xl font-bold text-white mb-4 leading-tight'>
						Equipamos a tu empresa con la{' '}
						<span className='bg-gradient-to-br from-brand-300 to-brand-500 bg-clip-text text-transparent'>
							tecnología que necesita
						</span>
					</h2>
					<p className='text-white/70 mb-8'>
						Asesoramiento técnico, mejor precio del mercado y facturación con IVA.
						Contanos qué buscás y armamos una propuesta para tu negocio.
					</p>
					<div className='flex flex-col sm:flex-row gap-3 justify-center'>
						<Link
							to='/contacto'
							className='inline-flex items-center justify-center gap-2 bg-white text-ink-900 py-3 px-6 rounded-lg font-semibold text-sm hover:bg-brand-50 transition-all'
						>
							Solicitar cotización
							<HiArrowRight />
						</Link>
						<Link to='/tienda' className='btn-ghost-dark px-6 py-3'>
							Ver catálogo
						</Link>
					</div>
				</div>
			</section>

			{!isLoading && !isError && preparedPopular.length > 0 && (
				<ProductGrid title='Más Populares' products={preparedPopular} />
			)}

			<WhatsAppButton />
		</div>
	);
};
