import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
	HiOutlineMagnifyingGlass,
	HiOutlinePlus,
	HiOutlineTrash,
	HiChevronDown,
	HiChevronUp,
	HiOutlineExclamationTriangle,
} from 'react-icons/hi2';
import {
	addExtra,
	deleteExtra,
	getCategoryExtras,
	getExtrasCountByCategory,
	getProductExtras,
	reorderExtras,
	updateExtra,
	type CheckoutExtraRule,
	type ExtraOwnerType,
} from '../../actions/checkoutExtras';
import { getCategories, searchProducts } from '../../actions';

/** Cuántos extras se muestran en el checkout. Igual que el default de la RPC. */
const EXTRAS_EN_CHECKOUT = 4;

type Tab = 'category' | 'product';

export const DashboardExtrasPage = () => {
	const [tab, setTab] = useState<Tab>('category');

	return (
		<div className='flex flex-col gap-5'>
			<div>
				<h1 className='text-2xl font-bold text-ink-900'>Extras del checkout</h1>
				<p className='max-w-2xl text-sm text-ink-500'>
					Los accesorios que se le ofrecen al cliente cuando ya decidió comprar.
					Se muestran hasta {EXTRAS_EN_CHECKOUT} en el checkout y sólo si tienen
					stock real.
				</p>
			</div>

			{/* La regla de herencia, dicha una vez y bien clara. */}
			<div className='flex items-start gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4'>
				<HiOutlineExclamationTriangle
					className='mt-0.5 shrink-0 text-brand-600'
					size={20}
				/>
				<p className='text-sm text-brand-900'>
					<b>El producto le gana a la categoría.</b> Si un producto tiene extras
					propios, se muestran <b>sólo esos</b> y los de su categoría se ignoran
					para ese producto. No se mezclan.
				</p>
			</div>

			<div className='flex gap-1 border-b border-ink-200'>
				{(
					[
						['category', 'Por categoría'],
						['product', 'Por producto'],
					] as [Tab, string][]
				).map(([key, label]) => (
					<button
						key={key}
						onClick={() => setTab(key)}
						className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
							tab === key
								? 'border-brand-600 text-brand-700'
								: 'border-transparent text-ink-500 hover:text-ink-800'
						}`}
					>
						{label}
					</button>
				))}
			</div>

			{tab === 'category' ? <PorCategoria /> : <PorProducto />}
		</div>
	);
};

/* ================================================================== */
/*  POR CATEGORÍA                                                     */
/* ================================================================== */

const PorCategoria = () => {
	const [open, setOpen] = useState<string | null>(null);

	const { data: categories = [] } = useQuery({
		queryKey: ['categories'],
		queryFn: getCategories,
	});
	const { data: counts = {} } = useQuery({
		queryKey: ['checkout-extras-counts'],
		queryFn: getExtrasCountByCategory,
	});

	return (
		<div className='space-y-2'>
			<p className='text-sm text-ink-500'>
				Una regla acá cubre todos los productos de la categoría.
			</p>
			{categories.length === 0 ? (
				<EmptyBox>Todavía no hay categorías cargadas.</EmptyBox>
			) : (
				categories.map(cat => {
					const isOpen = open === cat.id;
					const n = counts[cat.id] ?? 0;
					return (
						<div
							key={cat.id}
							className='overflow-hidden rounded-xl border border-ink-200 bg-white'
						>
							<button
								onClick={() => setOpen(isOpen ? null : cat.id)}
								className='flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-ink-50'
							>
								<span className='flex-1 font-semibold capitalize text-ink-800'>
									{cat.name}
								</span>
								<span
									className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
										n > 0
											? 'bg-emerald-50 text-emerald-700'
											: 'bg-ink-100 text-ink-500'
									}`}
								>
									{n === 0 ? 'sin extras' : `${n} ${n === 1 ? 'extra' : 'extras'}`}
								</span>
								{isOpen ? <HiChevronUp size={18} /> : <HiChevronDown size={18} />}
							</button>
							{isOpen && (
								<div className='border-t border-ink-100 p-4'>
									<ExtrasEditor ownerType='category' ownerId={cat.id} />
								</div>
							)}
						</div>
					);
				})
			)}
		</div>
	);
};

