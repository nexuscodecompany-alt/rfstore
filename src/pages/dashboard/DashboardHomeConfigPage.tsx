import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
	HiOutlinePlus,
	HiOutlineTrash,
	HiOutlineArrowUp,
	HiOutlineArrowDown,
	HiOutlinePhoto,
	HiOutlineMagnifyingGlass,
	HiOutlinePencilSquare,
	HiOutlineChevronUp,
} from 'react-icons/hi2';
import {
	uploadHomeImage,
	searchProducts,
	getProductsByIds,
	getHomeSectionIds,
	updateHomeSectionIds,
	type HomeSectionKey,
	type HomeSlide,
	type HomeCategoryTile,
	type HomeBanner3D,
	type HomeBlock,
	type HomeBlockType,
	type ProductSource,
} from '../../actions';
import { reorderSubcategories } from '../../actions/taxonomy';
import { useHomeConfig, useUpdateHomeConfig, useTaxonomies } from '../../hooks';

/* ------------------------------------------------------------------ */
/*  UI helpers                                                         */
/* ------------------------------------------------------------------ */

const cardClass =
	'rounded-2xl border border-ink-200/70 bg-white p-5 shadow-soft';
const inputClass =
	'w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300';
const primaryBtn =
	'inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50';
const ghostBtn =
	'inline-flex items-center gap-2 rounded-lg border border-ink-200 px-3 py-2 text-sm font-medium text-ink-700 transition hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-40';
const iconBtnClass =
	'grid h-8 w-8 place-items-center rounded-md text-ink-400 hover:bg-ink-100 disabled:opacity-30';

const Spinner = () => (
	<span className='inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white' />
);

const MoveButtons = ({
	idx,
	total,
	onMove,
}: {
	idx: number;
	total: number;
	onMove: (idx: number, dir: -1 | 1) => void;
}) => (
	<>
		<button
			type='button'
			onClick={() => onMove(idx, -1)}
			disabled={idx === 0}
			className={iconBtnClass}
			title='Subir'
		>
			<HiOutlineArrowUp size={16} />
		</button>
		<button
			type='button'
			onClick={() => onMove(idx, 1)}
			disabled={idx === total - 1}
			className={iconBtnClass}
			title='Bajar'
		>
			<HiOutlineArrowDown size={16} />
		</button>
	</>
);

/* Etiquetas amigables por tipo de bloque. */
const BLOCK_LABELS: Record<HomeBlockType, string> = {
	hero: 'Carrusel principal',
	features: 'Cards de confianza',
	categories: 'Explorá categorías',
	banner3d: 'Banner Impresión 3D',
	brands: 'Marcas',
	business: 'Empresas',
	products: 'Sección de productos',
};

/* ================================================================== */
/*  Barra de categorías destacadas (header, no parte del layout)      */
/* ================================================================== */

