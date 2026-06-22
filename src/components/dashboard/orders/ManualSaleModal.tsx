import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HiOutlineTrash, HiXMark, HiOutlinePlus } from 'react-icons/hi2';
import {
	useSaleConcepts,
	useCreateSaleConcept,
	useDeleteSaleConcept,
	useManualSales,
	useCreateManualSale,
	useDeleteManualSale,
	useUsdUyuRate,
} from '../../../hooks';
import { supabase } from '../../../supabase/client';
import type { ManualSaleItem } from '../../../actions';
import { formatMoneyCur, formatDateLong } from '../../../helpers';

type Currency = 'USD' | 'UYU';

interface VariantRow {
	id: string;
	color_name: string | null;
	storage: string | null;
	stock: number;
}
interface ProductRow {
	id: string;
	name: string;
	variants: VariantRow[];
}

const todayISODate = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD

interface Props {
	open: boolean;
	onClose: () => void;
	// Si viene un id, el modal muestra esa venta manual (ver + eliminar).
	// Si no, muestra el formulario para crear una nueva.
	saleId?: number | null;
}

export const ManualSaleModal = ({ open, onClose, saleId }: Props) => {
	if (!open) return null;
	return (
		<div className='fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/50 p-4 backdrop-blur-sm'>
			<div className='my-8 w-full max-w-2xl rounded-2xl bg-white shadow-2xl'>
				<div className='flex items-center justify-between border-b border-ink-100 px-5 py-4'>
					<h2 className='text-lg font-bold text-ink-900'>
						{saleId ? 'Venta manual' : 'Nueva venta manual'}
					</h2>
					<button
						onClick={onClose}
						className='grid h-9 w-9 place-items-center rounded-lg text-ink-400 hover:bg-ink-100'
						aria-label='Cerrar'
					>
						<HiXMark size={20} />
					</button>
				</div>
				<div className='p-5'>
					{saleId ? (
						<ViewManualSale saleId={saleId} onClose={onClose} />
					) : (
						<CreateManualSale onClose={onClose} />
					)}
				</div>
				<style>{`.inp{width:100%;border:1px solid #d6d3d1;border-radius:0.5rem;padding:0.5rem 0.75rem;font-size:0.875rem;outline:none}.inp:focus{box-shadow:0 0 0 2px rgba(99,102,241,.3)}`}</style>
			</div>
		</div>
	);
};

/* ----------------------------- Ver / eliminar ----------------------------- */
const ViewManualSale = ({
	saleId,
	onClose,
}: {
	saleId: number;
	onClose: () => void;
}) => {
	const { data: sales = [] } = useManualSales(null);
	const deleteSale = useDeleteManualSale();
	const sale = sales.find(s => s.id === saleId);

	if (!sale) return <p className='text-sm text-ink-500'>Cargando…</p>;

	return (
		<div className='space-y-4'>
			<div className='grid grid-cols-2 gap-3 text-sm'>
				<Info label='Fecha' value={formatDateLong(sale.created_at)} />
				<Info label='Concepto' value={sale.conceptName ?? '—'} />
				<Info label='Descripción' value={sale.description || '—'} full />
			</div>

			{/* Desglose */}
			<div className='space-y-1.5 rounded-xl border border-ink-100 bg-ink-50/40 p-3 text-sm'>
				<Row label='Precio de venta' value={formatMoneyCur(sale.saleAmount, sale.currency)} strong />
				<Row label='Costo' value={`− ${formatMoneyCur(sale.cost, sale.currency)}`} />
				{sale.commission > 0 && (
					<Row label='Comisión' value={`− ${formatMoneyCur(sale.commission, sale.currency)}`} />
				)}
				{sale.shipping > 0 && (
					<Row label='Envío' value={`− ${formatMoneyCur(sale.shipping, sale.currency)}`} />
				)}
				{sale.other > 0 && (
					<Row label='Otros costos' value={`− ${formatMoneyCur(sale.other, sale.currency)}`} />
				)}
			</div>
			{sale.items.length > 0 && (
				<div>
					<p className='mb-1 text-xs font-medium text-ink-500'>
						Productos (descontaron stock)
					</p>
					<ul className='space-y-1'>
						{sale.items.map((it, idx) => (
							<li
								key={idx}
								className='rounded-lg bg-ink-50 px-3 py-1.5 text-sm text-ink-700'
							>
								<b>{it.quantity}×</b> {it.label}
							</li>
						))}
					</ul>
				</div>
			)}

			<div className='rounded-xl border border-emerald-200 bg-emerald-50/60 p-3'>
				<div className='flex items-center justify-between'>
					<span className='font-semibold text-emerald-800'>
						Ganancia neta real
					</span>
					<span className='text-lg font-bold text-emerald-700'>
						{formatMoneyCur(sale.profit, sale.currency)}
					</span>
				</div>
				<div className='mt-0.5 flex items-center justify-between text-xs text-emerald-700/70'>
					<span>Bruta (s/costo)</span>
					<span>{formatMoneyCur(sale.grossProfit, sale.currency)}</span>
				</div>
			</div>
			<div className='flex justify-end'>
				<button
					onClick={() => {
						if (confirm('¿Eliminar esta venta manual?'))
							deleteSale.mutate(sale.id, { onSuccess: onClose });
					}}
					disabled={deleteSale.isPending}
					className='inline-flex items-center gap-1.5 rounded-full border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50'
				>
					<HiOutlineTrash size={16} /> Eliminar venta
				</button>
			</div>
		</div>
	);
};