/* ================================================================== */
/*  POR PRODUCTO                                                      */
/* ================================================================== */

const PorProducto = () => {
	const [term, setTerm] = useState('');
	const [selected, setSelected] = useState<{
		id: string;
		name: string;
		categoryName: string | null;
		categoryId: string | null;
	} | null>(null);

	const { data: results = [] } = useQuery({
		queryKey: ['extras-owner-search', term],
		queryFn: () => searchProducts(term),
		enabled: term.trim().length >= 2,
	});

	// Extras de la categoría del producto: es lo que hereda mientras no tenga propios.
	const { data: heredados = [] } = useQuery({
		queryKey: ['checkout-extras', 'category', selected?.categoryId],
		queryFn: () => getCategoryExtras(selected!.categoryId!),
		enabled: !!selected?.categoryId,
	});

	return (
		<div className='space-y-4'>
			<p className='text-sm text-ink-500'>
				Buscá el producto al que le querés poner accesorios propios.
			</p>

			<div className='relative max-w-xl'>
				<HiOutlineMagnifyingGlass
					className='absolute left-3 top-1/2 -translate-y-1/2 text-ink-400'
					size={18}
				/>
				<input
					value={term}
					onChange={e => setTerm(e.target.value)}
					placeholder='Buscar producto…'
					className='w-full rounded-lg border border-ink-200 py-2.5 pl-10 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300'
				/>
			</div>

			{term.trim().length >= 2 && (
				<div className='max-h-64 max-w-xl space-y-1 overflow-auto rounded-lg border border-ink-100 bg-white p-1'>
					{results.length === 0 ? (
						<p className='py-4 text-center text-xs text-ink-400'>Sin resultados.</p>
					) : (
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						results.slice(0, 15).map((p: any) => (
							<button
								key={p.id}
								onClick={() => {
									setSelected({
										id: p.id,
										name: p.name,
										categoryName: p.category?.name ?? null,
										categoryId: p.category?.id ?? p.category_id ?? null,
									});
									setTerm('');
								}}
								className='flex w-full items-center gap-2.5 rounded-md p-2 text-left hover:bg-ink-50'
							>
								<img
									src={p.images?.[0]}
									alt=''
									className='h-9 w-9 shrink-0 rounded object-contain'
								/>
								<span className='flex-1 truncate text-sm text-ink-700'>
									{p.name}
								</span>
							</button>
						))
					)}
				</div>
			)}

			{selected && (
				<div className='rounded-xl border border-ink-200 bg-white'>
					<div className='flex items-center gap-3 border-b border-ink-100 px-4 py-3.5'>
						<div className='min-w-0 flex-1'>
							<p className='truncate font-semibold text-ink-800'>{selected.name}</p>
							{selected.categoryName && (
								<p className='text-xs text-ink-500'>
									Categoría: {selected.categoryName}
								</p>
							)}
						</div>
						<button
							onClick={() => setSelected(null)}
							className='text-xs font-semibold text-ink-500 hover:text-ink-800'
						>
							Cambiar
						</button>
					</div>
					<div className='p-4'>
						<ExtrasEditor
							ownerType='product'
							ownerId={selected.id}
							inheritedCount={heredados.length}
							categoryName={selected.categoryName}
						/>
					</div>
				</div>
			)}
		</div>
	);
};

/* ================================================================== */
/*  EDITOR (compartido por los dos modos)                             */
/* ================================================================== */