const NavFeaturedBlock = ({
	initial,
	categories,
	subcategories,
	onSave,
	onReorderSubs,
	reorderingSubs,
	saving,
}: {
	initial: string[];
	categories: { id: string; name: string }[];
	subcategories: { id: string; name: string; category_id: string }[];
	onSave: (ids: string[]) => void;
	onReorderSubs: (orderedIds: string[]) => void;
	reorderingSubs: boolean;
	saving: boolean;
}) => {
	const [ids, setIds] = useState<string[]>(initial);
	const [toAdd, setToAdd] = useState('');
	// Categoría desplegada para ver/ordenar sus subcategorías.
	const [openCatId, setOpenCatId] = useState<string | null>(null);

	useEffect(() => setIds(initial), [initial]);

	// subcategories ya viene ordenado por sort_order desde el server, así que sólo
	// filtramos por categoría y respetamos ese orden.
	const subsOf = (catId: string) =>
		subcategories.filter(s => s.category_id === catId);

	// El orden de subcategorías es GLOBAL (columna subcategories.sort_order), no parte
	// de home_config: se guarda solo al tocar la flecha y es el mismo que usa el menú
	// del navbar y la página de Taxonomías.
	const moveSub = (catId: string, idx: number, dir: -1 | 1) => {
		const subs = subsOf(catId);
		const j = idx + dir;
		if (j < 0 || j >= subs.length) return;
		const next = [...subs];
		[next[idx], next[j]] = [next[j], next[idx]];
		onReorderSubs(next.map(s => s.id));
	};

	const nameOf = (id: string) =>
		categories.find(c => c.id === id)?.name ?? '(categoría eliminada)';
	const available = categories.filter(c => !ids.includes(c.id));

	const add = () => {
		if (!toAdd || ids.includes(toAdd)) return;
		setIds([...ids, toAdd]);
		setToAdd('');
	};
	const remove = (id: string) => setIds(ids.filter(x => x !== id));
	const move = (idx: number, dir: -1 | 1) => {
		const next = [...ids];
		const j = idx + dir;
		if (j < 0 || j >= next.length) return;
		[next[idx], next[j]] = [next[j], next[idx]];
		setIds(next);
	};

	return (
		<section className={cardClass}>
			<h2 className='font-bold text-ink-900'>Barra de categorías destacadas</h2>
			<p className='mb-4 text-xs text-ink-500'>
				Categorías que aparecen en la barra de navegación, en orden.
			</p>

			<div className='flex gap-2'>
				<select
					value={toAdd}
					onChange={e => setToAdd(e.target.value)}
					className={inputClass}
				>
					<option value=''>Elegí una categoría…</option>
					{available.map(c => (
						<option key={c.id} value={c.id}>
							{c.name}
						</option>
					))}
				</select>
				<button
					type='button'
					onClick={add}
					disabled={!toAdd}
					className={ghostBtn}
				>
					<HiOutlinePlus size={18} />
					Agregar
				</button>
			</div>

			<ul className='mt-4 space-y-1.5'>
				{ids.map((id, idx) => {
					const subs = subsOf(id);
					const open = openCatId === id;
					return (
						<li key={id} className='rounded-lg border border-ink-100'>
							<div className='flex items-center gap-2 p-2'>
								<button
									type='button'
									onClick={() => setOpenCatId(open ? null : id)}
									className={iconBtnClass}
									title={open ? 'Ocultar subcategorías' : 'Ver subcategorías'}
								>
									<HiOutlineChevronUp
										size={16}
										className={`transition-transform ${open ? '' : 'rotate-180'}`}
									/>
								</button>
								<span className='flex-1 truncate text-sm text-ink-700'>
									{nameOf(id)}
									<span className='ml-2 text-xs text-ink-400'>
										{subs.length === 0
											? 'sin subcategorías'
											: `${subs.length} subcategoría${subs.length === 1 ? '' : 's'}`}
									</span>
								</span>
								<div className='flex items-center gap-0.5'>
									<MoveButtons idx={idx} total={ids.length} onMove={move} />
									<button
										type='button'
										onClick={() => remove(id)}
										className='grid h-8 w-8 place-items-center rounded-md text-ink-400 hover:bg-rose-50 hover:text-rose-600'
										title='Quitar'
									>
										<HiOutlineTrash size={16} />
									</button>
								</div>
							</div>

							{open && (
								<div className='border-t border-ink-100 bg-ink-50/50 px-2 py-2 pl-11'>
									{subs.length === 0 ? (
										<p className='py-2 text-xs text-ink-400'>
											Esta categoría no tiene subcategorías.
										</p>
									) : (
										<>
											<p className='mb-1.5 text-[11px] text-ink-500'>
												Orden en que aparecen dentro del menú. Se guarda solo.
											</p>
											<ul className='space-y-1'>
												{subs.map((s, sIdx) => (
													<li
														key={s.id}
														className='flex items-center gap-2 rounded-md border border-ink-100 bg-white px-2 py-1'
													>
														<span className='flex-1 truncate text-xs text-ink-600'>
															{s.name}
														</span>
														<fieldset
															disabled={reorderingSubs}
															className='flex items-center gap-0.5 border-0 p-0'
														>
															<MoveButtons
																idx={sIdx}
																total={subs.length}
																onMove={(i, dir) => moveSub(id, i, dir)}
															/>
														</fieldset>
													</li>
												))}
											</ul>
										</>
									)}
								</div>
							)}
						</li>
					);
				})}
				{ids.length === 0 && (
					<li className='py-6 text-center text-xs text-ink-400'>
						Sin categorías destacadas.
					</li>
				)}
			</ul>

			<div className='mt-4 flex justify-end'>
				<button
					type='button'
					onClick={() => onSave(ids)}
					disabled={saving}
					className={primaryBtn}
				>
					{saving && <Spinner />}
					Guardar
				</button>
			</div>
		</section>
	);
};

/* ================================================================== */
/*  Editor de contenido: Carrusel del hero (hero_slides)              */
/* ================================================================== */

