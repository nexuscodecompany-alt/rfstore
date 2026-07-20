import { useEffect, useRef, useState } from 'react';
import { HiOutlineSearch } from 'react-icons/hi';
import { IoMdClose } from 'react-icons/io';
import { Link, useNavigate } from 'react-router-dom';
import { searchProducts } from '../../actions';
import { formatPrice, salePrice } from '../../helpers';
import { usePricingConfig, useTaxonomies } from '../../hooks';

const norm = (s: string) =>
	s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();

type SearchResult = Awaited<ReturnType<typeof searchProducts>>;

/**
 * Buscador grande, centrado y siempre visible en el header.
 * Enter (o "Ver todos") lleva a la tienda con ?q=. Muestra sugerencias en vivo.
 */
export const HeaderSearch = () => {
	const [term, setTerm] = useState('');
	const [results, setResults] = useState<SearchResult>([]);
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const boxRef = useRef<HTMLDivElement | null>(null);
	const navigate = useNavigate();
	const pricing = usePricingConfig();
	const { categories } = useTaxonomies();

	// Detección de categoría: si el término coincide con el nombre de una categoría
	// (ej: "celulares"), ofrecemos ir directo a esa categoría.
	const t = norm(term);
	const matchedCat =
		t.length >= 2
			? categories.find(c => {
					const n = norm(c.name);
					return n.length >= 3 && (n.includes(t) || t.includes(n));
			  })
			: undefined;

	const goToStore = () => {
		if (matchedCat) {
			navigate(`/tienda?category=${matchedCat.id}`);
			setOpen(false);
			return;
		}
		const q = term.trim();
		if (q.length < 2) return;
		navigate(`/tienda?q=${encodeURIComponent(q)}`);
		setOpen(false);
	};

	useEffect(() => {
		const q = term.trim();
		if (q.length < 2) {
			setResults([]);
			setLoading(false);
			return;
		}
		setLoading(true);
		let cancelled = false;
		const t = setTimeout(async () => {
			try {
				const products = await searchProducts(q);
				if (cancelled) return;
				setResults(products.slice(0, 6));
			} catch {
				if (!cancelled) setResults([]);
			} finally {
				if (!cancelled) setLoading(false);
			}
		}, 300);
		return () => {
			cancelled = true;
			clearTimeout(t);
		};
	}, [term]);

	// Cerrar el panel al hacer click afuera.
	useEffect(() => {
		const onClick = (e: MouseEvent) => {
			if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
				setOpen(false);
			}
		};
		document.addEventListener('mousedown', onClick);
		return () => document.removeEventListener('mousedown', onClick);
	}, []);

	const showPanel = open && term.trim().length >= 2;

	return (
		<div ref={boxRef} className='relative w-full max-w-2xl'>
			<form
				onSubmit={e => {
					e.preventDefault();
					goToStore();
				}}
				className='relative'
			>
				<HiOutlineSearch
					className='absolute left-4 top-1/2 -translate-y-1/2 text-white/50'
					size={20}
				/>
				<input
					type='text'
					value={term}
					onChange={e => {
						setTerm(e.target.value);
						setOpen(true);
					}}
					onFocus={() => setOpen(true)}
					placeholder='¿Qué producto estás buscando?'
					className='w-full rounded-full border border-white/15 bg-white/10 py-2.5 pl-12 pr-24 text-sm text-white placeholder:text-white/50 focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-500/25 transition-all'
					aria-label='Buscar productos'
				/>
				{term && (
					<button
						type='button'
						onClick={() => {
							setTerm('');
							setResults([]);
						}}
						className='absolute right-[92px] top-1/2 -translate-y-1/2 text-white/50 hover:text-white'
						aria-label='Limpiar'
					>
						<IoMdClose size={18} />
					</button>
				)}
				<button
					type='submit'
					className='absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-brand-900 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-brand-800'
				>
					Buscar
				</button>
			</form>

			{showPanel && (
				<div className='absolute left-0 right-0 top-12 z-50 overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-2xl animate-fade-in'>
					{matchedCat && (
						<Link
							to={`/tienda?category=${matchedCat.id}`}
							onClick={() => setOpen(false)}
							className='flex items-center gap-2 border-b border-ink-100 bg-brand-50/50 px-4 py-2.5 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50'
						>
							<HiOutlineSearch size={16} />
							Ver categoría "{matchedCat.name}"
						</Link>
					)}
					{loading && results.length === 0 ? (
						<p className='px-4 py-6 text-center text-sm text-ink-400'>Buscando…</p>
					) : results.length === 0 ? (
						<p className='px-4 py-6 text-center text-sm text-ink-400'>
							Sin resultados para "{term.trim()}"
						</p>
					) : (
						<ul className='max-h-[60vh] overflow-auto py-1'>
							{results.map(product => {
								const variants = (product as any).variants ?? [];
								const minCost = variants.length
									? Math.min(...variants.map((v: any) => Number(v.price) || 0))
									: Number((product as any).price) || 0;
								const displayPrice = salePrice(minCost, pricing);
								return (
									<li key={(product as any).id}>
										<button
											onClick={() => {
												navigate(`/producto/${(product as any).slug}`);
												setOpen(false);
											}}
											className='flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-brand-50/60 transition-colors'
										>
											<img
												src={(product as any).images?.[0] ?? ''}
												alt=''
												className='h-12 w-12 shrink-0 rounded-lg object-contain p-1'
											/>
											<div className='min-w-0 flex-1'>
												<p className='truncate text-sm font-medium text-ink-800'>
													{(product as any).name}
												</p>
												<p className='text-xs font-semibold text-brand-700'>
													{formatPrice(displayPrice)}{' '}
													<span className='font-normal text-ink-400'>IVA inc.</span>
												</p>
											</div>
										</button>
									</li>
								);
							})}
						</ul>
					)}
					<button
						onClick={goToStore}
						className='flex w-full items-center justify-center gap-2 border-t border-ink-100 bg-ink-50/60 px-4 py-2.5 text-xs font-semibold text-brand-700 hover:bg-ink-100 transition-colors'
					>
						<HiOutlineSearch size={16} />
						Ver todos los resultados
					</button>
				</div>
			)}
		</div>
	);
};
