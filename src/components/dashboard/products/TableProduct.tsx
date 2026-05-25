import { useState, useEffect } from 'react';
import { FaEllipsis } from 'react-icons/fa6';
import { HiOutlineExternalLink } from 'react-icons/hi';
import { Link } from 'react-router-dom';
import { useDeleteProduct, useFilteredProducts } from '../../../hooks';
import { Loader } from '../../shared/Loader';
import { formatDate, formatPrice } from '../../../helpers';
import { Pagination } from '../../shared/Pagination';
import { CellTableProduct } from './CellTableProduct';

const tableHeaders = [
  '',
  'Nombre',
  'Variante',
  'Precio',
  'Stock',
  'Fecha de creación',
  '',
];

export const TableProduct = () => {
  const [openMenuIndex, setOpenMenuIndex] = useState<number | null>(null);
  const [selectedVariants, setSelectedVariants] = useState<{
    [key: string]: number;
  }>({});
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [inputValue, setInputValue] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(inputValue);
      setPage(1);
    }, 500);

    return () => {
      clearTimeout(timer);
    };
  }, [inputValue]);

  const {
    data: products = [],
    isLoading,
    totalProducts,
  } = useFilteredProducts({
    page,
    searchTerm,
    brands: [],
    categories: [],
  });

  const { mutate, isPending } = useDeleteProduct();

  const handleMenuToggle = (index: number) => {
    setOpenMenuIndex(openMenuIndex === index ? null : index);
  };

  const handleVariantChange = (productId: string, variantIndex: number) => {
    setSelectedVariants({
      ...selectedVariants,
      [productId]: variantIndex,
    });
  };

  const handleDeleteProduct = (id: string) => {
    mutate(id);
    setOpenMenuIndex(null);
  };

  if (isLoading || isPending) return <Loader />;

  if (!products || products.length === 0) {
    return (
      <div className="flex flex-col flex-1 border border-ink-200/70 rounded-2xl p-8 bg-white shadow-soft items-center justify-center gap-2">
        <h2 className="font-semibold text-lg text-ink-900">No hay productos</h2>
        <p className="text-sm text-ink-500">
          Agrega tu primer producto para verlo aquí.
        </p>
        <Link
          to="/dashboard/productos/new"
          className="mt-2 bg-brand-600 text-white py-2 px-4 rounded-full text-sm font-semibold hover:bg-brand-700 transition-all"
        >
          Agregar Producto
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 border border-ink-200/70 rounded-2xl p-5 bg-white shadow-soft">
      <div className="mb-6">
        <div className="relative max-w-md">
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
        {searchTerm && (
          <p className="text-sm text-gray-500 mt-2">
            {totalProducts} producto{totalProducts !== 1 ? 's' : ''} encontrado
            {totalProducts !== 1 ? 's' : ''} para "{searchTerm}"
          </p>
        )}
      </div>

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
              const selectedVariantIndex = selectedVariants[product.id] ?? 0;
              const selectedVariant =
                product.variants[selectedVariantIndex] || {};

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
                  <CellTableProduct content={product.name} />
                  <td className="p-4 font-medium tracking-tighter">
                    <select
                      className="border border-gray-300 rounded-md p-1 w-full"
                      onChange={(e) =>
                        handleVariantChange(product.id, Number(e.target.value))
                      }
                      value={selectedVariantIndex}
                    >
                      {product.variants.map((variant, variantIndex) => (
                        <option key={variant.id} value={variantIndex}>
                          {variant.color_name} - {variant.storage}
                        </option>
                      ))}
                    </select>
                  </td>
                  <CellTableProduct
                    content={formatPrice(selectedVariant?.price)}
                  />
                  <CellTableProduct
                    content={(selectedVariant.stock || 0).toString()}
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
                          onClick={() => handleDeleteProduct(product.id)}
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
    </div>
  );
};