import { supabase } from '../supabase/client';
import type { Product, VariantProduct } from '../interfaces';

const PAGE_SIZE = 25;

type Args = {
  brands: string[];
  categories?: string[];
  subcategories?: string[];
  priceMin?: number;
  priceMax?: number;
  page: number;
  searchTerm?: string;
  sortOrder?: 'asc' | 'desc';
  // "Recién llegados": productos CDR creados en los últimos 14 días,
  // ordenados por fecha desc. Cuando está activo, ignora sortOrder.
  newArrivalsOnly?: boolean;
};

const NEW_ARRIVAL_DAYS = 14;

export async function getFilteredProducts({
  brands,
  categories = [],
  subcategories = [],
  priceMin,
  priceMax,
  page,
  searchTerm = '',
  sortOrder,
  newArrivalsOnly,
}: Args) {
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // 1) Vista ya ORDENADA + PAGINADA
let baseQuery = supabase
  .from('products_with_price')
  .select(
    'id, name, slug, images, features, description, created_at, brand_id, category_id, subcategory_id, price, source, external_code',
    { count: 'exact' }
  )
  .range(from, to);

// Recién llegados: prioridad sobre sortOrder.
if (newArrivalsOnly) {
  const since = new Date(Date.now() - NEW_ARRIVAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  baseQuery = baseQuery
    .eq('source', 'cdr')
    .gte('created_at', since)
    .order('created_at', { ascending: false });
} else if (sortOrder === 'asc') {
  baseQuery = baseQuery.order('price', { ascending: true });
} else if (sortOrder === 'desc') {
  baseQuery = baseQuery.order('price', { ascending: false });
} else {
  // Por defecto: primero los productos de CDR ('cdr' < 'local'), luego los más nuevos.
  baseQuery = baseQuery
    .order('source', { ascending: true })
    .order('created_at', { ascending: false });
}

// Desempate por id (único): sin esto, los productos que comparten created_at/price
// salen en orden inestable entre páginas y la paginación repite/saltea artículos.
baseQuery = baseQuery.order('id', { ascending: true });

// aplicar filtros
if (brands?.length)        baseQuery = baseQuery.in('brand_id', brands);
if (categories?.length)    baseQuery = baseQuery.in('category_id', categories);
if (subcategories?.length) baseQuery = baseQuery.in('subcategory_id', subcategories);
if (typeof priceMin === 'number') baseQuery = baseQuery.gte('price', priceMin);
if (typeof priceMax === 'number') baseQuery = baseQuery.lte('price', priceMax);

if (searchTerm?.trim()) {
  const ilike = `%${searchTerm.trim()}%`;
  baseQuery = baseQuery.or(`name.ilike.${ilike},slug.ilike.${ilike}`);
}
  const { data: baseRows, error: baseErr, count } = await baseQuery;
  if (baseErr) throw baseErr;
  if (!baseRows?.length) return { data: [], count: count ?? 0 };

  // 2) Variants del lote (ids sin nulls)
  const ids = baseRows
    .map(r => r.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  const { data: vars, error: varsErr } = await supabase
    .from('variants')
    .select('id, product_id, price, stock, color, storage')
    .in('product_id', ids);

  if (varsErr) throw varsErr;

  // 2.1) Normalizar al tipo VariantProduct que tu app espera
  const variantsByProduct: Record<string, VariantProduct[]> = {};
  (vars ?? []).forEach(v => {
    const pid = v.product_id as string;
    const vp: VariantProduct = {
      id: v.id as string,
      stock: (v.stock ?? 0) as number,
      price: (v.price ?? 0) as number,
      storage: (v.storage ?? '') as string,
      color: (v.color ?? '#000000') as string,
      // tu DB no tiene color_name → lo derivamos/vaciamos
      color_name: (v as any).color_name ?? '',
    };
    if (!variantsByProduct[pid]) variantsByProduct[pid] = [];
    variantsByProduct[pid].push(vp);
  });

  // 3) Mapear a tu tipo Product (lo que usa prepareProducts)
  const products: Product[] = baseRows
    .filter(r => typeof r.id === 'string' && typeof r.name === 'string' && typeof r.slug === 'string')
    .map(r => {
      const pid = r.id as string;
      return {
        id: pid,
        name: r.name as string,
        slug: r.slug as string,
        images: (r.images ?? []) as string[],
        features: (r.features ?? []) as string[],
        description: (r.description ?? {}) as any,
        created_at: r.created_at ?? new Date().toISOString(),
        brand_id: (r.brand_id as string) ?? '',
        category_id: (r.category_id as string) ?? '',
        variants: variantsByProduct[pid] ?? [],
        brand: null,
        category: null,
        source: ((r as any).source as 'local' | 'cdr') ?? 'local',
        external_code: ((r as any).external_code as string | null) ?? null,
      };
    });

  return { data: products, count: count ?? 0 };
}