const HeroSlidesEditor = ({
	initial,
	onSave,
	saving,
}: {
	initial: HomeSlide[];
	onSave: (slides: HomeSlide[]) => void;
	saving: boolean;
}) => {
	const [slides, setSlides] = useState<HomeSlide[]>(initial);
	const [uploading, setUploading] = useState(false);

	useEffect(() => setSlides(initial), [initial]);

	const addSlide = async (file: File) => {
		setUploading(true);
		try {
			const url = await uploadHomeImage(file);
			setSlides(prev => [
				...prev,
				{ id: crypto.randomUUID(), image: url, link: '', alt: '' },
			]);
		} catch (e) {
			console.error('uploadHomeImage:', e);
		} finally {
			setUploading(false);
		}
	};

	const patch = (idx: number, p: Partial<HomeSlide>) =>
		setSlides(prev => prev.map((s, i) => (i === idx ? { ...s, ...p } : s)));
	const remove = (idx: number) =>
		setSlides(prev => prev.filter((_, i) => i !== idx));
	const move = (idx: number, dir: -1 | 1) =>
		setSlides(prev => {
			const next = [...prev];
			const j = idx + dir;
			if (j < 0 || j >= next.length) return prev;
			[next[idx], next[j]] = [next[j], next[idx]];
			return next;
		});

	return (
		<div>
			<label className='inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-ink-300 px-4 py-2 text-sm font-medium text-ink-600 transition hover:bg-ink-50'>
				{uploading ? (
					<span className='inline-block h-4 w-4 animate-spin rounded-full border-2 border-ink-300 border-t-brand-600' />
				) : (
					<HiOutlinePhoto size={18} />
				)}
				{uploading ? 'Subiendo imagen…' : 'Agregar slide (subir imagen)'}
				<input
					type='file'
					accept='image/*'
					className='hidden'
					disabled={uploading}
					onChange={e => {
						const f = e.target.files?.[0];
						if (f) addSlide(f);
						e.target.value = '';
					}}
				/>
			</label>
			<p className='mt-1.5 text-[11px] text-ink-500'>
				Medidas: <strong>1920 × 700 px</strong> (desktop) y{' '}
				<strong>800 × 400 px</strong> (mobile, opcional — si falta se usa la de
				desktop). Usá las mismas medidas en todos los slides para que se vean
				parejos y sin deformar.
			</p>

			<ul className='mt-4 space-y-3'>
				{slides.map((s, idx) => (
					<li
						key={s.id}
						className='flex gap-3 rounded-lg border border-ink-100 p-3'
					>
						<div className='flex shrink-0 flex-col items-center gap-1'>
							<img
								src={s.image}
								alt={s.alt}
								className='h-20 w-32 rounded-md border border-ink-100 object-cover'
							/>
							<label className='flex cursor-pointer items-center gap-1 text-[11px] font-medium text-brand-600 hover:underline'>
								<HiOutlinePhoto size={12} />
								{s.image_mobile ? 'Mobile ✓ (cambiar)' : 'Subir versión mobile'}
								<input
									type='file'
									accept='image/*'
									className='hidden'
									onChange={async e => {
										const f = e.target.files?.[0];
										e.target.value = '';
										if (!f) return;
										try {
											const url = await uploadHomeImage(f);
											patch(idx, { image_mobile: url });
										} catch (err) {
											console.error('uploadHomeImage:', err);
										}
									}}
								/>
							</label>
						</div>
						<div className='flex-1 space-y-2'>
							<div>
								<label className='mb-1 block text-xs font-medium text-ink-500'>
									Link
								</label>
								<input
									value={s.link}
									onChange={e => patch(idx, { link: e.target.value })}
									placeholder='/tienda?category=<id>'
									className={inputClass}
								/>
							</div>
							<div>
								<label className='mb-1 block text-xs font-medium text-ink-500'>
									Texto alternativo (alt)
								</label>
								<input
									value={s.alt}
									onChange={e => patch(idx, { alt: e.target.value })}
									placeholder='Descripción de la imagen'
									className={inputClass}
								/>
							</div>
						</div>
						<div className='flex flex-col items-center gap-0.5'>
							<MoveButtons idx={idx} total={slides.length} onMove={move} />
							<button
								type='button'
								onClick={() => remove(idx)}
								className='grid h-8 w-8 place-items-center rounded-md text-ink-400 hover:bg-rose-50 hover:text-rose-600'
								title='Eliminar'
							>
								<HiOutlineTrash size={16} />
							</button>
						</div>
					</li>
				))}
				{slides.length === 0 && (
					<li className='py-6 text-center text-xs text-ink-400'>
						Sin slides todavía.
					</li>
				)}
			</ul>

			<div className='mt-4 flex justify-end'>
				<button
					type='button'
					onClick={() => onSave(slides)}
					disabled={saving}
					className={primaryBtn}
				>
					{saving && <Spinner />}
					Guardar carrusel
				</button>
			</div>
		</div>
	);
};

/* ================================================================== */
/*  Editor de contenido: Tiles de categorías (category_tiles)         */
/* ================================================================== */

