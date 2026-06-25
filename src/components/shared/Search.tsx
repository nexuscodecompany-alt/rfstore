import { useEffect, useState } from 'react';
import { HiOutlineSearch } from 'react-icons/hi';
import { IoMdClose } from 'react-icons/io';
import { useGlobalStore } from '../../store/global.store';
import { formatPrice, salePrice } from '../../helpers';
import { searchProducts } from '../../actions';
import { useNavigate } from 'react-router-dom';
import { usePricingConfig } from '../../hooks';

type SearchResult = Awaited<ReturnType<typeof searchProducts>>;
type Status = 'idle' | 'searching' | 'results' | 'empty';

export const Search = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult>([]);
  const [status, setStatus] = useState<Status>('idle');

  const closeSheet = useGlobalStore(state => state.closeSheet);
  const navigate = useNavigate();
  const pricing = usePricingConfig();

  // Enter (o botón "Ver todos") => lleva a la tienda filtrada por el término, con
  // TODOS los resultados y paginación. La tienda lee el ?q= y arma la búsqueda.
  const goToStore = () => {
    const term = searchTerm.trim();
    if (term.length < 2) return;
    navigate(`/tienda?q=${encodeURIComponent(term)}`);
    closeSheet();
  };

  useEffect(() => {
    const term = searchTerm.trim();
    if (term.length < 2) {
      setSearchResults([]);
      setStatus('idle');
      return;
    }
    setStatus('searching');
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const products = await searchProducts(term);
        if (cancelled) return;
        setSearchResults(products);
        setStatus(products.length > 0 ? 'results' : 'empty');
      } catch {
        if (cancelled) return;
        setSearchResults([]);
        setStatus('empty');
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [searchTerm]);

  return (
    <>
      <div className="sticky top-0 z-10 flex items-center gap-4 sm:gap-6 py-4 border-b border-slate-200 px-4 sm:px-7 bg-white">
        <form
          className="flex items-center flex-1 min-w-0 gap-3"
          onSubmit={e => {
            e.preventDefault();
            goToStore();
          }}
        >
          <HiOutlineSearch size={22} className="shrink-0" />
          <input
            type="text"
            placeholder="¿Qué busca? (Enter para ver todos)"
            className="w-full min-w-0 text-sm outline-none bg-transparent"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            autoFocus
          />
        </form>
        <button onClick={closeSheet} className="shrink-0" aria-label="Cerrar">
          <IoMdClose size={25} className="text-black" />
        </button>
      </div>

      <div className="p-4 sm:p-5 flex-1">
        {status === 'idle' && (
          <p className="text-sm text-gray-600">Escriba para buscar</p>
        )}
        {status === 'searching' && (
          <p className="text-sm text-gray-500">Buscando…</p>
        )}
        {status === 'empty' && (
          <p className="text-sm text-gray-600">No se encontraron resultados</p>
        )}
        {status === 'results' && (
          <ul>
            {searchResults.map(product => {
              const variants = (product as any).variants ?? [];
              const minCost = variants.length
                ? Math.min(...variants.map((v: any) => Number(v.price) || 0))
                : Number((product as any).price) || 0;
              const displayPrice = salePrice(minCost, pricing);
              return (
                <li className="py-2 group" key={(product as any).id}>
                  <button
                    className="flex items-center gap-3 w-full text-left"
                    onClick={() => {
                      navigate(`/producto/${(product as any).slug}`);
                      closeSheet();
                    }}
                  >
                    <img
                      src={(product as any).images?.[0] ?? ''}
                      alt={(product as any).name ?? ''}
                      className="object-contain w-16 h-16 sm:w-20 sm:h-20 p-2 sm:p-3 shrink-0"
                    />
                    <div className="flex flex-col gap-1 min-w-0">
                      <p className="text-sm font-semibold group-hover:underline truncate">
                        {(product as any).name}
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
        )}

        {searchTerm.trim().length >= 2 && status !== 'searching' && (
          <button
            onClick={goToStore}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-ink-800"
          >
            <HiOutlineSearch size={18} />
            Ver todos los resultados de "{searchTerm.trim()}"
          </button>
        )}
      </div>
    </>
  );
};
