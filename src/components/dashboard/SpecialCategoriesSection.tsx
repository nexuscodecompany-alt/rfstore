import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
	HiOutlineMagnifyingGlass,
	HiOutlinePlus,
	HiOutlineTrash,
	HiOutlineArrowUp,
	HiOutlineArrowDown,
	HiOutlineChevronDown,
	HiOutlinePencil,
	HiOutlineCheck,
	HiOutlineXMark,
	HiOutlineLink,
	HiOutlineSparkles,
} from 'react-icons/hi2';
import { searchProducts } from '../../actions';
import { getSpecialCategoryProducts, type SpecialCategory } from '../../actions/specialCategories';
import {
	useSpecialCategoriesAdmin,
	useSpecialCategoryMutations,
	useSpecialCategoryProductIds,
} from '../../hooks';

/* ------------------------------------------------------------------ */
/*  Selector de productos de una categoría especial.                   */
/*  Guarda al instante (igual que la vitrina de la home): no hay botón  */
/*  "guardar" que el admin pueda olvidar.                              */
/* ------------------------------------------------------------------ */
const SpecialProductPicker = ({ specialId }: { specialId: string }) => {
	const [term, setTerm] = useState('');
	const { productIds } = useSpecialCategoryProductIds(specialId);
	const { setProducts } = useSpecialCategoryMutations();

	// Sin filtrar por activo/stock a propósito: si un producto queda sin stock
	// momentáneamente tiene que seguir visible acá, o el admin lo perdería sin
	// darse cuenta al guardar la lista.
	const { data: products = [] } = useQuery({
		queryKey: ['special-category-products-full', specialId, productIds],
		queryFn: () => getSpecialCategoryProducts(specialId),
		enabled: productIds.length > 0,
	});

	const { data: results = [] } = useQuery({
		queryKey: ['special-product-search', term],
		queryFn: () => searchProducts(term),
		enabled: term.trim().length >= 2,
	});

	const save = (next: string[]) => setProducts.mutate({ id: specialId, productIds: next });

	const add = (id: string) => {
		if (productIds.includes(id)) return;
		save([...productIds, id]);
		setTerm('');
	};
	const remove = (id: string) => save(productIds.filter(x => x !== id));
	const move = (idx: number, dir: -1 | 1) => {
		const next = [...productIds];
		const j = idx + dir;
		if (j < 0 || j >= next.length) return;
		[next[idx], next[j]] = [next[j], next[idx]];
		save(next);
	};

	return (
		<div className='space-y-3'>
			<div className='relative'>
				<HiOutlineMagnifyingGlass
					className='absolute left-3 top-1/2 -translate-y-1/2 text-ink-400'
					size={18}
				/>
				<input
					value={term}
					onChange={e => setTerm(e.target.value)}
					placeholder='Buscar producto para agregar…'
					className='w-full rounded-lg border border-ink-200 py-2 pl-10 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300'
				/>
			</div>

			{term.trim().length >= 2 && (
				<div className='max-h-52 space-y-1 overflow-auto rounded-lg border border-ink-100 p-1'>
					{results.length === 0 ? (
						<p className='py-3 text-center text-xs text-ink-400'>Sin resultados.</p>
					) : (
						results.slice(0, 12).map((p: any) => (
							<button
								key={p.id}
								onClick={() => add(p.id)}
								disabled={productIds.includes(p.id)}
								className='flex w-full items-center gap-2 rounded-md p-1.5 text-left hover:bg-ink-50 disabled:opacity-40'
							>
								<img src={p.images?.[0]} alt='' className='h-8 w-8 rounded object-contain' />
								<span className='flex-1 truncate text-xs text-ink-700'>{p.name}</span>
								<HiOutlinePlus className='text-brand-600' size={16} />
							</button>
						))
					)}
				</div>
			)}

			<ul className='space-y-1.5'>
				{products.map((p: any, idx: number) => (
					<li
						key={p.id}
						className='flex items-center gap-2 rounded-lg border border-ink-100 p-1.5'
					>
						<img src={p.images?.[0]} alt='' className='h-9 w-9 shrink-0 rounded object-contain' />
						<span className='flex-1 truncate text-xs text-ink-700'>{p.name}</span>
						<div className='flex items-center gap-0.5'>
							<button
								onClick={() => move(idx, -1)}
								disabled={idx === 0}
								className='grid h-7 w-7 place-items-center rounded-md text-ink-400 hover:bg-ink-100 disabled:opacity-30'
							>
								<HiOutlineArrowUp size={14} />
							</button>
							<button
								onClick={() => move(idx, 1)}
								disabled={idx === products.length - 1}
								className='grid h-7 w-7 place-items-center rounded-md text-ink-400 hover:bg-ink-100 disabled:opacity-30'
							>
								<HiOutlineArrowDown size={14} />
							</button>
							<button
								onClick={() => remove(p.id)}
								className='grid h-7 w-7 place-items-center rounded-md text-ink-400 hover:bg-rose-50 hover:text-rose-600'
								title='Quitar de la campaña'
							>
								<HiOutlineTrash size={14} />
							</button>
						</div>
					</li>
				))}
				{productIds.length === 0 && (
					<li className='py-6 text-center text-xs text-ink-400'>
						Todavía no agregaste productos a esta campaña.
					</li>
				)}
			</ul>
		</div>
	);
};