const CategoryTilesEditor = ({
	initial,
	categories,
	onSave,
	saving,
}: {
	initial: HomeCategoryTile[];
	categories: { id: string; name: string }[];
	onSave: (tiles: HomeCategoryTile[]) => void;
	saving: boolean;
}) => {
	const [tiles, setTiles] = useState<HomeCategoryTile[]>(initial);
	const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);

	useEffect(() => setTiles(initial), [initial]);

	const addTile = () =>
		setTiles(prev => [...prev, { category_id: '', image: '', label: '', link: '' }]);
	const patch = (idx: number, p: Partial<HomeCategoryTile>) =>
		setTiles(prev => prev.map((t, i) => (i === idx ? { ...t, ...p } : t)));
	const remove = (idx: number) =>
		setTiles(prev => prev.filter((_, i) => i !== idx));
	const move = (idx: number, dir: -1 | 1) =>
		setTiles(prev => {
			const next = [...prev];
			const j = idx + dir;
			if (j < 0 || j >= next.length) return prev;
			[next[idx], next[j]] = [next[j], next[idx]];
			return next;
		});

	const uploadFor = async (idx: number, file: File) => {
		setUploadingIdx(idx);
		try {
			const url = await uploadHomeImage(file);
			patch(idx, { image: url });
		} catch (e) {
			console.error('uploadHomeImage:', e);
		} finally {
			setUploadingIdx(null);
		}
	};

	return (
		<div>
			<ul className='space-y-3'>
				{tiles.map((t, idx) => (
					<li
						key={idx}
						className='flex gap-3 rounded-lg border border-ink-100 p-3'
					>
						<div className='shrink-0'>
							{t.image ? (
								<img
									src={t.image}
									alt={t.label ?? ''}
									className='h-20 w-20 rounded-md border border-ink-100 object-cover'
								/>
							) : (
								<div className='grid h-20 w-20 place-items-center rounded-md border border-dashed border-ink-200 text-ink-300'>
									<HiOutlinePhoto size={24} />
								</div>
							)}
							<label className='mt-1 flex cursor-pointer items-center justify-center gap-1 text-[11px] font-medium text-brand-600 hover:underline'>
								{uploadingIdx === idx ? (
									<span className='inline-block h-3 w-3 animate-spin rounded-full border-2 border-ink-300 border-t-brand-600' />
								) : (
									<HiOutlinePhoto size={13} />
								)}
								{uploadingIdx === idx ? 'Subiendo…' : 'Imagen'}
								<input
									type='file'
									accept='image/*'
									className='hidden'
									disabled={uploadingIdx === idx}
									onChange={e => {
										const f = e.target.files?.[0];
										if (f) uploadFor(idx, f);
										e.target.value = '';
									}}
								/>
							</label>
						</div>

						<div className='flex-1 space-y-2'>
							<div>
								<label className='mb-1 block text-xs font-medium text-ink-500'>
									Categoría
								</label>
								<select
									value={t.category_id}
									onChange={e => patch(idx, { category_id: e.target.value })}
									className={inputClass}
								>
									<option value=''>Elegí una categoría…</option>
									{categories.map(c => (
										<option key={c.id} value={c.id}>
											{c.name}
										</option>
									))}
								</select>
							</div>
							<div>
								<label className='mb-1 block text-xs font-medium text-ink-500'>
									Etiqueta (opcional)
								</label>
								<input
									value={t.label ?? ''}
									onChange={e => patch(idx, { label: e.target.value })}
									placeholder='Sobreescribe el nombre de la categoría'
									className={inputClass}
								/>
							</div>
							<div>
								<label className='mb-1 block text-xs font-medium text-ink-500'>
									Link (opcional)
								</label>
								<input
									value={t.link ?? ''}
									onChange={e => patch(idx, { link: e.target.value })}
									placeholder='/tienda?category=… o https://wa.me/…'
									className={inputClass}
								/>
							</div>
						</div>

						<div className='flex flex-col items-center gap-0.5'>
							<MoveButtons idx={idx} total={tiles.length} onMove={move} />
							<button
								type='button'
								onClick={() => remove(idx)}
								className='grid h-8 w-8 place-items-center rounded-md text-ink-400 hover:bg-rose-50 hover:text-rose-600'
								title='Eliminar'
							>
								<HiOutlineTrash size={16} />
							</button>
						</div>
					</li>
				))}
				{tiles.length === 0 && (
					<li className='py-6 text-center text-xs text-ink-400'>
						Sin tiles todavía.
					</li>
				)}
			</ul>

			<div className='mt-4 flex items-center justify-between'>
				<button type='button' onClick={addTile} className={ghostBtn}>
					<HiOutlinePlus size={18} />
					Agregar tile
				</button>
				<button
					type='button'
					onClick={() => onSave(tiles)}
					disabled={saving}
					className={primaryBtn}
				>
					{saving && <Spinner />}
					Guardar tiles
				</button>
			</div>
		</div>
	);
};

/* ================================================================== */
/*  Editor de contenido: Banner Impresión 3D (banner_3d)              */
/* ================================================================== */

