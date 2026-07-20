import { extractFilePath } from '../helpers';
import { ProductInput } from '../interfaces';
import { supabase } from '../supabase/client';

// Regla de negocio: los productos sincronizados de CDR sin stock NO se muestran
// en la web. (Los productos locales/manuales se muestran siempre, aunque tengan
// stock 0.) Se aplica a las consultas que van directo a la tabla `products`;
// el listado de tienda y el home usan la vista `products_with_price`, que ya
// filtra estos productos a nivel de base de datos.
type StockedRow = {
    source?: string | null;
    variants?: ({ stock?: number | null } | null)[] | null;
};

export const hideOutOfStockCdrProducts = <T extends StockedRow>(rows: T[]): T[] =>
    rows.filter(p => {
        if (p.source !== 'cdr') return true;
        const totalStock = (p.variants ?? []).reduce(
            (sum, v) => sum + (v?.stock ?? 0),
            0
        );
        return totalStock > 0;
    });

export const getProducts = async (page: number) => {
    const itemsPerPage = 10;
    const from = (page - 1) * itemsPerPage;
    const to = from + itemsPerPage - 1;

    const {
        data: products,
        error,
        count,
    } = await supabase
        .from('products')
        .select('*, variants(*), brand:brands(*), category:categories(*)', { count: 'exact' })
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to);

    if (error) {
        console.log(error.message);
        throw new Error(error.message);
    }

    return { products, count };
};



export const getRecentProducts = async () => {
    const { data: products, error } = await supabase
        .from('products')
        .select('*, variants(*), brand:brands(*), category:categories(*)')
        .eq('active', true)
        .order('created_at', { ascending: false })
        .limit(4);

    if (error) {
        console.log(error.message);
        throw new Error(error.message);
    }

    return hideOutOfStockCdrProducts(products);
};

export const getRandomProducts = async () => {
    const { data: products, error } = await supabase
        .from('products')
        .select('*, variants(*), brand:brands(*), category:categories(*)')
        .eq('active', true)
        .limit(20);

    if (error) {
        console.log(error.message);
        throw new Error(error.message);
    }

    const randomProducts = hideOutOfStockCdrProducts(products)
        .sort(() => 0.5 - Math.random())
        .slice(0, 8);

    return randomProducts;
};

export const getProductBySlug = async (slug: string) => {
    const { data, error } = await supabase
        .from('products')
        .select('*, variants(*), brand:brands(*), category:categories(*)')
        .eq('slug', slug)
        .single();

    if (error) {
        console.log(error.message);
        throw new Error(error.message);
    }

    return data;
};

export const getSimilarProductsByCategory = async (
    categoryId: string,
    excludeProductId: string
) => {
    const { data: products, error } = await supabase
        .from('products')
        .select('*, variants(*), brand:brands(*), category:categories(*)')
        .eq('category_id', categoryId)
        .eq('active', true)
        .neq('id', excludeProductId)
        .order('created_at', { ascending: false })
        .limit(4);

    if (error) {
        console.log(error.message);
        throw new Error(error.message);
    }

    return hideOutOfStockCdrProducts(products);
};

// Normaliza a minúsculas y sin acentos (igual que la columna search_text en la DB).
// Así "Micrófono" y "microfono" matchean igual.
const normalizeSearch = (s: string) =>
    s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .trim();