/* ------------------------------------------------------------------ */
/*  Fila de una categoría especial (nombre, on/off, link, borrar).     */
/* ------------------------------------------------------------------ */
const SpecialRow = ({
	cat,
	open,
	onToggleOpen,
}: {
	cat: SpecialCategory;
	open: boolean;
	onToggleOpen: () => void;
}) => {
	const { update, remove } = useSpecialCategoryMutations();
	const { productIds } = useSpecialCategoryProductIds(cat.id);
	const [editing, setEditing] = useState(false);
	const [value, setValue] = useState(cat.name);

	const shopUrl = `${window.location.origin}/tienda?special=${cat.slug}`;

	const saveName = () => {
		const v = value.trim();
		if (v && v !== cat.name) update.mutate({ id: cat.id, name: v });
		setEditing(false);
	};

	const copyLink = async () => {
		try {
			await navigator.clipboard.writeText(shopUrl);
			toast.success('Link copiado', { position: 'bottom-right' });
		} catch {
			toast.error('No se pudo copiar', { position: 'bottom-right' });
		}
	};

	return (
		<div className='rounded-xl border border-amber-200 bg-amber-50/40'>
			<div className='flex flex-wrap items-center gap-2 px-3 py-2.5'>
				<button
					onClick={onToggleOpen}
					className='grid h-7 w-7 shrink-0 place-items-center rounded-md text-ink-400 hover:bg-amber-100'
				>
					<HiOutlineChevronDown
						size={16}
						className={`transition-transform ${open ? 'rotate-180' : ''}`}
					/>
				</button>

				{editing ? (
					<div className='flex flex-1 items-center gap-1.5'>
						<input
							autoFocus
							value={value}
							onChange={e => setValue(e.target.value)}
							onKeyDown={e => e.key === 'Enter' && saveName()}
							className='flex-1 rounded-md border border-brand-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300'
						/>
						<button
							onClick={saveName}
							className='grid h-7 w-7 place-items-center rounded-md text-emerald-600 hover:bg-emerald-50'
						>
							<HiOutlineCheck size={16} />
						</button>
						<button
							onClick={() => {
								setValue(cat.name);
								setEditing(false);
							}}
							className='grid h-7 w-7 place-items-center rounded-md text-ink-400 hover:bg-ink-100'
						>
							<HiOutlineXMark size={16} />
						</button>
					</div>
				) : (
					<>
						<span className='flex items-center gap-1.5 text-sm font-semibold text-ink-800'>
							<HiOutlineSparkles className='text-amber-500' size={16} />
							{cat.name}
						</span>
						<span className='rounded-full bg-white px-2 py-0.5 text-xs text-ink-500'>
							{productIds.length} producto{productIds.length !== 1 ? 's' : ''}
						</span>
						<div className='ml-auto flex items-center gap-1'>
							{/* Encendida = visible en la tienda. Apagarla la esconde sin borrar nada. */}
							<label className='mr-1 inline-flex cursor-pointer items-center gap-1.5 text-xs text-ink-600'>
								<input
									type='checkbox'
									checked={cat.active}
									onChange={e => update.mutate({ id: cat.id, active: e.target.checked })}
									className='h-4 w-4 accent-brand-600'
								/>
								Visible
							</label>
							<button
								onClick={copyLink}
								className='grid h-7 w-7 place-items-center rounded-md text-ink-400 hover:bg-white hover:text-brand-600'
								title={shopUrl}
							>
								<HiOutlineLink size={14} />
							</button>
							<button
								onClick={() => setEditing(true)}
								className='grid h-7 w-7 place-items-center rounded-md text-ink-400 hover:bg-white hover:text-brand-600'
								title='Renombrar'
							>
								<HiOutlinePencil size={14} />
							</button>
							<button
								onClick={() => {
									if (
										window.confirm(
											`¿Eliminar la campaña "${cat.name}"?\n\nLos productos NO se borran ni pierden su categoría: sólo dejan de aparecer en esta campaña.`
										)
									)
										remove.mutate(cat.id);
								}}
								className='grid h-7 w-7 place-items-center rounded-md text-ink-400 hover:bg-rose-50 hover:text-rose-600'
								title='Eliminar campaña'
							>
								<HiOutlineTrash size={14} />
							</button>
						</div>
					</>
				)}
			</div>

			{open && (
				<div className='border-t border-amber-200/70 px-4 py-3'>
					<p className='mb-3 break-all text-xs text-ink-500'>
						Link para publicidad / WhatsApp:{' '}
						<span className='font-medium text-brand-700'>{shopUrl}</span>
					</p>
					<SpecialProductPicker specialId={cat.id} />
				</div>
			)}
		</div>
	);
};