const Banner3DEditor = ({
	initial,
	onSave,
	saving,
}: {
	initial: HomeBanner3D;
	onSave: (banner: HomeBanner3D) => void;
	saving: boolean;
}) => {
	const [banner, setBanner] = useState<HomeBanner3D>(initial);
	const [uploading, setUploading] = useState(false);

	useEffect(() => setBanner(initial), [initial]);

	const patch = (p: Partial<HomeBanner3D>) =>
		setBanner(prev => ({ ...prev, ...p }));

	const upload = async (file: File) => {
		setUploading(true);
		try {
			const url = await uploadHomeImage(file);
			patch({ image: url });
		} catch (e) {
			console.error('uploadHomeImage:', e);
		} finally {
			setUploading(false);
		}
	};

	return (
		<div>
			<div className='flex gap-4'>
				<div className='shrink-0'>
					{banner.image ? (
						<img
							src={banner.image}
							alt={banner.title}
							className='h-28 w-44 rounded-md border border-ink-100 object-cover'
						/>
					) : (
						<div className='grid h-28 w-44 place-items-center rounded-md border border-dashed border-ink-200 text-ink-300'>
							<HiOutlinePhoto size={28} />
						</div>
					)}
					<label className='mt-1 flex cursor-pointer items-center justify-center gap-1 text-xs font-medium text-brand-600 hover:underline'>
						{uploading ? (
							<span className='inline-block h-3 w-3 animate-spin rounded-full border-2 border-ink-300 border-t-brand-600' />
						) : (
							<HiOutlinePhoto size={14} />
						)}
						{uploading ? 'Subiendo…' : 'Cambiar imagen'}
						<input
							type='file'
							accept='image/*'
							className='hidden'
							disabled={uploading}
							onChange={e => {
								const f = e.target.files?.[0];
								if (f) upload(f);
								e.target.value = '';
							}}
						/>
					</label>
				</div>

				<div className='flex-1 space-y-2'>
					<div>
						<label className='mb-1 block text-xs font-medium text-ink-500'>
							Título
						</label>
						<input
							value={banner.title}
							onChange={e => patch({ title: e.target.value })}
							className={inputClass}
						/>
					</div>
					<div>
						<label className='mb-1 block text-xs font-medium text-ink-500'>
							Subtítulo
						</label>
						<input
							value={banner.subtitle}
							onChange={e => patch({ subtitle: e.target.value })}
							className={inputClass}
						/>
					</div>
					<div>
						<label className='mb-1 block text-xs font-medium text-ink-500'>
							Link
						</label>
						<input
							value={banner.link}
							onChange={e => patch({ link: e.target.value })}
							placeholder='/tienda?category=<id>'
							className={inputClass}
						/>
					</div>
				</div>
			</div>

			<div className='mt-4 flex justify-end'>
				<button
					type='button'
					onClick={() => onSave(banner)}
					disabled={saving}
					className={primaryBtn}
				>
					{saving && <Spinner />}
					Guardar banner
				</button>
			</div>
		</div>
	);
};

/* ================================================================== */
/*  Selector de productos (para bloques 'products' manuales)          */
/* ================================================================== */

const ProductPicker = ({
	ids,
	onChange,
}: {
	ids: string[];
	onChange: (ids: string[]) => void;
}) => {
	const [term, setTerm] = useState('');

	const { data: products = [] } = useQuery({
		queryKey: ['picker-products', ids],
		queryFn: () => getProductsByIds(ids),
		enabled: ids.length > 0,
	});

	const { data: results = [] } = useQuery({
		queryKey: ['home-product-search', term],
		queryFn: () => searchProducts(term),
		enabled: term.trim().length >= 2,
	});

	const add = (id: string) => {
		if (ids.includes(id)) return;
		onChange([...ids, id]);
		setTerm('');
	};
	const remove = (id: string) => onChange(ids.filter(x => x !== id));
	const move = (idx: number, dir: -1 | 1) => {
		const next = [...ids];
		const j = idx + dir;
		if (j < 0 || j >= next.length) return;
		[next[idx], next[j]] = [next[j], next[idx]];
		onChange(next);
	};

	return (
		<div>
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
				<div className='mt-2 max-h-52 space-y-1 overflow-auto rounded-lg border border-ink-100 p-1'>
					{results.length === 0 ? (
						<p className='py-3 text-center text-xs text-ink-400'>
							Sin resultados.
						</p>
					) : (
						results.slice(0, 12).map((p: any) => (
							<button
								key={p.id}
								type='button'
								onClick={() => add(p.id)}
								disabled={ids.includes(p.id)}
								className='flex w-full items-center gap-2 rounded-md p-1.5 text-left hover:bg-ink-50 disabled:opacity-40'
							>
								<img
									src={p.images?.[0]}
									alt=''
									className='h-8 w-8 rounded object-contain'
								/>
								<span className='flex-1 truncate text-xs text-ink-700'>
									{p.name}
								</span>
								<HiOutlinePlus className='text-brand-600' size={16} />
							</button>
						))
					)}
				</div>
			)}

			<ul className='mt-3 space-y-1.5'>
				{products.map((p, idx) => (
					<li
						key={p.id}
						className='flex items-center gap-2 rounded-lg border border-ink-100 p-1.5'
					>
						<img
							src={p.images?.[0]}
							alt=''
							className='h-9 w-9 shrink-0 rounded object-contain'
						/>
						<span className='flex-1 truncate text-xs text-ink-700'>{p.name}</span>
						<div className='flex items-center gap-0.5'>
							<button
								type='button'
								onClick={() => move(idx, -1)}
								disabled={idx === 0}
								className={iconBtnClass}
								title='Subir'
							>
								<HiOutlineArrowUp size={14} />
							</button>
							<button
								type='button'
								onClick={() => move(idx, 1)}
								disabled={idx === products.length - 1}
								className={iconBtnClass}
								title='Bajar'
							>
								<HiOutlineArrowDown size={14} />
							</button>
							<button
								type='button'
								onClick={() => remove(p.id)}
								className='grid h-8 w-8 place-items-center rounded-md text-ink-400 hover:bg-rose-50 hover:text-rose-600'
								title='Quitar'
							>
								<HiOutlineTrash size={14} />
							</button>
						</div>
					</li>
				))}
				{ids.length === 0 && (
					<li className='py-6 text-center text-xs text-ink-400'>
						Sin productos seleccionados.
					</li>
				)}
			</ul>
		</div>
	);
};

