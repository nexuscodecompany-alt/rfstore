import { useState } from 'react';
import { HiOutlineSearch } from 'react-icons/hi';
import { IoMdClose } from 'react-icons/io';
import { useGlobalStore } from '../../store/global.store';
import { formatPrice, salePrice } from '../../helpers';
import { searchProducts } from '../../actions';
import { useNavigate } from 'react-router-dom';
import { usePricingConfig } from '../../hooks';

// 1) Tipo del resultado según el action
type SearchResult = Awaited<ReturnType<typeof searchProducts>>;

export const Search = () => {
  const [searchTerm, setSearchTerm] = useState('');
  // 2) Estado con el tipo correcto (no Product[])
  const [searchResults, setSearchResults] = useState<SearchResult>([]);

  const closeSheet = useGlobalStore(state => state.closeSheet);
  const navigate = useNavigate();
  const pricing = usePricingConfig();

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const term = searchTerm.trim();
    if (!term) return;

    const products = await searchProducts(term);
    setSearchResults(products); // ✅ ahora coincide el tipo
  };

  return (
    <>
      <div className="flex items-center gap-10 py-5 border-b px-7 border-slate-200">
        <form className="flex items-center flex-1 gap-3" onSubmit={handleSearch}>
          <HiOutlineSearch size={22} />
          <input
            type="text"
            placeholder="¿Qué busca?"
            className="w-full text-sm outline-none "
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </form>
        <button onClick={closeSheet}>
          <IoMdClose size={25} className="text-black" />
        </button>
      </div>

      {/* RESULTADOS DE BÚSQUEDA */}
      <div className="p-5">
        {searchResults.length > 0 ? (
          <ul>
            {searchResults.map(product => {
              const variants = (product as any).variants ?? [];
              const v0 = variants[0]; // accesos seguros
              const minCost = variants.length
                ? Math.min(...variants.map((v: any) => Number(v.price) || 0))
                : Number((product as any).price) || 0;
              const displayPrice = salePrice(minCost, pricing);
              return (
                <li className="py-2 group" key={(product as any).id}>
                  <button
                    className="flex items-center gap-3"
                    onClick={() => {
                      navigate(`/producto/${(product as any).slug}`);
                      closeSheet();
                    }}
                  >
                    <img
                      src={(product as any).images?.[0] ?? ''}
                      alt={(product as any).name ?? ''}
                      className="object-contain w-20 h-20 p-3"
                    />

                    <div className="flex flex-col gap-1">
                      <p className="text-sm font-semibold group-hover:underline">
                        {(product as any).name}
                      </p>

                      <p className="text-[13px] text-gray-600">
                        {v0 ? `${v0.storage} / ${v0.color_name}` : '—'}
                      </p>

                      <p className="text-sm font-medium text-gray-600">
                        {formatPrice(displayPrice)}{' '}
                        <span className="text-[10px] text-gray-500">
                          IVA incluido
                        </span>
                      </p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-gray-600">
            {searchTerm.trim() ? 'No se encontraron resultados' : 'Escriba para buscar'}
          </p>
        )}
      </div>
    </>
  );
};