/* ------------------------------------------------------------------ */
/*  Bloque completo (listado). La creación vive en el input de         */
/*  "Nueva categoría" con el check "Especial".                         */
/* ------------------------------------------------------------------ */
export const SpecialCategoriesSection = () => {
	const { specialCategories, isLoading } = useSpecialCategoriesAdmin();
	const [openId, setOpenId] = useState<string | null>(null);

	return (
		<div className='rounded-2xl border border-amber-200/70 bg-white p-5 shadow-soft'>
			<div className='mb-1 flex items-center gap-2'>
				<HiOutlineSparkles className='text-amber-500' size={20} />
				<h2 className='font-bold text-ink-900'>Categorías especiales (campañas)</h2>
			</div>
			<p className='mb-4 text-xs text-ink-500'>
				Van <strong>por encima</strong> de las categorías normales: un producto entra a la
				campaña sin perder su categoría real. Al eliminar la campaña, los productos quedan
				exactamente como estaban.
			</p>

			{isLoading ? (
				<p className='py-4 text-center text-sm text-ink-400'>Cargando…</p>
			) : specialCategories.length === 0 ? (
				<p className='rounded-xl border border-dashed border-ink-200 py-6 text-center text-sm text-ink-400'>
					No hay campañas. Creá una arriba marcando <strong>“Especial”</strong> al agregar
					una categoría (ej: “Día del Niño”).
				</p>
			) : (
				<div className='space-y-2'>
					{specialCategories.map(cat => (
						<SpecialRow
							key={cat.id}
							cat={cat}
							open={openId === cat.id}
							onToggleOpen={() => setOpenId(openId === cat.id ? null : cat.id)}
						/>
					))}
				</div>
			)}
		</div>
	);
};