/* ================================================================== */
/*  Selección manual de las secciones automáticas (vitrina).          */
/*  Edita app_settings.home_recent / home_featured: si hay productos  */
/*  elegidos la home muestra esos; si la lista queda vacía, es        */
/*  automático (igual que la vieja página /dashboard/vitrina).        */
/* ================================================================== */

const AutoSectionPicker = ({ source }: { source: 'recent' | 'featured' }) => {
	const key: HomeSectionKey =
		source === 'recent' ? 'home_recent' : 'home_featured';
	const qc = useQueryClient();

	const { data: savedIds = [], isLoading } = useQuery({
		queryKey: ['home-section-ids', key],
		queryFn: () => getHomeSectionIds(key),
	});

	// null = sin cambios locales (mostrar lo guardado).
	const [draft, setDraft] = useState<string[] | null>(null);
	const ids = draft ?? savedIds;
	const dirty = draft !== null;

	const save = useMutation({
		mutationFn: () => updateHomeSectionIds(key, ids),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['home-section-ids', key] });
			qc.invalidateQueries({ queryKey: ['home-sections'] });
			setDraft(null);
			toast.success('Selección guardada', { position: 'bottom-right' });
		},
		onError: (e: Error) =>
			toast.error(e.message || 'No se pudo guardar la selección', {
				position: 'bottom-right',
			}),
	});

	if (isLoading) {
		return <p className='text-xs text-ink-400'>Cargando selección…</p>;
	}

	return (
		<div className='rounded-lg border border-ink-100 p-3'>
			<p className='mb-1 text-xs font-medium text-ink-500'>
				Productos de la vitrina
			</p>
			<p className='mb-2 text-xs text-ink-400'>
				Elegí a mano qué productos se muestran en esta sección. Si dejás la
				lista vacía, se completa de forma automática.
			</p>
			<ProductPicker ids={ids} onChange={setDraft} />
			<div className='mt-3 flex justify-end border-t border-ink-100 pt-3'>
				<button
					type='button'
					onClick={() => save.mutate()}
					disabled={!dirty || save.isPending}
					className={primaryBtn}
				>
					{save.isPending && <Spinner />}
					Guardar selección
				</button>
			</div>
		</div>
	);
};

/* ================================================================== */
/*  Fila de bloque dentro de la lista "Secciones de la home"          */
/* ================================================================== */

