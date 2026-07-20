import { useState, useEffect } from 'react';
import { FaEllipsis } from 'react-icons/fa6';
import { HiOutlineExternalLink } from 'react-icons/hi';
import { Link, useSearchParams } from 'react-router-dom';
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
  useRecalcMlReadiness,
  useSetProductActive,
  useTaxonomiesAdmin,
} from '../../../hooks';
import { useQuery } from '@tanstack/react-query';
import { Loader } from '../../shared/Loader';
import { formatDate, formatPrice, salePrice, mlMarginFor, DEFAULT_ML_PRICING, type MlPricingConfig } from '../../../helpers';
import { getMlPricingConfig } from '../../../actions/ml-pricing';
import type { MlAttrInput, MlMissingAttr } from '../../../actions/ml';
import { Pagination } from '../../shared/Pagination';
import { CellTableProduct } from './CellTableProduct';
import { MlPublishAttributesModal } from './MlPublishAttributesModal';

const tableHeaders = [
  '',
  'Nombre',
  'Origen',
  'Marca',
  'Categoría',
  'Costo CDR',
  'Precio Web',
  'Precio ML',
  'Stock',
  'Estado',
  'Listo ML',
  'Fecha',
  '',
];

export const TableProduct = () => {
  const [openMenuIndex, setOpenMenuIndex] = useState<number | null>(null);
  // Form manual de atributos que pide ML (se abre cuando ML rechaza por datos faltantes).
  const [mlAttrModal, setMlAttrModal] = useState<
    { productId: string; variantId: string; productName: string; missing: MlMissingAttr[] } | null
  >(null);
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const [brandFilter, setBrandFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'' | 'local' | 'cdr'>(
    (searchParams.get('source') as '' | 'local' | 'cdr') || ''
  );
  const [activeFilter, setActiveFilter] = useState<'' | 'active' | 'inactive'>(
    (searchParams.get('estado') as '' | 'active' | 'inactive') || ''
  );
  const [newOnly, setNewOnly] = useState<boolean>(searchParams.get('nuevos') === '1');
  const [contentDirtyOnly, setContentDirtyOnly] = useState<boolean>(searchParams.get('mlcambios') === '1');
  const [mlFilter, setMlFilter] = useState<'' | 'in' | 'out'>(
    (searchParams.get('ml') as '' | 'in' | 'out') || ''
  );
  const [minReadiness, setMinReadiness] = useState<number>(
    Number(searchParams.get('listo')) || 0
  );
  // Ordenamiento client-side de la página cargada. '' = orden por defecto del
  // servidor (created_at desc). "stock" es la SUMA del stock de las variantes.
  const [sortBy, setSortBy] = useState<'' | 'stock' | 'estado' | 'fecha' | 'ml'>('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Si vienen filtros por query string (ej desde /dashboard/cdr), persistirlos en estado
  useEffect(() => {
    const s = searchParams.get('source') as '' | 'local' | 'cdr' | null;
    const a = searchParams.get('estado') as '' | 'active' | 'inactive' | null;
    if (s !== null && s !== sourceFilter) setSourceFilter(s);
    if (a !== null && a !== activeFilter) setActiveFilter(a);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const { brands, categories } = useTaxonomiesAdmin();
  const { data: mlPricingCfg } = useQuery({
    queryKey: ['ml_pricing_config'],
    queryFn: getMlPricingConfig,
  });
  const mlCfg = mlPricingCfg ?? DEFAULT_ML_PRICING;
  const newCount = useNewProductsCount();
  const dirtyCount = useContentDirtyCount();
  const { mutate: markSeen, isPending: markingSeen } = useMarkProductsSeen();

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(inputValue);
      setPage(1);
    }, 500);

    return () => {
      clearTimeout(timer);
    };
  }, [inputValue]);

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
    contentDirtyOnly
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

  // Ordena la página cargada según el criterio elegido. Sin criterio, respeta el
  // orden que devuelve el servidor (created_at desc).
  const displayedProducts = (() => {
    if (!sortBy) return products;
    const dir = sortDir === 'asc' ? 1 : -1;
    const compare = (a: any, b: any) => {
      switch (sortBy) {
        case 'stock':
          return (totalStock(a) - totalStock(b)) * dir;
        case 'estado':
          return ((a.active ? 1 : 0) - (b.active ? 1 : 0)) * dir;
        case 'fecha':
          return (
            (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir
          );
        case 'ml':
          return (
            ((a.ml_ready_percent ?? -1) - (b.ml_ready_percent ?? -1)) * dir
          );
        default:
          return 0;
      }
    };
    return [...products].sort(compare);
  })();

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
            onChange={(e) => {
              setBrandFilter(e.target.value);
              setPage(1);
            }}
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
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setPage(1);
            }}
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
            onChange={(e) => {
              setSourceFilter(e.target.value as '' | 'local' | 'cdr');
              setPage(1);
            }}
            className="px-3 py-2 border border-ink-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
          >
            <option value="">Todos los orígenes</option>
            <option value="local">Solo manuales</option>
            <option value="cdr">Solo CDR</option>
          </select>

          <select
            value={activeFilter}
            onChange={(e) => {
              setActiveFilter(e.target.value as '' | 'active' | 'inactive');
              setPage(1);
            }}
            className="px-3 py-2 border border-ink-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
          >
            <option value="">Cualquier estado</option>
            <option value="active">Solo activos</option>
            <option value="inactive">Solo inactivos (pendientes)</option>
          </select>

          <select
            value={mlFilter}
            onChange={(e) => {
              setMlFilter(e.target.value as '' | 'in' | 'out');
              setPage(1);
            }}
            className="px-3 py-2 border border-ink-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
          >
            <option value="">ML: todos</option>
            <option value="in">En Mercado Libre</option>
            <option value="out">No publicados en ML</option>
          </select>

          <select
            value={minReadiness}
            onChange={(e) => {
              setMinReadiness(Number(e.target.value));
              setPage(1);
            }}
            className="px-3 py-2 border border-ink-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
            title="Filtrar por qué tan listo está el producto para publicar en Mercado Libre"
          >
            <option value={0}>Listo ML: cualquiera</option>
            <option value={50}>≥ 50% listo</option>
            <option value={70}>≥ 70% listo</option>
            <option value={90}>≥ 90% listo</option>
            <option value={100}>100% (listos para publicar)</option>
          </select>

          <select
            value={sortBy}
            onChange={(e) =>
              setSortBy(e.target.value as '' | 'stock' | 'estado' | 'fecha' | 'ml')
            }
            className="px-3 py-2 border border-ink-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
            title="Ordenar los productos de esta página"
          >
            <option value="">Ordenar por…</option>
            <option value="stock">Stock</option>
            <option value="estado">Estado</option>
            <option value="fecha">Fecha</option>
            <option value="ml">Listo ML</option>
          </select>

          {sortBy && (
            <button
              type="button"
              onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-ink-300 px-3 py-2 text-sm font-semibold text-ink-700 transition-all hover:bg-ink-50"
              title={sortDir === 'asc' ? 'Ascendente' : 'Descendente'}
            >
              {sortDir === 'asc' ? '↑ Ascendente' : '↓ Descendente'}
            </button>
          )}

          {(brandFilter || categoryFilter || sourceFilter || activeFilter || newOnly || mlFilter || minReadiness > 0 || contentDirtyOnly || sortBy) && (
            <button
              type="button"
              onClick={() => {
                setBrandFilter('');
                setCategoryFilter('');
                setSourceFilter('');
                setActiveFilter('');
                setNewOnly(false);
                setMlFilter('');
                setMinReadiness(0);
                setContentDirtyOnly(false);
                setSortBy('');
                setSortDir('desc');
                setSearchParams({}, { replace: true });
                setPage(1);
              }}
              className="whitespace-nowrap text-xs font-semibold text-brand-700 hover:text-brand-900"
            >
              Limpiar filtros
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setNewOnly(v => !v);
              setPage(1);
            }}
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
            onClick={() => {
              setContentDirtyOnly((v) => !v);
              setPage(1);
            }}
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
          <div className="relative w-full h-full">
            <table className="text-sm w-full caption-bottom overflow-auto">
          <thead className="border-b border-gray-200 pb-3">
            <tr className="text-sm font-bold">
              {tableHeaders.map((header, index) => (
                <th key={index} className="h-12 px-4 text-left">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayedProducts.map((product, index) => {
              const selectedVariant = product.variants[0] || {};
              const mlMapping = (product as any).ml_item_mapping?.[0];
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
                      {(product as any).content_locked && (
                        <span
                          title="Contenido bloqueado: el sync de CDR no pisa el nombre/descripción de este producto"
                          className="inline-flex items-center rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-700 ring-1 ring-ink-300"
                        >
                          🔒 Candado
                        </span>
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
                      <span className="inline-flex items-center rounded-full bg-ink-50 px-2.5 py-1 text-xs font-semibold text-ink-700 ring-1 ring-ink-200">
                        Manual
                      </span>
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
                  <CellTableProduct
                    content={(selectedVariant.stock || 0).toString()}
                  />
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
                        ) : (
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
  // en pesos al BCU: costo × (1 + margen) × (1 + IVA).
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