import { useState, useEffect } from 'react';
import { FaEllipsis } from 'react-icons/fa6';
import { HiOutlineExternalLink } from 'react-icons/hi';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  useAdminProducts,
  useDeleteProduct,
  useMarkProductsSeen,
  useNewProductsCount,
  useContentDirtyCount,
  usePricingConfig,
  usePublishMlItem,
  useUpdateMlContent,
  useSetProductContentLocked,
  useSetProductStockLocked,
  useSetProductSyncPaused,
  useSetMlItemStatus,
  useSetVariantStock,
  useRecalcMlReadiness,
  useSetProductActive,
  useTaxonomiesAdmin,
} from '../../../hooks';
import { useQuery } from '@tanstack/react-query';
import { Loader } from '../../shared/Loader';
import { formatDate, formatPrice, salePrice, mlMarginFor, DEFAULT_ML_PRICING, type MlPricingConfig } from '../../../helpers';
import { getMlPricingConfig } from '../../../actions/ml-pricing';
import type { MlAttrInput, MlMissingAttr } from '../../../actions/ml';
import type { AdminSortField } from '../../../actions/product';
import { useFilterParams, type ParamValue } from '../../../hooks/useFilterParams';
import { Pagination } from '../../shared/Pagination';
import { CellTableProduct } from './CellTableProduct';
import { MlPublishAttributesModal } from './MlPublishAttributesModal';

// Un producto puede tener VARIAS filas en ml_item_mapping: cada republicación deja la
// anterior como closed / closed_archived. El embed de PostgREST viene sin ORDER BY y
// devuelve primero la más vieja, así que tomar [0] apuntaba el link "Ver en ML" (y el
// botón activar/pausar) a una publicación muerta. Nos quedamos con la publicación VIVA:
// active > paused > under_review > resto, y a igual estado la más nueva (id más alto).
type MlMappingRow = { id?: number; ml_item_id: string; permalink: string | null; status: string; variant_id: string | null };
const ML_STATUS_RANK: Record<string, number> = { active: 0, paused: 1, under_review: 2 };
export const liveMlMapping = (rows?: MlMappingRow[] | null): MlMappingRow | undefined =>
  (rows ?? []).slice().sort((a, b) => {
    const rank = (ML_STATUS_RANK[a.status] ?? 9) - (ML_STATUS_RANK[b.status] ?? 9);
    return rank !== 0 ? rank : (b.id ?? 0) - (a.id ?? 0);
  })[0];

// `sort` marca las columnas clickeables para ordenar. Las que no lo tienen no son
// ordenables a nivel base: "Precio Web" y "Precio ML" se calculan aplicando márgenes
// por tramo/categoría sobre el costo, así que ordenar por costo NO daría el mismo
// orden y el control mentiría.
const tableHeaders: { label: string; sort?: AdminSortField }[] = [
  { label: '' },
  { label: 'Nombre', sort: 'name' },
  { label: 'Origen' },
  { label: 'Marca' },
  { label: 'Categoría' },
  { label: 'Costo CDR', sort: 'price' },
  { label: 'Precio Web' },
  { label: 'Precio ML' },
  { label: 'Stock', sort: 'stock' },
  { label: 'Estado', sort: 'active' },
  { label: 'Listo ML', sort: 'ml_ready' },
  { label: 'Fecha', sort: 'created_at' },
  { label: '' },
];

