import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
	HiOutlinePlus,
	HiOutlinePencil,
	HiOutlineTrash,
	HiOutlineCheck,
	HiOutlineXMark,
	HiOutlineChevronDown,
} from 'react-icons/hi2';
import {
	getBrands,
	getCategories,
	getSubcategories,
	createBrand,
	updateBrand,
	deleteBrand,
	createCategory,
	updateCategory,
	deleteCategory,
	createSubcategory,
	updateSubcategory,
	deleteSubcategory,
} from '../../actions';

/* ---------- fila editable reutilizable ---------- */
const EditableItem = ({
	name,
	onRename,
	onDelete,
	dense,
}: {
	name: string;
	onRename: (newName: string) => void;
	onDelete: () => void;
	dense?: boolean;
}) => {
	const [editing, setEditing] = useState(false);
	const [value, setValue] = useState(name);

	const save = () => {
		const v = value.trim();
		if (v && v !== name) onRename(v);
		setEditing(false);
	};

	if (editing) {
		return (
			<div className='flex items-center gap-1.5'>
				<input
					autoFocus
					value={value}
					onChange={e => setValue(e.target.value)}
					onKeyDown={e => e.key === 'Enter' && save()}
					className='flex-1 rounded-md border border-brand-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300'
				/>
				<button
					onClick={save}
					className='grid h-7 w-7 place-items-center rounded-md text-emerald-600 hover:bg-emerald-50'
				>
					<HiOutlineCheck size={16} />
				</button>
				<button
					onClick={() => {
						setValue(name);
						setEditing(false);
					}}
					className='grid h-7 w-7 place-items-center rounded-md text-ink-400 hover:bg-ink-100'
				>
					<HiOutlineXMark size={16} />
				</button>
			</div>
		);
	}

	return (
		<div className='group flex items-center justify-between gap-2'>
			<span className={`text-ink-700 ${dense ? 'text-sm' : 'text-sm font-medium'}`}>
				{name}
			</span>
			<div className='flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100'>
				<button
					onClick={() => setEditing(true)}
					className='grid h-7 w-7 place-items-center rounded-md text-ink-400 hover:bg-ink-100 hover:text-brand-600'
					title='Renombrar'
				>
					<HiOutlinePencil size={14} />
				</button>
				<button
					onClick={onDelete}
					className='grid h-7 w-7 place-items-center rounded-md text-ink-400 hover:bg-rose-50 hover:text-rose-600'
					title='Eliminar'
				>
					<HiOutlineTrash size={14} />
				</button>
			</div>
		</div>
	);
};

const AddInput = ({
	placeholder,
	onAdd,
	disabled,
}: {
	placeholder: string;
	onAdd: (name: string) => void;
	disabled?: boolean;
}) => {
	const [value, setValue] = useState('');
	const submit = () => {
		const v = value.trim();
		if (!v) return;
		onAdd(v);
		setValue('');
	};
	return (
		<div className='flex gap-2'>
			<input
				value={value}
				onChange={e => setValue(e.target.value)}
				onKeyDown={e => e.key === 'Enter' && submit()}
				placeholder={placeholder}
				disabled={disabled}
				className='flex-1 rounded-lg border border-ink-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:bg-ink-50'
			/>
			<button
				onClick={submit}
				disabled={disabled || !value.trim()}
				className='inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white transition-all hover:bg-brand-700 disabled:opacity-50'
			>
				<HiOutlinePlus size={16} />
			</button>
		</div>
	);
};