const ExtrasEditor = ({
	ownerType,
	ownerId,
	inheritedCount,
	categoryName,
}: {
	ownerType: ExtraOwnerType;
	ownerId: string;
	/** Sólo en modo producto: cuántos extras heredaría de su categoría. */
	inheritedCount?: number;
	categoryName?: string | null;
}) => {
	const qc = useQueryClient();
	const [term, setTerm] = useState('');

	const { data: extras = [], isLoading } = useQuery({
		queryKey: ['checkout-extras', ownerType, ownerId],
		queryFn: () =>
			ownerType === 'category' ? getCategoryExtras(ownerId) : getProductExtras(ownerId),
	});

	const { data: results = [] } = useQuery({
		queryKey: ['extras-search', term],
		queryFn: () => searchProducts(term),
		enabled: term.trim().length >= 2,
	});

	const refresh = () => {
		qc.invalidateQueries({ queryKey: ['checkout-extras', ownerType, ownerId] });
		qc.invalidateQueries({ queryKey: ['checkout-extras-counts'] });
	};
	const onErr = (e: Error) => toast.error(e.message);

	const mAdd = useMutation({
		mutationFn: (extraProductId: string) =>
			addExtra({ ownerType, ownerId, extraProductId, position: extras.length }),
		onSuccess: () => {
			setTerm('');
			refresh();
		},
		onError: onErr,
	});
	const mDel = useMutation({
		mutationFn: deleteExtra,
		onSuccess: refresh,
		onError: onErr,
	});
	const mNote = useMutation({
		mutationFn: ({ id, note }: { id: string; note: string }) =>
			updateExtra(id, { note: note.trim() || null }),
		onSuccess: refresh,
		onError: onErr,
	});
	const mOrder = useMutation({
		mutationFn: reorderExtras,
		onSuccess: refresh,
		onError: onErr,
	});

	const move = (index: number, dir: -1 | 1) => {
		const next = extras.map(e => e.id);
		const j = index + dir;
		if (j < 0 || j >= next.length) return;
		[next[index], next[j]] = [next[j], next[index]];
		mOrder.mutate(next);
	};

	const yaEstan = new Set(extras.map(e => e.extra_product_id));

	return (
		<div className='space-y-3'>
			{/* Estado de la herencia, en modo producto */}
			{ownerType === 'product' && (
				<div
					className={`rounded-lg border px-3 py-2.5 text-sm ${
						extras.length > 0
							? 'border-amber-200 bg-amber-50 text-amber-900'
							: 'border-ink-200 bg-ink-50 text-ink-600'
					}`}
				>
					{extras.length > 0 ? (
						<>
							Estos <b>{extras.length}</b>{' '}
							{extras.length === 1 ? 'extra reemplaza' : 'extras reemplazan'} a los
							de {categoryName ? <b>{categoryName}</b> : 'su categoría'}.
						</>
					) : inheritedCount && inheritedCount > 0 ? (
						<>
							Hereda <b>{inheritedCount}</b>{' '}
							{inheritedCount === 1 ? 'extra' : 'extras'} de{' '}
							{categoryName ? <b>{categoryName}</b> : 'su categoría'}. Si cargás
							uno acá, esos dejan de aplicar para este producto.
						</>
					) : (
						<>
							Su categoría tampoco tiene extras: hoy este producto no ofrece nada
							en el checkout.
						</>
					)}
				</div>
			)}

			{/* Lista cargada */}
			{isLoading ? (
				<p className='py-3 text-sm text-ink-400'>Cargando…</p>
			) : extras.length === 0 ? (
				<EmptyBox>Todavía no hay accesorios cargados.</EmptyBox>
			) : (
				<ul className='space-y-1.5'>
					{extras.map((e, i) => (
						<ExtraRow
							key={e.id}
							extra={e}
							index={i}
							total={extras.length}
							visible={i < EXTRAS_EN_CHECKOUT}
							onMove={move}
							onDelete={() => mDel.mutate(e.id)}
							onNote={note => mNote.mutate({ id: e.id, note })}
						/>
					))}
				</ul>
			)}

			{extras.length > EXTRAS_EN_CHECKOUT && (
				<p className='text-xs text-ink-500'>
					En el checkout se muestran los primeros {EXTRAS_EN_CHECKOUT}. Los de
					abajo entran sólo si alguno de arriba se queda sin stock.
				</p>
			)}

			{/* Buscador para agregar */}
			<div className='relative'>
				<HiOutlineMagnifyingGlass
					className='absolute left-3 top-1/2 -translate-y-1/2 text-ink-400'
					size={16}
				/>
				<input
					value={term}
					onChange={e => setTerm(e.target.value)}
					placeholder='Buscar accesorio para agregar…'
					className='w-full rounded-lg border border-ink-200 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300'
				/>
			</div>

			{term.trim().length >= 2 && (
				<div className='max-h-56 space-y-1 overflow-auto rounded-lg border border-ink-100 p-1'>
					{results.length === 0 ? (
						<p className='py-3 text-center text-xs text-ink-400'>Sin resultados.</p>
					) : (
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						results.slice(0, 12).map((p: any) => {
							const puedeOnline = p.source === 'cdr' || p.online_payment === true;
							const yaEsta = yaEstan.has(p.id);
							const esElMismo = ownerType === 'product' && p.id === ownerId;
							const bloqueado = yaEsta || esElMismo || !puedeOnline;
							return (
								<button
									key={p.id}
									onClick={() => mAdd.mutate(p.id)}
									disabled={bloqueado}
									title={
										esElMismo
											? 'Un producto no puede ser extra de sí mismo'
											: !puedeOnline
											? 'Este producto es "por consulta": no se puede sumar al checkout online'
											: yaEsta
											? 'Ya está en la lista'
											: undefined
									}
									className='flex w-full items-center gap-2 rounded-md p-1.5 text-left hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-40'
								>
									<img
										src={p.images?.[0]}
										alt=''
										className='h-8 w-8 shrink-0 rounded object-contain'
									/>
									<span className='flex-1 truncate text-xs text-ink-700'>
										{p.name}
									</span>
									{!puedeOnline && (
										<span className='shrink-0 text-[10px] font-semibold uppercase text-amber-600'>
											por consulta
										</span>
									)}
									<HiOutlinePlus className='shrink-0 text-brand-600' size={16} />
								</button>
							);
						})
					)}
				</div>
			)}
		</div>
	);
};

