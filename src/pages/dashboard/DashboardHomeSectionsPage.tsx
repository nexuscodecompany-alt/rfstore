import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
	HiOutlineMagnifyingGlass,
	HiOutlinePlus,
	HiOutlineTrash,
	HiOutlineArrowUp,
	HiOutlineArrowDown,
} from 'react-icons/hi2';
import {
	getHomeSectionIds,
	updateHomeSectionIds,
	getProductsByIds,
	searchProducts,
	HOME_SECTION_LABELS,
	HomeSectionKey,
} from '../../actions';

const SECTIONS: HomeSectionKey[] = [
	'home_featured',
	'home_recent',
	'home_popular',
];

const SectionEditor = ({ sectionKey }: { sectionKey: HomeSectionKey }) => {
	const qc = useQueryClient();
	const [term, setTerm] = useState('');

	const { data: ids = [] } = useQuery({
		queryKey: ['home-section-ids', sectionKey],
		queryFn: () => getHomeSectionIds(sectionKey),
	});

	const { data: products = [] } = useQuery({
		queryKey: ['home-section-products', sectionKey, ids],
		queryFn: () => getProductsByIds(ids),
		enabled: ids.length > 0,
	});

	const { data: results = [] } = useQuery({
		queryKey: ['home-product-search', term],
		queryFn: () => searchProducts(term),
		enabled: term.trim().length >= 2,
	});

	const save = useMutation({
		mutationFn: (next: string[]) => updateHomeSectionIds(sectionKey, next),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['home-section-ids', sectionKey] });
			qc.invalidateQueries({ queryKey: ['home-sections'] });
			toast.success('Sección actualizada', { position: 'bottom-right' });
		},
		onError: () => toast.error('No se pudo guardar', { position: 'bottom-right' }),
	});

	const add = (id: string) => {
		if (ids.includes(id)) return;
		save.mutate([...ids, id]);
		setTerm('');
	};
	const remove = (id: string) => save.mutate(ids.filter(x => x !== id));
	const move = (idx: number, dir: -1 | 1) => {
		const next = [...ids];
		const j = idx + dir;
		if (j < 0 || j >= next.length) return;
		[next[idx], next[j]] = [next[j], next[idx]];
		save.mutate(next);
	};

	return (
		<div className='rounded-2xl border border-ink-200/70 bg-white p-5 shadow-soft'>
			<h2 className='mb-1 font-bold text-ink-900'>
				{HOME_SECTION_LABELS[sectionKey]}
			</h2>
			<p className='mb-4 text-xs text-ink-500'>
				{ids.length} producto{ids.length !== 1 ? 's' : ''} · si queda vacía, se
				muestran productos automáticos.
			</p>

			{/* Buscador */}
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
						<p className='py-3 text-center text-xs text-ink-400'>Sin resultados.</p>
					) : (
						results.slice(0, 12).map((p: any) => (
							<button
								key={p.id}
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

			{/* Seleccionados */}
			<ul className='mt-4 space-y-1.5'>
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

export const DashboardHomeSectionsPage = () => {
	return (
		<div className='space-y-6'>
			<div>
				<h1 className='text-2xl font-bold text-ink-900'>Vitrina del home</h1>
				<p className='text-sm text-ink-500'>
					Elegí qué productos se muestran en cada sección de la página principal.
				</p>
			</div>

			<div className='grid grid-cols-1 gap-6 lg:grid-cols-3'>
				{SECTIONS.map(key => (
					<SectionEditor key={key} sectionKey={key} />
				))}
			</div>
		</div>
	);
};