const Info = ({
	label,
	value,
	full,
}: {
	label: string;
	value: string;
	full?: boolean;
}) => (
	<div className={full ? 'col-span-2' : ''}>
		<p className='text-xs font-medium text-ink-500'>{label}</p>
		<p className='font-medium text-ink-800'>{value}</p>
	</div>
);

const Row = ({
	label,
	value,
	strong,
}: {
	label: string;
	value: string;
	strong?: boolean;
}) => (
	<div className='flex items-center justify-between'>
		<span className='text-ink-600'>{label}</span>
		<span className={strong ? 'font-semibold text-ink-900' : 'text-ink-700'}>
			{value}
		</span>
	</div>
);

/* ------------------------------- Crear venta ------------------------------- */
const CreateManualSale = ({ onClose }: { onClose: () => void }) => {
	const { data: concepts = [] } = useSaleConcepts();
	const createConcept = useCreateSaleConcept();
	const deleteConcept = useDeleteSaleConcept();
	const createSale = useCreateManualSale();
	const { data: fx } = useUsdUyuRate();

	const [conceptId, setConceptId] = useState('');
	const [description, setDescription] = useState('');
	const [currency, setCurrency] = useState<Currency>('UYU');
	const [saleAmount, setSaleAmount] = useState('');
	const [cost, setCost] = useState('');
	const [commission, setCommission] = useState('');
	const [shipping, setShipping] = useState('');
	const [other, setOther] = useState('');
	const [fxRate, setFxRate] = useState('');
	const [saleDate, setSaleDate] = useState(todayISODate());
	const [newConcept, setNewConcept] = useState('');
	const [showConcepts, setShowConcepts] = useState(false);
	const [items, setItems] = useState<ManualSaleItem[]>([]);

	const n = (s: string) => Number(s) || 0;
	const grossProfit = n(saleAmount) - n(cost);
	const profit = grossProfit - n(commission) - n(shipping) - n(other);
	const effectiveFx = currency === 'UYU' ? n(fxRate) || fx?.rate || 0 : 1;

	const handleCreate = () => {
		if (n(saleAmount) <= 0) {
			alert('Ingresá el precio de venta.');
			return;
		}
		if (currency === 'UYU' && effectiveFx <= 0) {
			alert('Falta la cotización del dólar (pesos por USD).');
			return;
		}
		createSale.mutate(
			{
				conceptId: conceptId || null,
				description,
				currency,
				saleAmount: n(saleAmount),
				cost: n(cost),
				commission: n(commission),
				shipping: n(shipping),
				other: n(other),
				fxRate: effectiveFx,
				saleDate: saleDate
					? new Date(`${saleDate}T12:00:00`).toISOString()
					: null,
				items,
			},
			{ onSuccess: onClose }
		);
	};

	const addItem = (item: ManualSaleItem) =>
		setItems(prev => [...prev, item]);
	const removeItem = (idx: number) =>
		setItems(prev => prev.filter((_, i) => i !== idx));

	return (
		<div className='space-y-4'>
			<div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
				<Field label='Concepto'>
					<div className='flex gap-2'>
						<select
							className='inp'
							value={conceptId}
							onChange={e => setConceptId(e.target.value)}
						>
							<option value=''>Sin concepto</option>
							{concepts.map(c => (
								<option key={c.id} value={c.id}>
									{c.name}
								</option>
							))}
						</select>
						<button
							type='button'
							onClick={() => setShowConcepts(v => !v)}
							className='shrink-0 rounded-lg border border-ink-300 px-3 text-sm font-semibold text-ink-600 hover:bg-ink-50'
							title='Gestionar conceptos'
						>
							{showConcepts ? 'Listo' : 'Conceptos'}
						</button>
					</div>
				</Field>
				<Field label='Fecha'>
					<input
						type='date'
						className='inp'
						value={saleDate}
						max={todayISODate()}
						onChange={e => setSaleDate(e.target.value)}
					/>
				</Field>
			</div>

			{showConcepts && (
				<div className='space-y-2 rounded-xl border border-ink-200 bg-ink-50/50 p-3'>
					<div className='flex flex-wrap gap-2'>
						{concepts.length === 0 ? (
							<span className='text-xs text-ink-400'>
								Todavía no hay conceptos.
							</span>
						) : (
							concepts.map(c => (
								<span
									key={c.id}
									className='inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-sm font-medium text-ink-700 ring-1 ring-ink-200'
								>
									{c.name}
									<button
										onClick={() => {
											if (
												confirm(
													`¿Eliminar el concepto "${c.name}"? Las ventas registradas no se borran.`
												)
											)
												deleteConcept.mutate(c.id);
										}}
										className='text-ink-400 hover:text-rose-600'
										aria-label='Eliminar concepto'
									>
										<HiOutlineTrash size={14} />
									</button>
								</span>
							))
						)}
					</div>
					<div className='flex gap-2'>
						<input
							className='inp'
							value={newConcept}
							onChange={e => setNewConcept(e.target.value)}
							placeholder='Nuevo concepto (ej: Sunfer)'
							onKeyDown={e => {
								if (e.key === 'Enter' && newConcept.trim()) {
									e.preventDefault();
									createConcept.mutate(
										{ name: newConcept },
										{ onSuccess: () => setNewConcept('') }
									);
								}
							}}
						/>
						<button
							type='button'
							onClick={() =>
								newConcept.trim() &&
								createConcept.mutate(
									{ name: newConcept },
									{ onSuccess: () => setNewConcept('') }
								)
							}
							disabled={createConcept.isPending || !newConcept.trim()}
							className='shrink-0 rounded-lg border border-ink-300 px-4 text-sm font-semibold text-ink-700 hover:bg-ink-50 disabled:opacity-50'
						>
							Agregar
						</button>
					</div>
				</div>
			)}

			<Field label='Descripción'>
				<input
					className='inp'
					value={description}
					onChange={e => setDescription(e.target.value)}
					placeholder='Qué vendiste'
				/>
			</Field>

			{/* Productos del catálogo: opcional. Si agregás, descuentan stock (RF + ML). */}
			<div className='space-y-2 rounded-xl border border-ink-200 bg-ink-50/40 p-3'>
				<p className='text-xs font-semibold uppercase tracking-wider text-ink-500'>
					Productos del catálogo (opcional — descuentan stock en RF y ML)
				</p>
				{items.length > 0 && (
					<ul className='space-y-1'>
						{items.map((it, idx) => (
							<li
								key={idx}
								className='flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-1.5 text-sm ring-1 ring-ink-200'
							>
								<span className='min-w-0 truncate text-ink-700'>
									<b>{it.quantity}×</b> {it.label}
								</span>
								<button
									type='button'
									onClick={() => removeItem(idx)}
									className='shrink-0 text-ink-400 hover:text-rose-600'
									aria-label='Quitar producto'
								>
									<HiOutlineTrash size={14} />
								</button>
							</li>
						))}
					</ul>
				)}
				<ProductPicker onAdd={addItem} />
				<p className='text-[11px] text-ink-400'>
					Si es una venta externa de algo que no tenés cargado en RF, dejalo
					vacío.
				</p>
			</div>

			<div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
				<Field label='Moneda'>
					<select
						className='inp'
						value={currency}
						onChange={e => setCurrency(e.target.value as Currency)}
					>
						<option value='UYU'>Pesos (UYU)</option>
						<option value='USD'>Dólares (USD)</option>
					</select>
				</Field>
				{currency === 'UYU' && (
					<Field label='Cotización (pesos por USD)'>
						<input
							type='number'
							className='inp'
							value={fxRate}
							min={0}
							onChange={e => setFxRate(e.target.value)}
							placeholder={
								fx?.rate ? `${fx.rate.toFixed(2)} (BCU hoy)` : 'rate'
							}
						/>
					</Field>
				)}
				<Field label={`Precio de venta (${currency})`}>
					<input
						type='number'
						className='inp'
						value={saleAmount}
						min={0}
						onChange={e => setSaleAmount(e.target.value)}
						placeholder='0'
					/>
				</Field>
				<Field label={`Costo (${currency})`}>
					<input
						type='number'
						className='inp'
						value={cost}
						min={0}
						onChange={e => setCost(e.target.value)}
						placeholder='0'
					/>
				</Field>
				<Field label={`Comisión (${currency})`}>
					<input
						type='number'
						className='inp'
						value={commission}
						min={0}
						onChange={e => setCommission(e.target.value)}
						placeholder='0'
					/>
				</Field>
				<Field label={`Envío (${currency})`}>
					<input
						type='number'
						className='inp'
						value={shipping}
						min={0}
						onChange={e => setShipping(e.target.value)}
						placeholder='0'
					/>
				</Field>
				<Field label={`Otros costos (${currency})`}>
					<input
						type='number'
						className='inp'
						value={other}
						min={0}
						onChange={e => setOther(e.target.value)}
						placeholder='0'
					/>
				</Field>
			</div>

			<div className='flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-4'>
				<div className='text-sm'>
					<p>
						Ganancia neta:{' '}
						<span
							className={`font-bold ${
								profit >= 0 ? 'text-emerald-600' : 'text-rose-600'
							}`}
						>
							{formatMoneyCur(profit, currency)}
						</span>
					</p>
					<p className='text-xs text-ink-400'>
						Bruta (s/costo): {formatMoneyCur(grossProfit, currency)}
					</p>
				</div>
				<div className='flex gap-2'>
					<button
						onClick={onClose}
						className='rounded-full border border-ink-300 px-5 py-2 text-sm font-semibold text-ink-700 hover:bg-ink-50'
					>
						Cancelar
					</button>
					<button
						onClick={handleCreate}
						disabled={createSale.isPending}
						className='rounded-full bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60'
					>
						{createSale.isPending ? 'Guardando…' : 'Registrar venta'}
					</button>
				</div>
			</div>
		</div>
	);
};