const ExtraRow = ({
	extra,
	index,
	total,
	visible,
	onMove,
	onDelete,
	onNote,
}: {
	extra: CheckoutExtraRule;
	index: number;
	total: number;
	visible: boolean;
	onMove: (index: number, dir: -1 | 1) => void;
	onDelete: () => void;
	onNote: (note: string) => void;
}) => {
	const [note, setNote] = useState(extra.note ?? '');
	const p = extra.product;
	// Un accesorio inactivo o "por consulta" no se va a ofrecer nunca: se avisa
	// acá en vez de dejar al admin creyendo que la regla funciona.
	const inservible =
		!p || p.active === false || !(p.source === 'cdr' || p.online_payment === true);

	return (
		<li className='flex items-center gap-2.5 rounded-lg border border-ink-100 bg-white p-2'>
			<div className='flex shrink-0 flex-col'>
				<button
					onClick={() => onMove(index, -1)}
					disabled={index === 0}
					className='text-ink-400 hover:text-ink-800 disabled:opacity-25'
					aria-label='Subir'
				>
					<HiChevronUp size={14} />
				</button>
				<button
					onClick={() => onMove(index, 1)}
					disabled={index === total - 1}
					className='text-ink-400 hover:text-ink-800 disabled:opacity-25'
					aria-label='Bajar'
				>
					<HiChevronDown size={14} />
				</button>
			</div>

			<img
				src={p?.images?.[0] ?? ''}
				alt=''
				className='h-10 w-10 shrink-0 rounded object-contain'
			/>

			<div className='min-w-0 flex-1'>
				<p className='truncate text-sm font-medium text-ink-800'>
					{p?.name ?? 'Producto borrado'}
					{!visible && (
						<span className='ml-2 text-[10px] font-semibold uppercase text-ink-400'>
							suplente
						</span>
					)}
				</p>
				{inservible ? (
					<p className='text-[11px] font-semibold text-rose-600'>
						No se puede ofrecer: el producto está inactivo o es por consulta.
					</p>
				) : (
					<input
						value={note}
						onChange={e => setNote(e.target.value)}
						onBlur={() => note !== (extra.note ?? '') && onNote(note)}
						placeholder='Nota corta (opcional): "Se entrega junto con tu notebook"'
						className='w-full border-0 p-0 text-[11px] text-ink-500 placeholder:text-ink-300 focus:outline-none'
					/>
				)}
			</div>

			<button
				onClick={onDelete}
				className='shrink-0 rounded-md p-1.5 text-ink-400 transition-colors hover:bg-rose-50 hover:text-rose-600'
				aria-label='Quitar'
			>
				<HiOutlineTrash size={16} />
			</button>
		</li>
	);
};

const EmptyBox = ({ children }: { children: React.ReactNode }) => (
	<div className='rounded-lg border border-dashed border-ink-200 bg-ink-50/50 px-4 py-6 text-center text-sm text-ink-400'>
		{children}
	</div>
);
