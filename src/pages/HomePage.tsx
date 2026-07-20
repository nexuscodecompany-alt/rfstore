import { useQuery } from '@tanstack/react-query';
import { ProductGrid } from '../components/home/ProductGrid';
import { FeatureGrid } from '../components/home/FeatureGrid';
import { HeroCarousel } from '../components/home/HeroCarousel';
import { CategoryTiles } from '../components/home/CategoryTiles';
import { Banner3D } from '../components/home/Banner3D';
import { BusinessBanner } from '../components/home/BusinessBanner';
import { Brands } from '../components/home/Brands';
import WhatsAppButton from '../components/shared/WhatsAppButton';
import { prepareProducts } from '../helpers';
import { useHomeConfig, useHomeSections } from '../hooks';
import { getProductsByIds } from '../actions';
import type { HomeBlock } from '../actions/homeConfig';
import type { Product } from '../interfaces';

/* Sección de productos (una entrada 'products' del layout). */
const ProductSection = ({
	block,
	recent,
	featured,
	ready,
}: {
	block: HomeBlock;
	recent: Product[];
	featured: Product[];
	ready: boolean;
}) => {
	const source = block.source ?? 'manual';
	const manualIds = block.product_ids ?? [];

	const { data: manual = [] } = useQuery({
		queryKey: ['home-manual-section', block.id, manualIds],
		queryFn: () => getProductsByIds(manualIds),
		enabled: source === 'manual' && manualIds.length > 0,
	});

	const raw =
		source === 'recent' ? recent : source === 'featured' ? featured : manual;
	const products = prepareProducts(raw);

	// Automáticas: esperar a que carguen. Manual: si está vacía, no mostrar.
	if (source !== 'manual' && !ready) return null;
	if (products.length === 0) return null;

	return <ProductGrid title={block.title || 'Productos'} products={products} />;
};

const BlockRenderer = ({
	block,
	recent,
	featured,
	ready,
}: {
	block: HomeBlock;
	recent: Product[];
	featured: Product[];
	ready: boolean;
}) => {
	switch (block.type) {
		case 'hero':
			return (
				<div className='-mt-8'>
					<HeroCarousel />
				</div>
			);
		case 'features':
			return (
				<div className='my-10'>
					<FeatureGrid />
				</div>
			);
		case 'categories':
			return <CategoryTiles />;
		case 'banner3d':
			return <Banner3D />;
		case 'brands':
			return <Brands />;
		case 'business':
			return <BusinessBanner />;
		case 'products':
			return (
				<ProductSection
					block={block}
					recent={recent}
					featured={featured}
					ready={ready}
				/>
			);
		default:
			return null;
	}
};

export const HomePage = () => {
	const { config } = useHomeConfig();
	const { featured, recent, isLoading, isError } = useHomeSections();
	const ready = !isLoading && !isError;

	return (
		<div>
			{config.layout
				.filter(b => b.enabled)
				.map(block => (
					<BlockRenderer
						key={block.id}
						block={block}
						recent={recent}
						featured={featured}
						ready={ready}
					/>
				))}

			<WhatsAppButton />
		</div>
	);
};