export const searchProducts = async (searchTerm: string) => {
    // Búsqueda inteligente: separa en palabras y exige que TODAS aparezcan
    // (en cualquier orden), sin importar acentos, sobre el nombre + código del
    // producto (columna generada `search_text`). Ej: "sony auricular" encuentra
    // "Auriculares Sony WH-1000XM5"; "microfono genius" encuentra "Micrófono Genius".
    const words = normalizeSearch(searchTerm).split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const fullTerm = normalizeSearch(searchTerm);

    const SELECT = '*, variants(*), brand:brands(*), category:categories(*)';

    // 1) Coincidencia por texto (nombre + código): todas las palabras.
    let textQuery = supabase.from('products').select(SELECT).eq('active', true);
    for (const word of words) {
        textQuery = textQuery.ilike('search_text', `%${word}%`);
    }

    // 2) Coincidencia por NOMBRE de categoría/subcategoría. Así "celulares"
    //    devuelve los productos de la categoría Celulares aunque el nombre del
    //    producto no diga "celular".
    const [catsRes, subsRes] = await Promise.all([
        supabase.from('categories').select('id, name'),
        supabase.from('subcategories').select('id, name'),
    ]);
    const nameMatches = (name: string) => {
        const n = normalizeSearch(name);
        return n.length >= 3 && (n.includes(fullTerm) || fullTerm.includes(n));
    };
    const matchCatIds = (catsRes.data ?? [])
        .filter(c => nameMatches(c.name ?? ''))
        .map(c => c.id);
    const matchSubIds = (subsRes.data ?? [])
        .filter(s => nameMatches(s.name ?? ''))
        .map(s => s.id);

    const queries = [textQuery.limit(40)];
    if (matchCatIds.length || matchSubIds.length) {
        let taxQuery = supabase.from('products').select(SELECT).eq('active', true);
        const ors: string[] = [];
        if (matchCatIds.length) ors.push(`category_id.in.(${matchCatIds.join(',')})`);
        if (matchSubIds.length) ors.push(`subcategory_id.in.(${matchSubIds.join(',')})`);
        taxQuery = taxQuery.or(ors.join(','));
        queries.push(taxQuery.limit(40));
    }

    const results = await Promise.all(queries);
    for (const r of results) {
        if (r.error) {
            console.log(r.error.message);
            throw new Error(r.error.message);
        }
    }

    // Merge único: primero los de texto (más relevantes), luego los de categoría.
    const map = new Map<string, any>();
    for (const r of results) {
        for (const p of (r.data ?? []) as any[]) {
            if (!map.has(p.id)) map.set(p.id, p);
        }
    }

    return hideOutOfStockCdrProducts([...map.values()] as any);
};

/* ********************************** */
/* ADMINISTRADOR          */
/* ********************************** */
// Listado para el panel admin: trae TODOS los productos (activos e inactivos,
// y CDR con o sin stock) con búsqueda + paginación. A diferencia de la tienda,
// no usa la vista products_with_price para que el admin pueda gestionarlos todos.
export const getAdminProducts = async (
    page: number,
    searchTerm = '',
    brandId = '',
    categoryId = '',
    source: '' | 'local' | 'cdr' = '',
    activeFilter: '' | 'active' | 'inactive' = '',
    newOnly = false,
    mlFilter: '' | 'in' | 'out' = '',
    minReadiness = 0,
    contentDirtyOnly = false
) => {
    const itemsPerPage = 25;
    const from = (page - 1) * itemsPerPage;
    const to = from + itemsPerPage - 1;

    let query = supabase
        .from('products')
        .select(
            '*, variants(*), brand:brands(*), category:categories(*), ml_item_mapping(ml_item_id, permalink, status)',
            {
                count: 'exact',
            }
        )
        .order('created_at', { ascending: false })
        .order('id', { ascending: true });

    // Filtro "En Mercado Libre": usa la columna denormalizada products.is_in_ml
    // (mantenida por trigger sobre ml_item_mapping). Compone bien con búsqueda,
    // marca, categoría, paginación y count — sin pasar cientos de IDs por la URL.
    if (mlFilter === 'in') query = query.eq('is_in_ml', true);
    else if (mlFilter === 'out') query = query.eq('is_in_ml', false);

    if (searchTerm.trim()) {
        const ilike = `%${searchTerm.trim()}%`;
        query = query.or(`name.ilike.${ilike},slug.ilike.${ilike}`);
    }

    if (brandId) query = query.eq('brand_id', brandId);

    if (categoryId === 'none') query = query.is('category_id', null);
    else if (categoryId) query = query.eq('category_id', categoryId);

    if (source === 'local') query = query.or('source.eq.local,source.is.null');
    else if (source === 'cdr') query = query.eq('source', 'cdr');

    if (activeFilter === 'active') query = query.eq('active', true);
    else if (activeFilter === 'inactive') query = query.eq('active', false);

    if (newOnly) query = query.is('seen_at', null);

    // Filtro "Cambió en CDR (pendiente ML)": productos publicados en ML cuyo contenido
    // (nombre/descripción) cambió en CDR y todavía no se empujó a la publicación.
    if (contentDirtyOnly) query = query.eq('ml_content_dirty', true);

    // Filtro por "% listo para ML": columna computada ml_ready_percent (función SQL).
    // Filtra a nivel base => respeta paginación y total, no solo la página visible.
    if (minReadiness > 0) query = query.gte('ml_ready_percent', minReadiness);

    const { data: products, error, count } = await query.range(from, to);
    if (error) throw new Error(error.message);
    return { products: products ?? [], count: count ?? 0 };
};

