import { supabase } from '../supabase/client';
import type { Product, VariantProduct } from '../interfaces';

export async function getHomeProducts(limit = 8): Promise<Product[]> {
  const { data: baseRows, error: baseErr } = await supabase
    .from('products_with_price')
    .select('id, name, slug, images, features, description, created_at, brand_id, category_id, price, margin_override_percent')
    .order('created_at', { ascending: false }) // o por price si preferís
    .limit(limit);

  if (baseErr) throw baseErr;
  if (!baseRows?.length) return [];

  const ids = baseRows
    .map(r => r.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  const { data: vars, error: varsErr } = await supabase
    .from('variants')
    .select('id, product_id, price, stock, color, storage, color_name')
    .in('product_id', ids);

  if (varsErr) throw varsErr;

  const byProduct: Record<string, VariantProduct[]> = {};
  (vars ?? []).forEach(v => {
    const pid = v.product_id as string;
    const vp: VariantProduct = {
      id: v.id as string,
      stock: (v.stock ?? 0) as number,
      price: (v.price ?? 0) as number,
      storage: (v.storage ?? '') as string,
      color: (v.color ?? '#000000') as string,
      color_name: (v as any).color_name ?? '',
    };
    (byProduct[pid] ??= []).push(vp);
  });

  return baseRows.map(r => {
    const pid = (r.id as string) ?? '';
    return {
      id: pid,
      name: (r.name as string) ?? '',
      slug: (r.slug as string) ?? '',
      images: (r.images ?? []) as string[],
      features: (r.features ?? []) as string[],
      description: (r.description ?? {}) as any,
      created_at: r.created_at ?? new Date().toISOString(),
      brand_id: (r.brand_id as string) ?? '',
      category_id: (r.category_id as string) ?? '',
      variants: byProduct[pid] ?? [],
      brand: null,
      category: null,
      // Margen manual: el front calcula el precio igual que la vista.
      margin_override_percent:
        (r as any).margin_override_percent === null ||
        (r as any).margin_override_percent === undefined
          ? null
          : Number((r as any).margin_override_percent),
    };
  });
}
