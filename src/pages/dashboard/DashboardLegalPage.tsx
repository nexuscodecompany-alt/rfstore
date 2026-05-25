import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { HiOutlinePlus, HiOutlineTrash } from 'react-icons/hi2';
import { getLegalPages, updateLegalPages, LegalPagesMap } from '../../actions/legal';
import { generateSlug } from '../../helpers';
import { Loader } from '../../components/shared/Loader';

export const DashboardLegalPage = () => {
	const qc = useQueryClient();
	const { data, isLoading } = useQuery({
		queryKey: ['legal_pages'],
		queryFn: getLegalPages,
	});

	const [pages, setPages] = useState<LegalPagesMap>({});
	const [newTitle, setNewTitle] = useState('');

	useEffect(() => {
		if (data) setPages(data);
	}, [data]);

	const save = useMutation({
		mutationFn: () => updateLegalPages(pages),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['legal_pages'] });
			toast.success('Documentos guardados', { position: 'bottom-right' });
		},
		onError: () => toast.error('No se pudo guardar', { position: 'bottom-right' }),
	});

	if (isLoading) return <Loader />;

	const slugs = Object.keys(pages);

	const setField = (slug: string, field: 'title' | 'content', value: string) =>
		setPages(p => ({ ...p, [slug]: { ...p[slug], [field]: value } }));

	const addPage = () => {
		const title = newTitle.trim();
		if (!title) return;
		const slug = generateSlug(title);
		if (pages[slug]) {
			toast.error('Ya existe un documento con ese nombre');
			return;
		}
		setPages(p => ({ ...p, [slug]: { title, content: '' } }));
		setNewTitle('');
	};

	const removePage = (slug: string) => {
		if (!window.confirm(`¿Eliminar el documento "${pages[slug].title}"?`)) return;
		setPages(p => {
			const next = { ...p };
			delete next[slug];
			return next;
		});
	};

	return (
		<div className='max-w-4xl space-y-6'>
			<div className='flex flex-wrap items-end justify-between gap-3'>
				<div>
					<h1 className='text-2xl font-bold text-ink-900'>
						Documentos legales
					</h1>
					<p className='text-sm text-ink-500'>
						Editá los textos que se muestran en el footer (Términos, Privacidad,
						etc.). Las líneas que empiezan con “SECCIÓN” se muestran como
						títulos.
					</p>
				</div>
				<button
					onClick={() => save.mutate()}
					disabled={save.isPending}
					className='rounded-full bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white shadow-soft transition-all hover:bg-brand-700 disabled:opacity-60'
				>
					{save.isPending ? 'Guardando…' : 'Guardar cambios'}
				</button>
			</div>

			{/* Nuevo documento */}
			<div className='flex gap-2 rounded-2xl border border-ink-200/70 bg-white p-4 shadow-soft'>
				<input
					value={newTitle}
					onChange={e => setNewTitle(e.target.value)}
					onKeyDown={e => e.key === 'Enter' && addPage()}
					placeholder='Nuevo documento (ej: Política de Privacidad)'
					className='flex-1 rounded-lg border border-ink-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300'
				/>
				<button
					onClick={addPage}
					className='inline-flex items-center gap-1 rounded-lg bg-ink-900 px-4 py-2 text-sm font-semibold text-white hover:bg-ink-800'
				>
					<HiOutlinePlus size={16} /> Agregar
				</button>
			</div>

			{slugs.length === 0 && (
				<p className='py-8 text-center text-sm text-ink-400'>
					No hay documentos. Agregá el primero arriba.
				</p>
			)}

			{slugs.map(slug => (
				<div
					key={slug}
					className='space-y-3 rounded-2xl border border-ink-200/70 bg-white p-5 shadow-soft'
				>
					<div className='flex items-center gap-2'>
						<input
							value={pages[slug].title}
							onChange={e => setField(slug, 'title', e.target.value)}
							className='flex-1 rounded-lg border border-ink-200 px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-brand-300'
						/>
						<span className='rounded-md bg-ink-100 px-2 py-1 font-mono text-xs text-ink-500'>
							/legal/{slug}
						</span>
						<button
							onClick={() => removePage(slug)}
							className='grid h-9 w-9 place-items-center rounded-lg text-ink-400 hover:bg-rose-50 hover:text-rose-600'
						>
							<HiOutlineTrash size={16} />
						</button>
					</div>
					<textarea
						value={pages[slug].content}
						onChange={e => setField(slug, 'content', e.target.value)}
						rows={14}
						className='w-full rounded-lg border border-ink-200 px-3 py-2 font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-brand-300'
					/>
				</div>
			))}
		</div>
	);
};