const BlockRow = ({
	block,
	idx,
	total,
	expanded,
	onToggleExpand,
	onMove,
	onPatch,
	onRemove,
	config,
	categories,
	update,
}: {
	block: HomeBlock;
	idx: number;
	total: number;
	expanded: boolean;
	onToggleExpand: () => void;
	onMove: (idx: number, dir: -1 | 1) => void;
	onPatch: (patch: Partial<HomeBlock>) => void;
	onRemove: () => void;
	config: ReturnType<typeof useHomeConfig>['config'];
	categories: { id: string; name: string }[];
	update: ReturnType<typeof useUpdateHomeConfig>;
}) => {
	const isProducts = block.type === 'products';
	const label = isProducts
		? block.title?.trim() || 'Sección de productos'
		: BLOCK_LABELS[block.type];

	return (
		<li className='rounded-xl border border-ink-100 bg-white'>
			{/* Cabecera de la fila */}
			<div className='flex items-center gap-2 p-3'>
				<div className='flex flex-col gap-0.5'>
					<MoveButtons idx={idx} total={total} onMove={onMove} />
				</div>

				<div className='min-w-0 flex-1'>
					<div className='flex items-center gap-2'>
						<span className='truncate text-sm font-semibold text-ink-900'>
							{label}
						</span>
						<span className='shrink-0 rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-500'>
							{BLOCK_LABELS[block.type]}
						</span>
						{!block.enabled && (
							<span className='shrink-0 rounded-full bg-ink-200 px-2 py-0.5 text-[10px] font-medium text-ink-600'>
								Oculta
							</span>
						)}
					</div>
				</div>

				{/* Toggle activar/desactivar */}
				<label
					className='inline-flex shrink-0 cursor-pointer items-center gap-1.5 text-xs font-medium text-ink-600'
					title={block.enabled ? 'Activa' : 'Oculta'}
				>
					<input
						type='checkbox'
						checked={block.enabled}
						onChange={e => onPatch({ enabled: e.target.checked })}
						className='h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-300'
					/>
					Activa
				</label>

				<button
					type='button'
					onClick={onToggleExpand}
					className={ghostBtn + ' shrink-0'}
				>
					{expanded ? (
						<HiOutlineChevronUp size={16} />
					) : (
						<HiOutlinePencilSquare size={16} />
					)}
					{expanded ? 'Cerrar' : 'Editar'}
				</button>
			</div>

			{/* Editor expandible */}
			{expanded && (
				<div className='border-t border-ink-100 p-4'>
					{block.type === 'hero' && (
						<HeroSlidesEditor
							initial={config.hero_slides}
							saving={update.isPending}
							onSave={slides => update.mutate({ hero_slides: slides })}
						/>
					)}

					{block.type === 'categories' && (
						<CategoryTilesEditor
							initial={config.category_tiles}
							categories={categories}
							saving={update.isPending}
							onSave={tiles => update.mutate({ category_tiles: tiles })}
						/>
					)}

					{block.type === 'banner3d' && (
						<Banner3DEditor
							initial={config.banner_3d}
							saving={update.isPending}
							onSave={banner => update.mutate({ banner_3d: banner })}
						/>
					)}

					{(block.type === 'features' ||
						block.type === 'brands' ||
						block.type === 'business') && (
						<p className='text-sm text-ink-500'>
							Sin configuración: esta sección solo se activa/desactiva y se
							reordena.
						</p>
					)}

					{isProducts && (
						<div className='space-y-3'>
							<div>
								<label className='mb-1 block text-xs font-medium text-ink-500'>
									Nombre de la sección
								</label>
								<input
									value={block.title ?? ''}
									onChange={e => onPatch({ title: e.target.value })}
									placeholder='Ej. Lo más elegido'
									className={inputClass}
								/>
							</div>
							<div>
								<label className='mb-1 block text-xs font-medium text-ink-500'>
									Subtítulo (opcional)
								</label>
								<input
									value={block.subtitle ?? ''}
									onChange={e => onPatch({ subtitle: e.target.value })}
									placeholder='Texto secundario'
									className={inputClass}
								/>
							</div>
							<div>
								<label className='mb-1 block text-xs font-medium text-ink-500'>
									Origen de los productos
								</label>
								<select
									value={block.source ?? 'manual'}
									onChange={e =>
										onPatch({ source: e.target.value as ProductSource })
									}
									className={inputClass}
								>
									<option value='recent'>Recién llegados (automático)</option>
									<option value='featured'>Destacados (automático)</option>
									<option value='manual'>Manual (elegís los productos)</option>
								</select>
							</div>

							{(block.source ?? 'manual') === 'manual' && (
								<div className='rounded-lg border border-ink-100 p-3'>
									<p className='mb-2 text-xs font-medium text-ink-500'>
										Productos de la sección
									</p>
									<ProductPicker
										ids={block.product_ids ?? []}
										onChange={pids => onPatch({ product_ids: pids })}
									/>
								</div>
							)}

							{(block.source === 'recent' || block.source === 'featured') && (
								<AutoSectionPicker source={block.source} />
							)}

							<div className='flex items-center justify-between border-t border-ink-100 pt-3'>
								<p className='text-xs text-ink-400'>
									{(block.source ?? 'manual') === 'manual'
										? 'Nombre, subtítulo, origen y selección se guardan con “Guardar cambios”.'
										: 'Nombre, subtítulo y origen se guardan con “Guardar cambios”. Los productos de la vitrina se guardan con “Guardar selección”.'}
								</p>
								<button
									type='button'
									onClick={onRemove}
									className='inline-flex items-center gap-2 rounded-lg border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-50'
								>
									<HiOutlineTrash size={16} />
									Eliminar sección
								</button>
							</div>
						</div>
					)}
				</div>
			)}
		</li>
	);
};