export const TableProduct = () => {
  const [openMenuIndex, setOpenMenuIndex] = useState<number | null>(null);
  // Form manual de atributos que pide ML (se abre cuando ML rechaza por datos faltantes).
  const [mlAttrModal, setMlAttrModal] = useState<
    { productId: string; variantId: string; productName: string; missing: MlMissingAttr[] } | null
  >(null);
  // TODOS los filtros del listado viven en la URL. Antes la mitad estaba acá en
  // useState (marca, categoría, búsqueda, página y orden) y la otra mitad en el
  // query string: al editar un producto y volver con "atrás" se perdía justo lo
  // que el admin estaba usando para trabajar.
  const { searchParams, get, getNumber, getBool, patch } = useFilterParams();

  const page = getNumber('pag') ?? 1;
  const searchTerm = get('q');
  const brandFilter = get('marca');
  const categoryFilter = get('cat');
  const sourceFilter = (get('source') as '' | 'local' | 'cdr') || '';
  const activeFilter = (get('estado') as '' | 'active' | 'inactive') || '';
  const newOnly = getBool('nuevos');
  const contentDirtyOnly = getBool('mlcambios');
  const mlFilter = (get('ml') as '' | 'in' | 'out') || '';
  const minReadiness = getNumber('listo') ?? 0;
  // Ordenamiento SERVER-SIDE: se clickea el encabezado de la columna y ordena todo el
  // catálogo (no sólo la página visible). Primer click = descendente (mayor a menor),
  // segundo click = ascendente.
  const sortBy = (get('orden') as AdminSortField) || 'created_at';
  const sortDir = get('dir') === 'asc' ? 'asc' : 'desc';

  // El buscador se escribe letra por letra: local + volcado a la URL con respiro.
  const [inputValue, setInputValue] = useState(searchTerm);

  // Cambiar un filtro siempre vuelve a la página 1.
  const setFilter = (values: Record<string, ParamValue>) =>
    patch({ pag: undefined, ...values });

  const setPage: React.Dispatch<React.SetStateAction<number>> = value => {
    const next = typeof value === 'function' ? value(page) : value;
    patch({ pag: next > 1 ? next : undefined });
  };

  // Click en encabezado: si es la columna activa invierte el sentido, si no la activa
  // arrancando de mayor a menor. Siempre vuelve a la página 1 (el orden cambió entero).
  const toggleSort = (field: AdminSortField) => {
    const nextDir = sortBy === field && sortDir === 'desc' ? 'asc' : 'desc';
    setFilter({ orden: field === 'created_at' ? undefined : field, dir: nextDir === 'asc' ? 'asc' : undefined });
  };

  const { brands, categories } = useTaxonomiesAdmin();
  const { data: mlPricingCfg } = useQuery({
    queryKey: ['ml_pricing_config'],
    queryFn: getMlPricingConfig,
  });
  const mlCfg = mlPricingCfg ?? DEFAULT_ML_PRICING;
  const newCount = useNewProductsCount();
  const dirtyCount = useContentDirtyCount();
  const { mutate: markSeen, isPending: markingSeen } = useMarkProductsSeen();

  // Si la búsqueda cambia desde afuera (link con ?q=, o "atrás"), sincronizamos.
  useEffect(() => {
    setInputValue(searchTerm);
  }, [searchTerm]);

  useEffect(() => {
    if (inputValue === searchTerm) return;
    const timer = setTimeout(() => {
      setFilter({ q: inputValue.trim() || undefined });
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputValue, searchTerm]);

  const { products, isLoading, totalProducts } = useAdminProducts(
    page,
    searchTerm,
    brandFilter,
    categoryFilter,
    sourceFilter,
    activeFilter,
    newOnly,
    mlFilter,
    minReadiness,
    contentDirtyOnly,
    sortBy,
    sortDir
  );

  const { mutate, isPending } = useDeleteProduct();
  const { mutate: toggleActive } = useSetProductActive();
  const { publish, isPublishing, publishingVars } = usePublishMlItem({
    // ML pidió atributos que no pudimos completar solos -> abrimos el form para cargarlos.
    onNeedAttributes: ({ productId, variantId, missing }) => {
      const p = products?.find((x: any) => x.id === productId);
      setMlAttrModal({ productId, variantId, productName: p?.name ?? 'este producto', missing });
    },
    onPublished: () => setMlAttrModal(null),
  });
  const { updateContent, isUpdatingContent, updatingContentVars } = useUpdateMlContent();
  const { setContentLocked } = useSetProductContentLocked();
  const { setStockLocked } = useSetProductStockLocked();
  const { setSyncPaused } = useSetProductSyncPaused();
  const { setMlStatus, isSettingMlStatus, mlStatusVars } = useSetMlItemStatus();

  // "Sync pausada" = los tres candados puestos (contenido + precio + stock).
  const isSyncPaused = (p: any) =>
    p.content_locked === true && p.price_locked === true && p.stock_locked === true;
  const { recalc, isRecalculating, recalcVars } = useRecalcMlReadiness();

  const handleUpdateMlContent = (product: any, variantId: string | undefined) => {
    setOpenMenuIndex(null);
    if (!product.is_in_ml) return;
    if (
      window.confirm(
        `¿Actualizar el título y la descripción de "${product.name}" en Mercado Libre?\n\nSe empuja el contenido actual de RF Store (sincronizado de CDR). No cambia precio ni stock.`
      )
    ) {
      updateContent({ productId: product.id, variantId });
    }
  };

  const handlePublishMl = (product: any, variantId: string | undefined) => {
    setOpenMenuIndex(null);
    if (product.is_in_ml) return;
    // Sin variante no podemos armar la publicación: esto sí es un impedimento técnico.
    if (!variantId) {
      toast.error('El producto no tiene una variante para publicar', {
        position: 'bottom-right',
      });
      return;
    }
    // Publicamos directo. Si a ML le falta algún dato obligatorio, la edge function lo intenta
    // auto-completar del texto y, lo que no pueda, lo devuelve -> se abre el form manual
    // (onNeedAttributes) para que el admin lo cargue y reintente.
    if (
      window.confirm(
        `¿Publicar "${product.name}" en Mercado Libre?\n\nSe crea una publicación nueva en tu cuenta de ML con el precio y stock actuales. Si ML pide algún dato, te lo vamos a pedir en pantalla.`
      )
    ) {
      publish({ productId: product.id, variantId });
    }
  };

  const handleMenuToggle = (index: number) => {
    setOpenMenuIndex(openMenuIndex === index ? null : index);
  };

  const handleDeleteProduct = (id: string, name: string) => {
    setOpenMenuIndex(null);
    if (
      !window.confirm(
        `¿Eliminar "${name}"? Esta acción borra el producto, sus imágenes y los items de órdenes históricas que lo referencian.`
      )
    ) {
      return;
    }
    mutate(id);
  };

  const isBusy = isLoading || isPending;
  const showEmpty = !isBusy && (!products || products.length === 0);

  // Stock total de un producto = suma del stock de todas sus variantes.
  const totalStock = (p: any) =>
    (p.variants ?? []).reduce((sum: number, v: any) => sum + (v?.stock ?? 0), 0);

  // El orden ya viene resuelto por la base (products.total_stock, price_usd, etc.),
  // así que la tabla renderiza tal cual lo que devuelve el servidor.
  const displayedProducts = products;

  return (
    <div className="flex flex-col flex-1 border border-ink-200/70 rounded-2xl p-5 bg-white shadow-soft">
      <div className="mb-6 flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative flex-1 sm:max-w-md">
            <input
              type="text"
              placeholder="Buscar productos por nombre, slug, marca o categoría..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className="w-full px-4 py-2 pl-10 border border-ink-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-transparent"
            />
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg
                className="h-5 w-5 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
          </div>

          <select
            value={brandFilter}
            onChange={(e) => setFilter({ marca: e.target.value || undefined })}
            className="px-3 py-2 border border-ink-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
          >
            <option value="">Todas las marcas</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>

          <select
            value={categoryFilter}
            onChange={(e) => setFilter({ cat: e.target.value || undefined })}
            className="px-3 py-2 border border-ink-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
          >
            <option value="">Todas las categorías</option>
            <option value="none">⚠ Sin categoría</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            value={sourceFilter}
            onChange={(e) => setFilter({ source: e.target.value || undefined })}
            className="px-3 py-2 border border-ink-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
          >
            <option value="">Todos los orígenes</option>
            <option value="local">Solo manuales</option>
            <option value="cdr">Solo CDR</option>
          </select>

          <select
            value={activeFilter}
            onChange={(e) => setFilter({ estado: e.target.value || undefined })}
            className="px-3 py-2 border border-ink-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
          >
            <option value="">Cualquier estado</option>
            <option value="active">Solo activos</option>
            <option value="inactive">Solo inactivos (pendientes)</option>
          </select>

          <select
            value={mlFilter}
            onChange={(e) => setFilter({ ml: e.target.value || undefined })}
            className="px-3 py-2 border border-ink-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
          >
            <option value="">ML: todos</option>
            <option value="in">En Mercado Libre</option>
            <option value="out">No publicados en ML</option>
          </select>

          <select
            value={minReadiness}
            onChange={(e) => setFilter({ listo: Number(e.target.value) || undefined })}
            className="px-3 py-2 border border-ink-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
            title="Filtrar por qué tan listo está el producto para publicar en Mercado Libre"
          >
            <option value={0}>Listo ML: cualquiera</option>
            <option value={50}>≥ 50% listo</option>
            <option value={70}>≥ 70% listo</option>
            <option value={90}>≥ 90% listo</option>
            <option value={100}>100% (listos para publicar)</option>
          </select>

          {/* El orden ahora se maneja clickeando el encabezado de cada columna. */}

          {(brandFilter || categoryFilter || sourceFilter || activeFilter || newOnly || mlFilter || minReadiness > 0 || contentDirtyOnly || sortBy !== 'created_at' || sortDir !== 'desc') && (
            <button
              type="button"
              onClick={() =>
                setFilter({
                  marca: undefined,
                  cat: undefined,
                  source: undefined,
                  estado: undefined,
                  nuevos: undefined,
                  ml: undefined,
                  listo: undefined,
                  mlcambios: undefined,
                  orden: undefined,
                  dir: undefined,
                })
              }
              className="whitespace-nowrap text-xs font-semibold text-brand-700 hover:text-brand-900"
            >
              Limpiar filtros
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setFilter({ nuevos: newOnly ? undefined : '1' })}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
              newOnly
                ? 'border-amber-300 bg-amber-50 text-amber-800'
                : 'border-ink-200 bg-white text-ink-700 hover:bg-ink-50'
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${newCount > 0 ? 'bg-amber-500' : 'bg-ink-300'}`} />
            Nuevos desde CDR
            {newCount > 0 && (
              <span className="inline-flex items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">
                {newCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setFilter({ mlcambios: contentDirtyOnly ? undefined : '1' })}
            title="Productos publicados en Mercado Libre cuyo nombre/descripción cambió en CDR y todavía no se actualizó la publicación"
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
              contentDirtyOnly
                ? 'border-blue-300 bg-blue-50 text-blue-800'
                : 'border-ink-200 bg-white text-ink-700 hover:bg-ink-50'
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${dirtyCount > 0 ? 'bg-blue-500' : 'bg-ink-300'}`} />
            Cambió en CDR (pendiente ML)
            {dirtyCount > 0 && (
              <span className="inline-flex items-center justify-center rounded-full bg-blue-500 px-1.5 text-[10px] font-bold text-white">
                {dirtyCount}
              </span>
            )}
          </button>

          {newCount > 0 && (
            <button
              type="button"
              disabled={markingSeen}
              onClick={() => {
                if (window.confirm(`Marcar los ${newCount} productos nuevos como vistos?`)) {
                  markSeen(undefined);
                }
              }}
              className="inline-flex items-center gap-1 rounded-full border border-ink-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-700 transition-all hover:bg-ink-50 disabled:opacity-50"
            >
              Marcar todos como vistos
            </button>
          )}

          <button
            type="button"
            disabled={isRecalculating || !products || products.length === 0}
            onClick={() => recalc({ productIds: products.map((p: any) => p.id) })}
            title="Recalcular el % listo para ML de los productos de esta página (consulta a Mercado Libre)"
            className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 transition-all hover:bg-sky-100 disabled:opacity-50"
          >
            {isRecalculating && recalcVars?.productIds
              ? 'Recalculando…'
              : 'Recalcular % (página)'}
          </button>
        </div>

        <p className="text-sm text-gray-500">
          {totalProducts} producto{totalProducts !== 1 ? 's' : ''}
          {searchTerm ? ` para "${searchTerm}"` : ''}
        </p>
      </div>

      {isBusy ? (
        <div className="flex items-center justify-center py-20">
          <Loader />
        </div>
      ) : showEmpty ? (
        <div className="flex flex-col items-center justify-center gap-2 py-20">
          <h2 className="font-semibold text-lg text-ink-900">
            No se encontraron productos
          </h2>
          <p className="text-sm text-ink-500">
            Probá con otros filtros o términos de búsqueda.
          </p>
        </div>
      ) : (
        <>
          {/* overflow-x-auto va en el CONTENEDOR: en la <table> no hace nada.
              Sin esto la tabla ancha empujaba el ancho de toda la página en
              mobile y había que arrastrar de costado la web entera. */}
          <div className="relative w-full h-full overflow-x-auto">
            <table className="text-sm w-full caption-bottom">
          <thead className="border-b border-gray-200 pb-3">
            <tr className="text-sm font-bold">
              {tableHeaders.map((header, index) => (
                <th key={index} className="h-12 px-4 text-left">
                  {header.sort ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(header.sort!)}
                      aria-sort={
                        sortBy === header.sort
                          ? sortDir === 'asc' ? 'ascending' : 'descending'
                          : 'none'
                      }
                      title={
                        sortBy === header.sort
                          ? `Ordenado ${sortDir === 'desc' ? 'de mayor a menor' : 'de menor a mayor'} — click para invertir`
                          : `Ordenar por ${header.label.toLowerCase()}`
                      }
                      className={`group inline-flex items-center gap-1 rounded transition-colors hover:text-brand-700 ${
                        sortBy === header.sort ? 'text-brand-700' : 'text-ink-900'
                      }`}
                    >
                      {header.label}
                      <span className={`text-[10px] leading-none ${sortBy === header.sort ? 'opacity-100' : 'opacity-30 group-hover:opacity-60'}`}>
                        {sortBy === header.sort ? (sortDir === 'desc' ? '▼' : '▲') : '↕'}
                      </span>
                    </button>
                  ) : (
                    header.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayedProducts.map((product, index) => {
              const selectedVariant = product.variants[0] || {};
              const mlMapping = liveMlMapping((product as any).ml_item_mapping);
              const mlItemId: string | null = mlMapping?.ml_item_id ?? null;
              const mlUrl: string | null =
                mlMapping?.permalink ??
                (mlItemId
                  ? `https://articulo.mercadolibre.com.uy/${mlItemId.replace(/^MLU/, 'MLU-')}`
                  : null);

              return (
                <tr key={index}>
                  <td className="p-4 align-middle sm:table-cell">
                    <img
                      src={
                        product.images[0] ||
                        'https://ui.shadcn.com/placeholder.svg'
                      }
                      alt="Imagen Product"
                      loading="lazy"
                      decoding="async"
                      className="w-16 h-16 aspect-square rounded-md object-contain"
                    />
                  </td>
                  <td className="p-4 align-middle">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-medium text-ink-900">
                        {product.name}
                      </div>
                      {(product as any).seen_at === null && (
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 ring-1 ring-amber-300">
                          Nuevo
                        </span>
                      )}
                      {/* Con los tres candados puestos mostramos uno solo, más claro
                          que repetir tres chips diciendo lo mismo. */}
                      {isSyncPaused(product) ? (
                        <span
                          title="Sync de CDR pausada: CDR no toca nombre, descripción, precio ni stock de este producto"
                          className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900 ring-1 ring-amber-400"
                        >
                          ⏸ Sync pausada
                        </span>
                      ) : (
                        <>
                          {(product as any).content_locked && (
                            <span
                              title="Contenido bloqueado: el sync de CDR no pisa el nombre/descripción de este producto"
                              className="inline-flex items-center rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-700 ring-1 ring-ink-300"
                            >
                              🔒 Candado
                            </span>
                          )}
                          {(product as any).price_locked && (
                            <span
                              title="Precio bloqueado: el sync de CDR no pisa el costo de este producto"
                              className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800 ring-1 ring-emerald-300"
                            >
                              💲 Precio fijo
                            </span>
                          )}
                          {(product as any).stock_locked && (
                            <span
                              title="Stock manual: el sync de CDR no toca el stock de este producto. El precio se sigue actualizando."
                              className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-800 ring-1 ring-violet-300"
                            >
                              📦 Stock manual
                            </span>
                          )}
                        </>
                      )}
                      {(product as any).ml_content_dirty && (product as any).is_in_ml && (
                        <span
                          title="CDR cambió el título o la descripción. Actualizá la publicación de Mercado Libre desde el menú."
                          className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-800 ring-1 ring-blue-300"
                        >
                          Cambió en CDR
                        </span>
                      )}
                    </div>
                    {product.external_code && (
                      <div className="text-xs text-ink-500">
                        cod. {product.external_code}
                      </div>
                    )}
                  </td>
                  <td className="p-4 align-middle">
                    {product.source === 'cdr' ? (
                      <span className="inline-flex items-center rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700 ring-1 ring-sky-200">
                        CDR
                      </span>
                    ) : (
                      <div className="flex flex-col items-start gap-1">
                        <span className="inline-flex items-center rounded-full bg-ink-50 px-2.5 py-1 text-xs font-semibold text-ink-700 ring-1 ring-ink-200">
                          Manual
                        </span>
                        {/* Los manuales pueden venderse online o ser sólo consulta. */}
                        {(product as any).online_payment === true && (
                          <span
                            title="Se compra desde la web (carrito + pasarela)"
                            className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-200"
                          >
                            Pago online
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="p-4 align-middle text-sm text-ink-700">
                    {product.brand?.name ?? '—'}
                  </td>
                  <td className="p-4 align-middle">
                    {product.category?.name ? (
                      <span className="text-sm text-ink-700">
                        {product.category.name}
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
                        Sin categoría
                      </span>
                    )}
                  </td>
                  <PriceCellsForProduct product={product} mlCfg={mlCfg} />
                  {/* Stock TOTAL (suma de variantes), que es por lo que ordena la
                      columna. Antes mostraba sólo la 1ª variante y con productos
                      multi-variante el orden parecía equivocado. */}
                  <StockCell product={product} total={totalStock(product)} />
                  <td className="p-4 align-middle">
                    {product.active ? (
                      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                        Activo
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-200">
                        Inactivo
                      </span>
                    )}
                  </td>
                  <MlReadinessCell
                    product={product as any}
                    mlUrl={mlUrl}
                    onRecalc={() => recalc({ productId: product.id })}
                    recalculating={
                      isRecalculating && recalcVars?.productId === product.id
                    }
                  />
                  <CellTableProduct content={formatDate(product.created_at)} />
                  <td className="relative">
                    <button
                      className="text-slate-900"
                      onClick={() => handleMenuToggle(index)}
                    >
                      <FaEllipsis />
                    </button>
                    {openMenuIndex === index && (
                      <div
                        className="absolute right-0 mt-2 bg-white border border-gray-200 rounded-md shadow-xl z-10 w-[170px]"
                        role="menu"
                      >
                        <Link
                          to={`/dashboard/productos/editar/${product.slug}`}
                          // Nos llevamos el listado tal cual está (filtros, página
                          // y orden) para volver exactamente acá al guardar.
                          state={{ from: `/dashboard/productos?${searchParams.toString()}` }}
                          className="flex items-center gap-1 w-full text-left px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100"
                        >
                          Editar
                          <HiOutlineExternalLink
                            size={13}
                            className="inline-block"
                          />
                        </Link>
                        <button
                          className="block w-full text-left px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100"
                          onClick={() => {
                            toggleActive({
                              id: product.id,
                              active: !product.active,
                            });
                            setOpenMenuIndex(null);
                          }}
                        >
                          {product.active ? 'Inactivar' : 'Activar'}
                        </button>
                        {(product as any).is_in_ml ? (
                          mlUrl ? (
                            <a
                              href={mlUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 w-full text-left px-4 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                            >
                              Ver en Mercado Libre
                              <HiOutlineExternalLink size={13} className="inline-block" />
                            </a>
                          ) : (
                            <span className="block w-full text-left px-4 py-2 text-xs font-medium text-emerald-700">
                              ✓ En Mercado Libre
                            </span>
                          )
                        ) : null}
                        {/* Activar / pausar la publicacion A MANO. Caso tipico: compraron
                            todo el stock en CDR, la publicacion se pauso al quedar en 0 y
                            despues de cargar stock manual hay que volver a levantarla. */}
                        {(product as any).is_in_ml && mlMapping && (
                          <button
                            disabled={
                              isSettingMlStatus && mlStatusVars?.productId === product.id
                            }
                            className={`block w-full px-4 py-2 text-left text-xs font-semibold disabled:opacity-50 ${
                              mlMapping.status === 'active'
                                ? 'text-ink-600 hover:bg-ink-50'
                                : 'text-emerald-700 hover:bg-emerald-50'
                            }`}
                            onClick={() => {
                              const activating = mlMapping.status !== 'active';
                              setOpenMenuIndex(null);
                              if (
                                activating &&
                                totalStock(product) <= 0 &&
                                !window.confirm(
                                  `"${product.name}" está en 0 en RF Store.\n\nSin stock la publicación no se puede activar. ¿Seguir igual?`
                                )
                              )
                                return;
                              setMlStatus({
                                productId: product.id,
                                action: activating ? 'activate' : 'pause',
                                variantId: mlMapping.variant_id ?? selectedVariant?.id,
                              });
                            }}
                            title={
                              mlMapping.status === 'active'
                                ? 'Pausar la publicación en Mercado Libre'
                                : 'Activar la publicación en Mercado Libre con el stock actual de RF Store'
                            }
                          >
                            {isSettingMlStatus && mlStatusVars?.productId === product.id
                              ? 'Aplicando…'
                              : mlMapping.status === 'active'
                              ? '⏸ Pausar publicación en ML'
                              : '▶ Activar publicación en ML'}
                          </button>
                        )}
                        {!(product as any).is_in_ml && (
                          <button
                            disabled={
                              isPublishing && publishingVars?.productId === product.id
                            }
                            className="flex w-full items-center gap-1.5 px-4 py-2 text-left text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                            onClick={() =>
                              handlePublishMl(product, selectedVariant?.id)
                            }
                          >
                            {isPublishing && publishingVars?.productId === product.id ? (
                              <>
                                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                                Publicando…
                              </>
                            ) : (
                              'Publicar en ML'
                            )}
                          </button>
                        )}
                        {(product as any).is_in_ml && (product as any).ml_content_dirty && (
                          <button
                            disabled={
                              isUpdatingContent &&
                              updatingContentVars?.productId === product.id
                            }
                            className="block w-full text-left px-4 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                            onClick={() => handleUpdateMlContent(product, selectedVariant?.id)}
                          >
                            {isUpdatingContent &&
                            updatingContentVars?.productId === product.id
                              ? 'Actualizando…'
                              : 'Actualizar en ML'}
                          </button>
                        )}
                        {product.source === 'cdr' && (
                          <button
                            className="block w-full border-t border-ink-100 px-4 py-2 text-left text-xs font-bold text-amber-700 hover:bg-amber-50"
                            onClick={() => {
                              const pausing = !isSyncPaused(product);
                              if (
                                !pausing ||
                                window.confirm(
                                  `¿Pausar la sync de CDR de "${product.name}"?\n\nCDR deja de tocar TODO: nombre, descripción, precio y stock. El producto queda 100% manual hasta que la reanudes.`
                                )
                              ) {
                                setSyncPaused({ id: product.id, paused: pausing });
                              }
                              setOpenMenuIndex(null);
                            }}
                            title="Frena por completo el sync de CDR para este producto (contenido + precio + stock)"
                          >
                            {isSyncPaused(product)
                              ? '▶ Reanudar sync de CDR'
                              : '⏸ Pausar sync de CDR'}
                          </button>
                        )}
                        {product.source === 'cdr' && (
                          <button
                            className="block w-full text-left px-4 py-2 text-xs font-medium text-violet-700 hover:bg-violet-50"
                            onClick={() => {
                              const locking = !(product as any).stock_locked;
                              if (
                                !locking ||
                                window.confirm(
                                  `¿Poner "${product.name}" en stock manual?\n\nEl sync de CDR va a dejar de tocarle el stock: lo manejás vos desde la columna Stock. El precio se sigue actualizando.\n\nCuando CDR vuelva a tener stock, sacale el candado para que se sincronice de nuevo.`
                                )
                              ) {
                                setStockLocked({
                                  id: product.id,
                                  locked: locking,
                                });
                              }
                              setOpenMenuIndex(null);
                            }}
                            title="Si el stock es manual, el sync de CDR no lo pisa (para cuando tenés mercadería propia y CDR está en 0)"
                          >
                            {(product as any).stock_locked
                              ? 'Volver a stock de CDR'
                              : 'Stock manual (CDR)'}
                          </button>
                        )}
                        {product.source === 'cdr' && (
                          <button
                            className="block w-full text-left px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100"
                            onClick={() => {
                              setContentLocked({
                                id: product.id,
                                locked: !(product as any).content_locked,
                              });
                              setOpenMenuIndex(null);
                            }}
                            title="Si bloqueás el contenido, el sync de CDR no pisa el nombre ni la descripción de este producto"
                          >
                            {(product as any).content_locked
                              ? 'Desbloquear contenido (CDR)'
                              : 'Bloquear contenido (CDR)'}
                          </button>
                        )}
                        {!(product as any).is_in_ml && (
                          <button
                            disabled={
                              isRecalculating && recalcVars?.productId === product.id
                            }
                            className="block w-full text-left px-4 py-2 text-xs font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-50"
                            onClick={() => {
                              setOpenMenuIndex(null);
                              recalc({ productId: product.id });
                            }}
                          >
                            {isRecalculating && recalcVars?.productId === product.id
                              ? 'Recalculando…'
                              : 'Recalcular %'}
                          </button>
                        )}
                        {(product as any).seen_at === null && (
                          <button
                            className="block w-full text-left px-4 py-2 text-xs font-medium text-amber-700 hover:bg-amber-50"
                            onClick={() => {
                              markSeen([product.id]);
                              setOpenMenuIndex(null);
                            }}
                          >
                            Marcar visto
                          </button>
                        )}
                        <button
                          className="block w-full text-left px-4 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50"
                          onClick={() => handleDeleteProduct(product.id, product.name)}
                        >
                          Eliminar
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
              </tbody>
            </table>
          </div>

          <Pagination page={page} setPage={setPage} totalItems={totalProducts} />
        </>
      )}

      {mlAttrModal && (
        <MlPublishAttributesModal
          open
          productName={mlAttrModal.productName}
          missing={mlAttrModal.missing}
          submitting={isPublishing}
          onClose={() => setMlAttrModal(null)}
          onSubmit={(attrs: MlAttrInput[]) =>
            publish({
              productId: mlAttrModal.productId,
              variantId: mlAttrModal.variantId,
              extraAttributes: attrs,
            })
          }
        />
      )}
    </div>
  );
};

// Celda "Stock". Con el candado de stock puesto es editable a mano: el sync de CDR
// ya no la pisa. Si el producto está en ML, guardar dispara el sync de cantidad.
const StockCell = ({ product, total }: { product: any; total: number }) => {
  const { setStock, isSettingStock, stockVars } = useSetVariantStock();
  const variants = product.variants ?? [];
  const editable = product.stock_locked && variants.length === 1;
  const variantId = variants[0]?.id as string | undefined;
  const [value, setValue] = useState(String(total));

  // Si el stock cambia por fuera (venta, sync), reflejarlo mientras no se edite.
  useEffect(() => setValue(String(total)), [total]);

  // Desglose: lo que hay en el depósito propio y lo que tiene CDR. Son dos
  // números distintos: el de CDR baja solo (le compra más gente) y el propio
  // sólo se mueve con nuestras compras y ventas.
  const owned = variants.reduce(
    (acc: number, v: any) => acc + (Number(v.owned_stock) || 0),
    0
  );
  const cdr = variants.reduce(
    (acc: number, v: any) =>
      v.cdr_stock === null || v.cdr_stock === undefined
        ? acc
        : acc + (Number(v.cdr_stock) || 0),
    0
  );
  const hasSplit = owned > 0;
  const breakdown = hasSplit ? (
    <p className='mt-0.5 whitespace-nowrap text-[10px] text-ink-400'>
      <span className='font-semibold text-violet-700'>{owned} propio</span>
      {product.source === 'cdr' ? ` · ${cdr} CDR` : ''}
    </p>
  ) : null;

  if (!editable) {
    return (
      <td className='p-4 align-middle'>
        <span className='text-sm'>{total}</span>
        {breakdown}
      </td>
    );
  }

  const saving = isSettingStock && stockVars?.variantId === variantId;
  const parsed = Math.max(0, Math.floor(Number(value)));
  const dirty = Number.isFinite(parsed) && parsed !== total;

  const save = () => {
    if (!variantId || !dirty || !Number.isFinite(parsed)) return;
    setStock({ variantId, stock: parsed });
  };

  return (
    <td className="p-4 align-middle">
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          min={0}
          value={value}
          disabled={saving}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') setValue(String(total));
          }}
          onBlur={() => !dirty && setValue(String(total))}
          className="w-16 rounded-md border border-violet-300 bg-violet-50/40 px-2 py-1 text-sm font-semibold text-ink-900 outline-none focus:ring-2 focus:ring-violet-300 disabled:opacity-50"
          title="Stock manual: escribí la cantidad y guardá"
        />
        {dirty && (
          <button
            onClick={save}
            disabled={saving}
            className="rounded-md bg-violet-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {saving ? '…' : 'Guardar'}
          </button>
        )}
      </div>
      {breakdown}
    </td>
  );
};

interface PriceCellsProps {
  product: { price_usd?: number | null; category_id?: string | null; subcategory_id?: string | null };
  mlCfg: MlPricingConfig;
}
const PriceCellsForProduct = ({ product, mlCfg }: PriceCellsProps) => {
  const pricing = usePricingConfig();
  const cost = Number(product.price_usd ?? 0);
  // Mismo cálculo que la web pública: usa la config de márgenes guardada (no el default).
  const web = salePrice(cost, pricing);
  // Precio ML en USD (mismo criterio que la web), aunque el listing real pueda ir
  // en pesos al BROU: costo × (1 + margen) × (1 + IVA).
  const mlMarginPct = mlMarginFor(cost, product.category_id ?? null, product.subcategory_id ?? null, mlCfg);
  const mlUsd = cost > 0 ? cost * (1 + mlMarginPct / 100) * (1 + mlCfg.iva_percent / 100) : 0;
  return (
    <>
      <td className='p-4 align-middle text-xs font-medium tracking-tighter'>
        {cost > 0 ? formatPrice(cost) : '—'}
      </td>
      <td className='p-4 align-middle text-xs font-medium tracking-tighter text-emerald-700'>
        {cost > 0 ? formatPrice(web) : '—'}
      </td>
      <td className='p-4 align-middle text-xs font-medium tracking-tighter text-blue-700'>
        {cost > 0 ? formatPrice(mlUsd) : '—'}
      </td>
    </>
  );
};

// Celda "Listo ML": muestra el % REAL guardado (ml_ready_percent, calculado por la edge
// function ml-readiness consultando ML) y qué le falta. Si todavía no se calculó, ofrece
// un botón "Calcular". Los ya publicados muestran el link a la publicación.
interface ReadinessCellProps {
  product: {
    is_in_ml?: boolean;
    ml_ready_percent?: number | null;
    ml_ready_missing?: string[] | null;
    ml_ready_checked_at?: string | null;
  };
  mlUrl: string | null;
  onRecalc: () => void;
  recalculating: boolean;
}
const MlReadinessCell = ({ product, mlUrl, onRecalc, recalculating }: ReadinessCellProps) => {
  if (product.is_in_ml) {
    return (
      <td className="p-4 align-middle">
        {mlUrl ? (
          <a
            href={mlUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Ver la publicación en Mercado Libre"
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700 ring-1 ring-sky-200 hover:bg-sky-100"
          >
            Ver en ML
            <HiOutlineExternalLink size={12} className="inline-block" />
          </a>
        ) : (
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
            ✓ En ML
          </span>
        )}
      </td>
    );
  }

  // Aún sin calcular el % real.
  if (!product.ml_ready_checked_at || product.ml_ready_percent == null) {
    return (
      <td className="p-4 align-middle">
        <button
          type="button"
          onClick={onRecalc}
          disabled={recalculating}
          title="Calcular el % real consultando a Mercado Libre"
          className="inline-flex items-center whitespace-nowrap rounded-full border border-ink-200 bg-white px-2.5 py-1 text-xs font-semibold text-ink-600 hover:bg-ink-50 disabled:opacity-50"
        >
          {recalculating ? 'Calculando…' : 'Calcular %'}
        </button>
      </td>
    );
  }

  const percent = product.ml_ready_percent;
  const missing = product.ml_ready_missing ?? [];

  if (missing.length === 0) {
    return (
      <td className="p-4 align-middle">
        <span
          title="Listo para publicar en Mercado Libre (cumple los atributos que pide la categoría)"
          className="inline-flex items-center whitespace-nowrap rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200"
        >
          ✓ Listo
        </span>
      </td>
    );
  }

  return (
    <td className="p-4 align-middle">
      <span
        title={`Falta para publicar: ${missing.join(', ')}`}
        className="inline-flex flex-col items-start gap-0.5 rounded-lg bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200"
      >
        <span>{percent}% listo</span>
        <span className="font-normal">falta: {missing.join(', ')}</span>
      </span>
    </td>
  );
};