export const getNewProductsCount = async (): Promise<number> => {
    const { data, error } = await (supabase.rpc as any)('count_new_products');
    if (error) throw new Error(error.message);
    return Number(data ?? 0);
};

// Cuántos productos publicados en ML tienen cambios de contenido de CDR sin aplicar
// (para el chip "Cambió en CDR" del listado admin).
export const getContentDirtyCount = async (): Promise<number> => {
    const { count, error } = await supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('ml_content_dirty', true);
    if (error) throw new Error(error.message);
    return count ?? 0;
};

export const markProductsSeen = async (ids?: string[]): Promise<number> => {
    const { data, error } = await (supabase.rpc as any)('mark_products_seen', {
        p_ids: ids && ids.length > 0 ? ids : null,
    });
    if (error) throw new Error(error.message);
    return Number(data ?? 0);
};

// Activa / inactiva un producto (para ocultarlo o mostrarlo en la web).
export const setProductActive = async (id: string, active: boolean) => {
    const { error } = await supabase
        .from('products')
        .update({ active })
        .eq('id', id);
    if (error) throw new Error(error.message);
};

// Candado de contenido: cuando está en true, el sync de CDR NO pisa
// nombre/descripción/features de este producto (para no perder ediciones manuales).
export const setProductContentLocked = async (id: string, locked: boolean) => {
    const { error } = await supabase
        .from('products')
        .update({ content_locked: locked })
        .eq('id', id);
    if (error) throw new Error(error.message);
};

export const createProduct = async (productInput: ProductInput) => {
    const { data: product, error: productError } = await supabase
        .from('products')
        .insert({
            name: productInput.name,
            slug: productInput.slug,
            features: productInput.features,
            description: productInput.description,
            images: [],
            brand_id: productInput.brandId,
            category_id: productInput.categoryId,
            subcategory_id: productInput.subcategoryId || null,
        })
        .select()
        .single();

    if (productError) throw new Error(productError.message);

    const folderName = product.id;

    const uploadedImages = await Promise.all(
        productInput.images.map(async image => {
            const { data, error } = await supabase.storage
                .from('product-images')
                .upload(`${folderName}/${product.id}-${image.name}`, image);

            if (error) throw new Error(error.message);

            return supabase.storage
                .from('product-images')
                .getPublicUrl(data.path).data.publicUrl;
        })
    );

    const { error: updatedError } = await supabase
        .from('products')
        .update({ images: uploadedImages })
        .eq('id', product.id);

    if (updatedError) throw new Error(updatedError.message);

    const variants = productInput.variants.map(variant => ({
        product_id: product.id,
        stock: variant.stock,
        price: variant.price,
        storage: variant.storage,
        color: variant.color,
        color_name: variant.colorName,
    }));

    const { error: variantsError } = await supabase
        .from('variants')
        .insert(variants);

    if (variantsError) throw new Error(variantsError.message);

    return product;
};

