import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { HiOutlineTicket } from 'react-icons/hi2';
import {
	getCoupons,
	createCoupon,
	updateCoupon,
	deleteCoupon,
	type Coupon,
	type CouponInput,
	type CouponType,
	type CouponScope,
} from '../../actions/coupons';
import { useTaxonomiesAdmin } from '../../hooks';
import { supabase } from '../../supabase/client';
import { Loader } from '../../components/shared/Loader';
import { NumInput } from '../../components/dashboard/NumInput';

const EMPTY: CouponInput = {
	code: '',
	type: 'percent',
	value: 10,
	scope: 'all',
	category_id: null,
	product_id: null,
	min_order_usd: null,
	max_uses: null,
	expires_at: null,
	active: true,
};

const typeLabel: Record<CouponType, string> = {
	percent: '% de descuento',
	fixed: 'Monto fijo (UYU)',
	free_shipping: 'Envío gratis',
};

export const DashboardCouponsPage = () => {
	const queryClient = useQueryClient();
	const { categories } = useTaxonomiesAdmin();
	const { data: coupons = [], isLoading } = useQuery({ queryKey: ['coupons'], queryFn: getCoupons });

	const [form, setForm] = useState<CouponInput>(EMPTY);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [productSearch, setProductSearch] = useState('');

	const invalidate = () => queryClient.invalidateQueries({ queryKey: ['coupons'] });

	const { mutate: save, isPending: saving } = useMutation({
		mutationFn: async () => {
			if (!form.code.trim()) throw new Error('Ingresá un código');
			if (form.scope === 'category' && !form.category_id) throw new Error('Elegí una categoría');
			if (form.scope === 'product' && !form.product_id) throw new Error('Elegí un producto');
			if (editingId) await updateCoupon(editingId, form);
			else await createCoupon(form);
		},
		onSuccess: () => {
			toast.success(editingId ? 'Cupón actualizado' : 'Cupón creado');
			setForm(EMPTY);
			setEditingId(null);
			setProductSearch('');
			invalidate();
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const { mutate: toggle } = useMutation({
		mutationFn: (c: Coupon) => updateCoupon(c.id, { active: !c.active }),
		onSuccess: invalidate,
		onError: (e: Error) => toast.error(e.message),
	});

	const { mutate: remove } = useMutation({
		mutationFn: (id: string) => deleteCoupon(id),
		onSuccess: () => { toast.success('Cupón eliminado'); invalidate(); },
		onError: (e: Error) => toast.error(e.message),
	});

	const startEdit = (c: Coupon) => {
		setEditingId(c.id);
		setForm({
			code: c.code, type: c.type, value: c.value, scope: c.scope,
			category_id: c.category_id, product_id: c.product_id,
			min_order_usd: c.min_order_usd, max_uses: c.max_uses,
			expires_at: c.expires_at, active: c.active,
		});
		window.scrollTo({ top: 0, behavior: 'smooth' });
	};

	const catName = (id: string | null) => categories.find(c => c.id === id)?.name ?? '—';

	return (
		<div className='max-w-5xl space-y-6'>
			<div>
				<h1 className='flex items-center gap-2 text-2xl font-bold text-ink-900'>
					<HiOutlineTicket className='text-brand-600' /> Cupones de descuento
				</h1>
				<p className='text-sm text-ink-500'>
					Creá códigos y compartilos con tus clientes. El cliente los ingresa en el checkout. No se muestran en la web.
				</p>
			</div>

			{/* Form */}
			<div className='rounded-2xl border border-ink-200/70 bg-white p-5 shadow-soft space-y-4'>
				<h2 className='font-bold text-ink-900'>{editingId ? 'Editar cupón' : 'Nuevo cupón'}</h2>

				<div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4'>
					<Field label='Código'>
						<input className='inp' value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder='AHORRA10' />
					</Field>
					<Field label='Tipo'>
						<select className='inp' value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as CouponType }))}>
							<option value='percent'>% de descuento</option>
							<option value='fixed'>Monto fijo (UYU)</option>
							<option value='free_shipping'>Envío gratis</option>
						</select>
					</Field>
					{form.type !== 'free_shipping' && (
						<Field label={form.type === 'percent' ? 'Porcentaje (%)' : 'Monto en pesos (UYU)'}>
							<NumInput className='inp' value={form.value} min={0} onChange={n => setForm(f => ({ ...f, value: n }))} />
						</Field>
					)}
					<Field label='Aplica a'>
						<select className='inp' value={form.scope} onChange={e => setForm(f => ({ ...f, scope: e.target.value as CouponScope, category_id: null, product_id: null }))}>
							<option value='all'>Todo el carrito</option>
							<option value='category'>Una categoría</option>
							<option value='product'>Un producto</option>
						</select>
					</Field>
					{form.scope === 'category' && (
						<Field label='Categoría'>
							<select className='inp' value={form.category_id ?? ''} onChange={e => setForm(f => ({ ...f, category_id: e.target.value || null }))}>
								<option value=''>Elegí…</option>
								{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
							</select>
						</Field>
					)}
					{form.scope === 'product' && (
						<ProductPicker
							search={productSearch}
							setSearch={setProductSearch}
							selectedId={form.product_id}
							onSelect={(id) => setForm(f => ({ ...f, product_id: id }))}
						/>
					)}
					<Field label='Mínimo de compra USD (opcional)'>
						<input type='number' className='inp' value={form.min_order_usd ?? ''} onChange={e => setForm(f => ({ ...f, min_order_usd: e.target.value === '' ? null : Number(e.target.value) }))} placeholder='sin mínimo' />
					</Field>
					<Field label='Máximo de usos (opcional)'>
						<input type='number' className='inp' value={form.max_uses ?? ''} onChange={e => setForm(f => ({ ...f, max_uses: e.target.value === '' ? null : Number(e.target.value) }))} placeholder='ilimitado' />
					</Field>
					<Field label='Vence (opcional)'>
						<input type='date' className='inp' value={form.expires_at ? new Date(form.expires_at).toLocaleDateString('en-CA') : ''} onChange={e => setForm(f => ({ ...f, expires_at: e.target.value ? new Date(e.target.value + 'T23:59:59').toISOString() : null }))} />
					</Field>
					<Field label='Estado'>
						<label className='flex items-center gap-2 text-sm pt-2'>
							<input type='checkbox' checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
							Activo
						</label>
					</Field>
				</div>

				<div className='flex gap-2'>
					<button onClick={() => save()} disabled={saving} className='rounded-full bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60'>
						{saving ? 'Guardando…' : editingId ? 'Guardar cambios' : 'Crear cupón'}
					</button>
					{editingId && (
						<button onClick={() => { setEditingId(null); setForm(EMPTY); setProductSearch(''); }} className='rounded-full border border-ink-300 px-5 py-2 text-sm font-semibold text-ink-700 hover:bg-ink-50'>
							Cancelar
						</button>
					)}
				</div>
			</div>

			{/* Lista */}
			<div className='rounded-2xl border border-ink-200/70 bg-white p-5 shadow-soft'>
				<h2 className='mb-3 font-bold text-ink-900'>Cupones ({coupons.length})</h2>
				{isLoading ? (
					<Loader />
				) : coupons.length === 0 ? (
					<p className='text-sm text-ink-500'>Todavía no creaste cupones.</p>
				) : (
					<div className='overflow-auto'>
						<table className='min-w-full text-sm'>
							<thead className='text-left text-xs uppercase text-ink-500 border-b'>
								<tr>
									<th className='p-2'>Código</th>
									<th className='p-2'>Descuento</th>
									<th className='p-2'>Aplica a</th>
									<th className='p-2'>Usos</th>
									<th className='p-2'>Vence</th>
									<th className='p-2'>Estado</th>
									<th className='p-2'></th>
								</tr>
							</thead>
							<tbody>
								{coupons.map(c => (
									<tr key={c.id} className='border-b border-ink-100'>
										<td className='p-2 font-mono font-semibold'>{c.code}</td>
										<td className='p-2'>
											{c.type === 'free_shipping' ? 'Envío gratis' : c.type === 'percent' ? `${c.value}%` : `$U ${c.value}`}
											<span className='block text-[11px] text-ink-400'>{typeLabel[c.type]}</span>
										</td>
										<td className='p-2 text-xs'>
											{c.scope === 'all' ? 'Todo' : c.scope === 'category' ? `Cat: ${catName(c.category_id)}` : 'Producto'}
											{c.min_order_usd ? <span className='block text-ink-400'>mín USD {c.min_order_usd}</span> : null}
										</td>
										<td className='p-2'>{c.used_count}{c.max_uses ? ` / ${c.max_uses}` : ''}</td>
										<td className='p-2 text-xs'>{c.expires_at ? new Date(c.expires_at).toLocaleDateString('es-UY') : '—'}</td>
										<td className='p-2'>
											<button onClick={() => toggle(c)} className={`rounded-full px-2 py-0.5 text-xs font-semibold ${c.active ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-ink-100 text-ink-500'}`}>
												{c.active ? 'Activo' : 'Inactivo'}
											</button>
										</td>
										<td className='p-2 whitespace-nowrap text-right'>
											<button onClick={() => startEdit(c)} className='text-xs font-semibold text-brand-700 hover:text-brand-900 mr-3'>Editar</button>
											<button onClick={() => { if (confirm(`¿Eliminar el cupón ${c.code}?`)) remove(c.id); }} className='text-xs font-semibold text-rose-600 hover:text-rose-800'>Eliminar</button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>

			<style>{`.inp{width:100%;border:1px solid #d6d3d1;border-radius:0.5rem;padding:0.5rem 0.75rem;font-size:0.875rem;outline:none}.inp:focus{box-shadow:0 0 0 2px rgba(99,102,241,.3)}`}</style>
		</div>
	);
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
	<div>
		<label className='block text-xs font-medium text-ink-600 mb-1'>{label}</label>
		{children}
	</div>
);

// Buscador simple de producto para cupones por producto.
const ProductPicker = ({ search, setSearch, selectedId, onSelect }: {
	search: string;
	setSearch: (s: string) => void;
	selectedId: string | null;
	onSelect: (id: string) => void;
}) => {
	const [debounced, setDebounced] = useState(search);
	useEffect(() => {
		const t = setTimeout(() => setDebounced(search), 350);
		return () => clearTimeout(t);
	}, [search]);

	const { data: results = [] } = useQuery({
		queryKey: ['coupon-product-search', debounced],
		queryFn: async () => {
			if (debounced.trim().length < 2) return [] as { id: string; name: string }[];
			const { data } = await supabase.from('products').select('id, name').ilike('name', `%${debounced.trim()}%`).limit(15);
			return (data ?? []) as { id: string; name: string }[];
		},
	});

	const selectedName = useMemo(() => results.find(r => r.id === selectedId)?.name, [results, selectedId]);

	return (
		<div className='sm:col-span-2'>
			<label className='block text-xs font-medium text-ink-600 mb-1'>Producto</label>
			<input className='inp' value={search} onChange={e => setSearch(e.target.value)} placeholder='Buscar producto por nombre…' />
			{selectedId && <p className='mt-1 text-xs text-emerald-700'>Seleccionado: {selectedName ?? selectedId}</p>}
			{results.length > 0 && (
				<ul className='mt-1 max-h-40 overflow-auto rounded-lg border border-ink-100 text-sm'>
					{results.map(r => (
						<li key={r.id}>
							<button type='button' onClick={() => onSelect(r.id)} className={`block w-full text-left px-3 py-1.5 hover:bg-ink-50 ${selectedId === r.id ? 'bg-brand-50' : ''}`}>
								{r.name}
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
};