const Field = ({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) => (
	<div>
		<label className='mb-1 block text-xs font-medium text-ink-600'>
			{label}
		</label>
		{children}
	</div>
);

// Busca un producto del catálogo, elige variante y cantidad, y lo agrega a la venta.
const ProductPicker = ({ onAdd }: { onAdd: (item: ManualSaleItem) => void }) => {
	const [search, setSearch] = useState('');
	const [debounced, setDebounced] = useState('');
	const [product, setProduct] = useState<ProductRow | null>(null);
	const [variantId, setVariantId] = useState('');
	const [qty, setQty] = useState(1);

	useEffect(() => {
		const t = setTimeout(() => setDebounced(search), 350);
		return () => clearTimeout(t);
	}, [search]);

	const { data: results = [] } = useQuery({
		queryKey: ['manual-product-search', debounced],
		queryFn: async () => {
			if (debounced.trim().length < 2) return [] as ProductRow[];
			const { data } = await (supabase as any)
				.from('products')
				.select('id, name, variants(id, color_name, storage, stock)')
				.ilike('name', `%${debounced.trim()}%`)
				.limit(8);
			return (data ?? []) as ProductRow[];
		},
	});

	const variant = product?.variants.find(v => v.id === variantId) ?? null;

	const handleAdd = () => {
		if (!product || !variant || qty <= 0) return;
		const variantLabel = [variant.color_name, variant.storage]
			.filter(Boolean)
			.join(' / ');
		onAdd({
			variantId: variant.id,
			quantity: qty,
			label: [product.name, variantLabel].filter(Boolean).join(' · '),
		});
		setProduct(null);
		setVariantId('');
		setQty(1);
		setSearch('');
	};

	if (!product) {
		return (
			<div>
				<input
					className='inp'
					value={search}
					onChange={e => setSearch(e.target.value)}
					placeholder='Buscar producto por nombre…'
				/>
				{results.length > 0 && (
					<ul className='mt-1 max-h-40 overflow-auto rounded-lg border border-ink-100 bg-white text-sm'>
						{results.map(p => (
							<li key={p.id}>
								<button
									type='button'
									onClick={() => {
										setProduct(p);
										setVariantId(p.variants[0]?.id ?? '');
									}}
									className='block w-full px-3 py-1.5 text-left hover:bg-ink-50'
								>
									{p.name}
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
		);
	}

	return (
		<div className='space-y-2 rounded-lg border border-brand-200 bg-white p-2'>
			<div className='flex items-center justify-between gap-2'>
				<span className='min-w-0 truncate text-sm font-medium text-ink-800'>
					{product.name}
				</span>
				<button
					type='button'
					onClick={() => setProduct(null)}
					className='shrink-0 text-xs font-semibold text-ink-500 hover:text-ink-800'
				>
					Cambiar
				</button>
			</div>
			<div className='flex flex-wrap items-center gap-2'>
				<select
					className='inp flex-1'
					value={variantId}
					onChange={e => setVariantId(e.target.value)}
				>
					{product.variants.map(v => (
						<option key={v.id} value={v.id}>
							{[v.color_name, v.storage].filter(Boolean).join(' / ') ||
								'Única'}{' '}
							(stock {v.stock})
						</option>
					))}
				</select>
				<input
					type='number'
					min={1}
					value={qty}
					onChange={e => setQty(Math.max(1, Number(e.target.value) || 1))}
					className='inp w-20'
				/>
				<button
					type='button'
					onClick={handleAdd}
					className='inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700'
				>
					<HiOutlinePlus size={16} /> Agregar
				</button>
			</div>
		</div>
	);
};