export const deleteProduct = async (productId: string) => {
    // Las variants tienen FK con order_items (RESTRICT). Si el producto tiene ventas
    // históricas, borramos primero los order_items asociados.
    const { data: variants, error: getVariantsError } = await supabase
        .from('variants')
        .select('id')
        .eq('product_id', productId);
    if (getVariantsError) throw new Error(getVariantsError.message);

    const variantIds = (variants ?? []).map(v => v.id);
    if (variantIds.length > 0) {
        const { error: deleteOrderItemsError } = await supabase
            .from('order_items')
            .delete()
            .in('variant_id', variantIds);
        if (deleteOrderItemsError) throw new Error(deleteOrderItemsError.message);
    }

    // Obtener imágenes ANTES de borrar el producto (después no se puede recuperar).
    const { data: productImages, error: productImagesError } = await supabase
        .from('products')
        .select('images')
        .eq('id', productId)
        .single();
    if (productImagesError) throw new Error(productImagesError.message);

    // Las variants se borran en cascada por la FK products → variants.
    const { error: productDeleteError } = await supabase
        .from('products')
        .delete()
        .eq('id', productId);
    if (productDeleteError) throw new Error(productDeleteError.message);

    const paths = (productImages?.images ?? [])
        .map(extractFilePath)
        .filter((path): path is string => path !== null);

    if (paths.length > 0) {
        const { error: storageError } = await supabase.storage
            .from('product-images')
            .remove(paths);
        // Si falla la limpieza de storage, el producto ya quedó borrado.
        // Lo reportamos como warning para no romper la UI.
        if (storageError) console.warn('Storage cleanup:', storageError.message);
    }

    return true;
};

export const updateProduct = async (
    productId: string,
    productInput: ProductInput
) => {
    const { data: currentProduct, error: currentProductError } =
        await supabase
            .from('products')
            .select('images, slug, name')
            .eq('id', productId)
            .single();

    if (currentProductError)
        throw new Error(currentProductError.message);

    const existingImages = currentProduct.images || [];
    const currentSlug = currentProduct.slug;

    let finalSlug = productInput.slug;
    if (productInput.name !== currentProduct.name) {
        try {
            const { generateUniqueSlug } = await import('../helpers');
            finalSlug = await generateUniqueSlug(productInput.name, currentSlug);
        } catch (error) {
            console.error('Error generating unique slug:', error);
            finalSlug = currentSlug;
        }
    }

    const { data: updatedProduct, error: productError } = await supabase
        .from('products')
        .update({
            name: productInput.name,
            slug: finalSlug,
            features: productInput.features,
            description: productInput.description,
            brand_id: productInput.brandId,
            category_id: productInput.categoryId,
            subcategory_id: productInput.subcategoryId || null,
        })
        .eq('id', productId)
        .select()
        .single();

    if (productError) throw new Error(productError.message);

    const folderName = productId;

    const validImages = productInput.images.filter(image => image) as [
        File | string
    ];

    const imagesToDelete = existingImages.filter(
        image => !validImages.includes(image)
    );

    const filesToDelete = imagesToDelete
        .map(extractFilePath)
        .filter((path): path is string => path !== null);

    if (filesToDelete.length > 0) {
        const { error: deleteImagesError } = await supabase.storage
            .from('product-images')
            .remove(filesToDelete);

        if (deleteImagesError) {
            console.log(deleteImagesError);
            throw new Error(deleteImagesError.message);
        } else {
            console.log('Imágenes eliminadas con éxito:', filesToDelete);
        }
    }

    const newImages = await Promise.all(
        validImages.map(async image => {
            if (typeof image === 'string') return image;

            const { data, error } = await supabase.storage
                .from('product-images')
                .upload(`${folderName}/${productId}-${image.name}`, image);

            if (error) throw new Error(error.message);

            return `${
                supabase.storage
                    .from('product-images')
                    .getPublicUrl(data.path).data.publicUrl
            }`;
        })
    );

    const { error: updateImagesError } = await supabase
        .from('products')
        .update({ images: newImages })
        .eq('id', productId);

    if (updateImagesError) throw new Error(updateImagesError.message);

    for (const variant of productInput.variants) {
        if (variant.id) {
            const { error: updateVariantError } = await supabase
                .from('variants')
                .update({
                    price: variant.price,
                    stock: variant.stock,
                    storage: variant.storage,
                    color: variant.color,
                    color_name: variant.colorName,
                })
                .eq('id', variant.id);

            if (updateVariantError)
                throw new Error(updateVariantError.message);
        } else {
            const { error: createVariantError } = await supabase
                .from('variants')
                .insert({
                    product_id: productId,
                    price: variant.price,
                    stock: variant.stock,
                    storage: variant.storage,
                    color: variant.color,
                    color_name: variant.colorName,
                });

            if (createVariantError)
                throw new Error(createVariantError.message);
        }
    }

    return updatedProduct;
};