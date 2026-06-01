import { useState, useEffect } from 'react';
import { FaEllipsis } from 'react-icons/fa6';
import { HiOutlineExternalLink } from 'react-icons/hi';
import { Link, useSearchParams } from 'react-router-dom';
import {
  useAdminProducts,
  useDeleteProduct,
  useSetProductActive,
  useTaxonomiesAdmin,
} from '../../../hooks';
import { Loader } from '../../shared/Loader';
import { formatDate, formatPrice } from '../../../helpers';
import { Pagination } from '../../shared/Pagination';
import { CellTableProduct } from './CellTableProduct';

const tableHeaders = [
  '',
  'Nombre',
  'Origen',
  'Marca',
  'Categoría',
  'Precio',
  'Stock',
  'Estado',
  'Fecha de creación',
  '',
];

export const TableProduct = () => {
  const [openMenuIndex, setOpenMenuIndex] = useState<number | null>(null);
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

  // Si vienen filtros por query string (ej desde /dashboard/cdr), persistirlos en estado
  useEffect(() => {
    const s = searchParams.get('source') as '' | 'local' | 'cdr' | null;
    const a = searchParams.get('estado') as '' | 'active' | 'inactive' | null;
    if (s !== null && s !== sourceFilter) setSourceFilter(s);
    if (a !== null && a !== activeFilter) setActiveFilter(a);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const { brands, categories } = useTaxonomiesAdmin();

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
    activeFilter
  );

  const { mutate, isPending } = useDeleteProduct();
  const { mutate: toggleActive } = useSetProductActive();

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

  return (
    <div className="flex flex-col flex-1 border border-ink-200/70 rounded-2xl p-5 bg-white shadow-soft">
      <div className="mb-6 flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
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

          {(brandFilter || categoryFilter || sourceFilter || activeFilter) && (
            <button
              type="button"
              onClick={() => {
                setBrandFilter('');
                setCategoryFilter('');
                setSourceFilter('');
                setActiveFilter('');
                setSearchParams({}, { replace: true });
                setPage(1);
              }}
              className="text-xs font-semibold text-brand-700 hover:text-brand-900"
            >
              Limpiar filtros
            </button>
          )}
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
            {products.map((product, index) => {
              const selectedVariant = product.variants[0] || {};

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
                    <div className="text-sm font-medium text-ink-900">
                      {product.name}
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
                  <CellTableProduct
                    content={formatPrice(selectedVariant?.price)}
                  />
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
                        className="absolute right-0 mt-2 bg-white border border-gray-200 rounded-md shadow-xl z-10 w-[120px]"
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
    </div>
  );
};