export const DashboardTaxonomiesPage = () => {
	const qc = useQueryClient();
	const [openCat, setOpenCat] = useState<string | null>(null);

	const { data: brands = [] } = useQuery({ queryKey: ['brands'], queryFn: getBrands });
	const { data: categories = [] } = useQuery({
		queryKey: ['categories'],
		queryFn: getCategories,
	});
	const { data: subcategories = [] } = useQuery({
		queryKey: ['subcategories'],
		queryFn: getSubcategories,
	});

	const inv = (key: string) => qc.invalidateQueries({ queryKey: [key] });
	const onErr = (e: Error) => {
		// Mensajes de FK / unique constraint son crípticos: damos pista al usuario.
		const raw = e.message || 'Ocurrió un error';
		const friendly = raw.match(/foreign key/i)
			? 'No se puede borrar: hay registros que la usan. Quitala primero de los productos que la referencian.'
			: raw.match(/duplicate key|unique/i)
			? 'Ya existe un registro con ese nombre.'
			: raw;
		toast.error(friendly, { position: 'bottom-right' });
	};

	// Marcas
	const mAddBrand = useMutation({ mutationFn: createBrand, onSuccess: () => inv('brands'), onError: onErr });
	const mEditBrand = useMutation({ mutationFn: updateBrand, onSuccess: () => inv('brands'), onError: onErr });
	const mDelBrand = useMutation({ mutationFn: deleteBrand, onSuccess: () => inv('brands'), onError: onErr });

	// Categorías
	const mAddCat = useMutation({ mutationFn: createCategory, onSuccess: () => inv('categories'), onError: onErr });
	const mEditCat = useMutation({ mutationFn: updateCategory, onSuccess: () => inv('categories'), onError: onErr });
	const mDelCat = useMutation({ mutationFn: deleteCategory, onSuccess: () => inv('categories'), onError: onErr });

	// Subcategorías
	const mAddSub = useMutation({ mutationFn: createSubcategory, onSuccess: () => inv('subcategories'), onError: onErr });
	const mEditSub = useMutation({ mutationFn: updateSubcategory, onSuccess: () => inv('subcategories'), onError: onErr });
	const mDelSub = useMutation({ mutationFn: deleteSubcategory, onSuccess: () => inv('subcategories'), onError: onErr });

	const confirmDel = (msg: string) => window.confirm(msg);

	return (
		<div className='space-y-6'>
			<div>
				<h1 className='text-2xl font-bold text-ink-900'>Categorías y Marcas</h1>
				<p className='text-sm text-ink-500'>
					Creá y organizá las categorías, subcategorías y marcas de tu catálogo.
				</p>
			</div>

			<div className='grid grid-cols-1 gap-6 lg:grid-cols-3'>
				{/* Categorías + subcategorías */}
				<div className='lg:col-span-2 rounded-2xl border border-ink-200/70 bg-white p-5 shadow-soft'>
					<h2 className='mb-4 font-bold text-ink-900'>
						Categorías y subcategorías
					</h2>

					<AddInput
						placeholder='Nueva categoría'
						onAdd={name => mAddCat.mutate(name)}
					/>

					<div className='mt-4 space-y-2'>
						{categories.length === 0 && (
							<p className='py-4 text-center text-sm text-ink-400'>
								Todavía no hay categorías.
							</p>
						)}
						{categories.map(cat => {
							const subs = subcategories.filter(s => s.category_id === cat.id);
							const isOpen = openCat === cat.id;
							return (
								<div
									key={cat.id}
									className='rounded-xl border border-ink-100 bg-ink-50/40'
								>
									<div className='flex items-center gap-2 px-3 py-2.5'>
										<button
											onClick={() => setOpenCat(isOpen ? null : cat.id)}
											className='grid h-7 w-7 shrink-0 place-items-center rounded-md text-ink-400 hover:bg-ink-100'
										>
											<HiOutlineChevronDown
												size={16}
												className={`transition-transform ${
													isOpen ? 'rotate-180' : ''
												}`}
											/>
										</button>
										<div className='flex-1'>
											<EditableItem
												name={cat.name}
												onRename={name =>
													mEditCat.mutate({ id: cat.id, name })
												}
												onDelete={() => {
													if (
														confirmDel(
															`¿Eliminar la categoría "${cat.name}"? Sus subcategorías también se eliminarán. (No se puede si tiene productos asignados.)`
														)
													)
														mDelCat.mutate(cat.id);
												}}
											/>
										</div>
										<span className='shrink-0 rounded-full bg-white px-2 py-0.5 text-xs text-ink-500'>
											{subs.length} sub
										</span>
									</div>

									{isOpen && (
										<div className='space-y-2 border-t border-ink-100 px-4 py-3 pl-12'>
											{subs.map(sub => (
												<EditableItem
													key={sub.id}
													dense
													name={sub.name}
													onRename={name =>
														mEditSub.mutate({ id: sub.id, name })
													}
													onDelete={() => {
														if (confirmDel(`¿Eliminar "${sub.name}"?`))
															mDelSub.mutate(sub.id);
													}}
												/>
											))}
											<AddInput
												placeholder='Nueva subcategoría'
												onAdd={name =>
													mAddSub.mutate({ name, category_id: cat.id })
												}
											/>
										</div>
									)}
								</div>
							);
						})}
					</div>
				</div>

				{/* Marcas */}
				<div className='rounded-2xl border border-ink-200/70 bg-white p-5 shadow-soft'>
					<h2 className='mb-4 font-bold text-ink-900'>Marcas</h2>
					<AddInput
						placeholder='Nueva marca'
						onAdd={name => mAddBrand.mutate(name)}
					/>
					<div className='mt-4 max-h-[480px] space-y-1.5 overflow-auto pr-1'>
						{brands.map(brand => (
							<div
								key={brand.id}
								className='rounded-lg border border-ink-100 px-3 py-2'
							>
								<EditableItem
									name={brand.name}
									onRename={name => mEditBrand.mutate({ id: brand.id, name })}
									onDelete={() => {
										if (confirmDel(`¿Eliminar la marca "${brand.name}"?`))
											mDelBrand.mutate(brand.id);
									}}
								/>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
};