/* ================================================================== */
/*  Página                                                            */
/* ================================================================== */

export const DashboardHomeConfigPage = () => {
	const { config, isLoading } = useHomeConfig();
	const { categories, subcategories } = useTaxonomies();
	const update = useUpdateHomeConfig();
	const queryClient = useQueryClient();

	// Reordenar subcategorías escribe en subcategories.sort_order (orden global,
	// compartido con el navbar y con /dashboard/taxonomias), no en home_config.
	const reorderSubs = useMutation({
		mutationFn: reorderSubcategories,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['subcategories'] });
			toast.success('Orden de subcategorías actualizado', {
				position: 'bottom-right',
			});
		},
		onError: (e: Error) =>
			toast.error(e.message || 'No se pudo guardar el orden', {
				position: 'bottom-right',
			}),
	});

	const [layout, setLayout] = useState<HomeBlock[]>(config.layout);
	const [expandedId, setExpandedId] = useState<string | null>(null);

	// Resincroniza cuando llega/cambia la config del server.
	useEffect(() => setLayout(config.layout), [config.layout]);

	if (isLoading) {
		return (
			<div className='grid place-items-center py-20 text-sm text-ink-400'>
				Cargando configuración…
			</div>
		);
	}

	const moveBlock = (idx: number, dir: -1 | 1) =>
		setLayout(prev => {
			const next = [...prev];
			const j = idx + dir;
			if (j < 0 || j >= next.length) return prev;
			[next[idx], next[j]] = [next[j], next[idx]];
			return next;
		});

	const patchBlock = (id: string, patch: Partial<HomeBlock>) =>
		setLayout(prev => prev.map(b => (b.id === id ? { ...b, ...patch } : b)));

	const removeBlock = (id: string) => {
		setLayout(prev => prev.filter(b => b.id !== id));
		if (expandedId === id) setExpandedId(null);
	};

	const addProductsBlock = () => {
		const nb: HomeBlock = {
			id: crypto.randomUUID(),
			type: 'products',
			enabled: true,
			title: 'Nueva sección',
			subtitle: '',
			source: 'manual',
			product_ids: [],
		};
		setLayout(prev => [...prev, nb]);
		setExpandedId(nb.id);
	};

	return (
		<div className='space-y-6'>
			<div>
				<h1 className='text-2xl font-bold text-ink-900'>Home</h1>
				<p className='text-sm text-ink-500'>
					Ordená, activá y editá las secciones de la página principal.
				</p>
			</div>

			{/* Header: barra de categorías destacadas */}
			<NavFeaturedBlock
				initial={config.nav_featured}
				categories={categories}
				subcategories={subcategories}
				saving={update.isPending}
				onSave={ids => update.mutate({ nav_featured: ids })}
				onReorderSubs={ids => reorderSubs.mutate(ids)}
				reorderingSubs={reorderSubs.isPending}
			/>

			{/* Constructor de secciones */}
			<section className={cardClass}>
				<div className='mb-4 flex items-start justify-between gap-4'>
					<div>
						<h2 className='font-bold text-ink-900'>Secciones de la home</h2>
						<p className='text-xs text-ink-500'>
							Este es el orden real en el que se muestran las secciones. Reordená
							con las flechas, activá/desactivá y editá su contenido.
						</p>
					</div>
					<button
						type='button'
						onClick={() => update.mutate({ layout })}
						disabled={update.isPending}
						className={primaryBtn + ' shrink-0'}
					>
						{update.isPending && <Spinner />}
						Guardar cambios
					</button>
				</div>

				<ul className='space-y-2'>
					{layout.map((block, idx) => (
						<BlockRow
							key={block.id}
							block={block}
							idx={idx}
							total={layout.length}
							expanded={expandedId === block.id}
							onToggleExpand={() =>
								setExpandedId(prev => (prev === block.id ? null : block.id))
							}
							onMove={moveBlock}
							onPatch={patch => patchBlock(block.id, patch)}
							onRemove={() => removeBlock(block.id)}
							config={config}
							categories={categories}
							update={update}
						/>
					))}
					{layout.length === 0 && (
						<li className='py-6 text-center text-xs text-ink-400'>
							No hay secciones. Agregá una.
						</li>
					)}
				</ul>

				<div className='mt-4 flex items-center justify-between border-t border-ink-100 pt-4'>
					<button type='button' onClick={addProductsBlock} className={ghostBtn}>
						<HiOutlinePlus size={18} />
						Agregar sección de productos
					</button>
					<button
						type='button'
						onClick={() => update.mutate({ layout })}
						disabled={update.isPending}
						className={primaryBtn}
					>
						{update.isPending && <Spinner />}
						Guardar cambios
					</button>
				</div>
			</section>
		</div>
	);
};
