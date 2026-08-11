import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { HiOutlineTrash, HiOutlinePlus } from 'react-icons/hi2';
import {
	getPurchases,
	receivePurchase,
	searchProductsForPurchase,
	type ProductStockOption,
} from '../../actions/purchases';
import { getSuppliers } from '../../actions';
import { useUsdUyuRate } from '../../hooks';
import { Link } from 'react-router-dom';
import { formatMoney } from '../../helpers';

// Un renglón de la compra: un producto del catálogo, o un concepto suelto
// (embalaje, un servicio) que no mueve stock pero suma al costo.
interface Line {
	key: string;
	product: ProductStockOption | null;
	description: string;
	quantity: number;
	unitCost: number;
}

export const DashboardPurchasesPage = () => {
	const qc = useQueryClient();
	const { data: fx } = useUsdUyuRate();

	const [supplierId, setSupplierId] = useState('');
	const [invoice, setInvoice] = useState('');
	const [purchasedAt, setPurchasedAt] = useState(
		new Date().toISOString().slice(0, 10)
	);
	const [currency, setCurrency] = useState<'USD' | 'UYU'>('USD');
	const [fxRate, setFxRate] = useState('');
	const [freight, setFreight] = useState('');
	const [taxes, setTaxes] = useState('');
	const [notes, setNotes] = useState('');
	const [lines, setLines] = useState<Line[]>([]);

	const [term, setTerm] = useState('');
	const [options, setOptions] = useState<ProductStockOption[]>([]);
	const [searching, setSearching] = useState(false);

	const { data: purchases = [] } = useQuery({
		queryKey: ['purchases'],
		queryFn: getPurchases,
	});
	const { data: suppliers = [] } = useQuery({
		queryKey: ['suppliers'],
		queryFn: getSuppliers,
	});

	// Buscador sobre TODO el catálogo: el producto ya existe (vino de CDR o lo
	// cargaron a mano) y la compra sólo le suma stock del depósito.
	useEffect(() => {
		if (term.trim().length < 2) {
			setOptions([]);
			return;
		}
		setSearching(true);
		const t = setTimeout(async () => {
			try {
				setOptions(await searchProductsForPurchase(term));
			} catch (e) {
				console.warn(e);
			} finally {
				setSearching(false);
			}
		}, 350);
		return () => clearTimeout(t);
	}, [term]);

	const addLine = (opt: ProductStockOption) => {
		if (lines.some(l => l.product?.variant_id === opt.variant_id)) return;
		setLines(prev => [
			...prev,
			{
				key: opt.variant_id,
				product: opt,
				description: '',
				quantity: 1,
				unitCost: opt.avg_cost_usd ?? opt.price ?? 0,
			},
		]);
		setTerm('');
		setOptions([]);
	};

	// Renglón sin producto: para lo que no va al catálogo (flete de un envío
	// puntual, embalaje, un service). Suma al costo de la compra y nada más.
	const addFreeLine = () =>
		setLines(prev => [
			...prev,
			{
				key: `libre-${prev.length}-${prev.reduce((a, l) => a + l.quantity, 0)}`,
				product: null,
				description: '',
				quantity: 1,
				unitCost: 0,
			},
		]);

	const goodsTotal = useMemo(
		() => lines.reduce((acc, l) => acc + l.quantity * l.unitCost, 0),
		[lines]
	);
	const effectiveFx = currency === 'UYU' ? Number(fxRate) || fx?.rate || 0 : 1;
	const goodsUsd = effectiveFx > 0 ? goodsTotal / effectiveFx : 0;
	const extrasUsd = (Number(freight) || 0) + (Number(taxes) || 0);
	const totalUsd = goodsUsd + extrasUsd;

	const supplierName =
		suppliers.find(x => x.id === supplierId)?.name ?? '';

	const { mutate: save, isPending } = useMutation({
		mutationFn: () =>
			receivePurchase({
				supplierId: supplierId || null,
				supplier: supplierName,
				invoiceNumber: invoice,
				purchasedAt,
				currency,
				fxRate: currency === 'UYU' ? effectiveFx : null,
				freightUsd: Number(freight) || 0,
				taxesUsd: Number(taxes) || 0,
				notes,
				items: lines.map(l => ({
					variant_id: l.product?.variant_id ?? null,
					quantity: l.quantity,
					unit_cost: l.unitCost,
					description: l.product ? undefined : l.description,
				})),
			}),
		onSuccess: id => {
			toast.success(`Compra #${id} recibida: el stock ya está actualizado`);
			setLines([]);
			setInvoice('');
			setFreight('');
			setTaxes('');
			setNotes('');
			qc.invalidateQueries({ queryKey: ['purchases'] });
			qc.invalidateQueries({ queryKey: ['admin-products'] });
			qc.invalidateQueries({ queryKey: ['products'] });
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const canSave =
		!isPending &&
		!!supplierId &&
		lines.length > 0 &&
		lines.every(
			l => l.quantity > 0 && l.unitCost >= 0 && (l.product || l.description.trim())
		) &&
		(currency === 'USD' || effectiveFx > 0);

	return (
		<div className='space-y-6'>
			<div>
				<h1 className='text-2xl font-bold text-ink-900'>Compras de stock</h1>
				<p className='text-sm text-ink-500'>
					Mercadería propia: al recibir una compra sube el stock, se recalcula el
					costo promedio de cada producto y queda registrado el movimiento. Sólo
					aparecen los productos marcados como <b>propio</b> o <b>ambos</b> en su
					ficha (los dropship los maneja CDR).
				</p>
			</div>

			<section className='space-y-4 rounded-2xl border border-ink-200 bg-white p-5'>
				<h2 className='text-base font-bold text-ink-900'>Nueva compra</h2>

				<div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
					<Field label='Proveedor'>
						<select
							className='inp'
							value={supplierId}
							onChange={e => setSupplierId(e.target.value)}
						>
							<option value=''>Elegí el proveedor…</option>
							{suppliers.map(sup => (
								<option key={sup.id} value={sup.id}>
									{sup.name}
								</option>
							))}
						</select>
						{suppliers.length === 0 && (
							<p className='mt-1 text-xs text-amber-700'>
								No hay proveedores cargados.{' '}
								<Link
									to='/dashboard/taxonomias'
									className='font-semibold underline'
								>
									Cargalos acá
								</Link>
								.
							</p>
						)}
					</Field>
					<Field label='Factura / remito'>
						<input
							className='inp'
							value={invoice}
							onChange={e => setInvoice(e.target.value)}
							placeholder='Opcional'
						/>
					</Field>
					<Field label='Fecha'>
						<input
							type='date'
							className='inp'
							value={purchasedAt}
							onChange={e => setPurchasedAt(e.target.value)}
						/>
					</Field>
					<Field label='Moneda de la compra'>
						<select
							className='inp'
							value={currency}
							onChange={e => setCurrency(e.target.value as 'USD' | 'UYU')}
						>
							<option value='USD'>USD</option>
							<option value='UYU'>Pesos (UYU)</option>
						</select>
					</Field>
					{currency === 'UYU' && (
						<Field label='Cotización (pesos por USD)'>
							<input
								type='number'
								className='inp'
								value={fxRate}
								onChange={e => setFxRate(e.target.value)}
								placeholder={fx?.rate ? `${fx.rate.toFixed(2)} (BROU hoy)` : 'rate'}
							/>
						</Field>
					)}
					<Field label='Flete (USD)'>
						<input
							type='number'
							className='inp'
							value={freight}
							onChange={e => setFreight(e.target.value)}
							placeholder='0'
						/>
					</Field>
					<Field label='Impuestos / gastos (USD)'>
						<input
							type='number'
							className='inp'
							value={taxes}
							onChange={e => setTaxes(e.target.value)}
							placeholder='0'
						/>
					</Field>
					<Field label='Notas'>
						<input
							className='inp'
							value={notes}
							onChange={e => setNotes(e.target.value)}
							placeholder='Opcional'
						/>
					</Field>
				</div>

				{/* Buscador de productos */}
				<div className='relative'>
					<div className='flex flex-wrap items-end justify-between gap-2'>
						<label className='text-xs font-semibold text-ink-600'>
							Agregar producto del catálogo (buscá por nombre o código)
						</label>
						<button
							type='button'
							onClick={addFreeLine}
							className='text-xs font-semibold text-brand-700 hover:underline'
						>
							+ Agregar un renglón sin producto (embalaje, servicio…)
						</button>
					</div>
					<input
						className='inp mt-1'
						value={term}
						onChange={e => setTerm(e.target.value)}
						placeholder='Ej: aspiradora deerma…'
					/>
					{term.trim().length >= 2 && (
						<ul className='absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-ink-200 bg-white shadow-xl'>
							{searching && (
								<li className='px-3 py-2 text-sm text-ink-400'>Buscando…</li>
							)}
							{!searching && options.length === 0 && (
								<li className='px-3 py-2 text-sm text-ink-400'>
									Sin resultados. El producto tiene que existir primero: cargalo
									en Productos (o esperá a que lo traiga el sync de CDR).
								</li>
							)}
							{options.map(o => (
								<li key={o.variant_id}>
									<button
										type='button'
										onClick={() => addLine(o)}
										className='flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-brand-50'
									>
										<span className='min-w-0 flex-1 truncate'>
											{o.name}
											{o.external_code && (
												<span className='ml-1 font-mono text-[10px] text-ink-400'>
													{o.external_code}
												</span>
											)}
										</span>
										<span className='shrink-0 text-xs text-ink-400'>
											propio {o.owned_stock}
											{o.cdr_stock != null ? ` · CDR ${o.cdr_stock}` : ''}
										</span>
									</button>
								</li>
							))}
						</ul>
					)}
				</div>

				{/* Líneas */}
				{lines.length > 0 && (
					<div className='overflow-x-auto rounded-xl border border-ink-200'>
						<table className='min-w-full text-sm'>
							<thead className='bg-ink-50 text-left text-xs uppercase text-ink-500'>
								<tr>
									<th className='p-2'>Producto</th>
									<th className='p-2 w-24'>Cantidad</th>
									<th className='p-2 w-32'>Costo unit. ({currency})</th>
									<th className='p-2 w-28 text-right'>Subtotal</th>
									<th className='p-2 w-10'></th>
								</tr>
							</thead>
							<tbody>
								{lines.map((l, i) => (
									<tr key={l.key} className='border-t border-ink-100'>
										<td className='p-2'>
											{l.product ? (
												<>
													<p className='font-medium text-ink-800'>
														{l.product.name}
													</p>
													<p className='text-xs text-ink-400'>
														Hoy: {l.product.owned_stock} propio
														{l.product.cdr_stock != null
															? ` · ${l.product.cdr_stock} en CDR`
															: ''}{' '}
														→ quedará {l.product.owned_stock + l.quantity} propio
													</p>
												</>
											) : (
												<>
													<input
														className='inp'
														placeholder='Concepto (ej: embalaje, service…)'
														value={l.description}
														onChange={e =>
															setLines(prev =>
																prev.map((x, j) =>
																	j === i
																		? { ...x, description: e.target.value }
																		: x
																)
															)
														}
													/>
													<p className='mt-0.5 text-xs text-ink-400'>
														Sin producto: suma al costo, no mueve stock.
													</p>
												</>
											)}
										</td>
										<td className='p-2'>
											<input
												type='number'
												min={1}
												className='inp'
												value={l.quantity}
												onChange={e =>
													setLines(prev =>
														prev.map((x, j) =>
															j === i
																? { ...x, quantity: Number(e.target.value) || 0 }
																: x
														)
													)
												}
											/>
										</td>
										<td className='p-2'>
											<input
												type='number'
												min={0}
												step='0.01'
												className='inp'
												value={l.unitCost}
												onChange={e =>
													setLines(prev =>
														prev.map((x, j) =>
															j === i
																? { ...x, unitCost: Number(e.target.value) || 0 }
																: x
														)
													)
												}
											/>
										</td>
										<td className='p-2 text-right font-semibold'>
											{(l.quantity * l.unitCost).toFixed(2)}
										</td>
										<td className='p-2'>
											<button
												type='button'
												onClick={() =>
													setLines(prev => prev.filter((_, j) => j !== i))
												}
												className='text-rose-600 hover:text-rose-800'
												aria-label='Quitar'
											>
												<HiOutlineTrash size={18} />
											</button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}

				<div className='flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-3'>
					<div className='text-sm text-ink-600'>
						Mercadería: <b>{formatMoney(goodsUsd)}</b> · Flete e impuestos:{' '}
						<b>{formatMoney(extrasUsd)}</b> · Total:{' '}
						<span className='text-lg font-bold text-ink-900'>
							{formatMoney(totalUsd)}
						</span>
					</div>
					<button
						type='button'
						disabled={!canSave}
						onClick={() => save()}
						className='inline-flex items-center gap-2 rounded-lg bg-ink-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50'
					>
						<HiOutlinePlus size={18} />
						{isPending ? 'Recibiendo…' : 'Recibir compra y sumar stock'}
					</button>
				</div>
				<p className='text-xs text-ink-400'>
					El flete y los impuestos se reparten entre los renglones según cuánto
					pesa cada uno en la compra, así el costo de cada unidad queda con todo
					incluido. Si comprás stock de un producto que hoy despacha CDR, pasa a
					<b> ambos</b>: se venden primero tus unidades y, cuando se terminan,
					sigue el stock de CDR.
				</p>
			</section>

			<section className='space-y-3'>
				<h2 className='text-base font-bold text-ink-900'>Compras recibidas</h2>
				<div className='overflow-x-auto rounded-2xl border border-ink-200 bg-white'>
					<table className='min-w-full text-sm'>
						<thead className='bg-ink-50 text-left text-xs uppercase text-ink-500'>
							<tr>
								<th className='p-3'>Fecha</th>
								<th className='p-3'>Proveedor</th>
								<th className='p-3'>Productos</th>
								<th className='p-3 text-right'>Total</th>
							</tr>
						</thead>
						<tbody>
							{purchases.map(p => (
								<tr key={p.id} className='border-t border-ink-100'>
									<td className='p-3 text-ink-600'>
										{new Date(p.purchased_at).toLocaleDateString('es-UY')}
									</td>
									<td className='p-3'>
										<p className='font-medium text-ink-900'>{p.supplier}</p>
										{p.invoice_number && (
											<p className='text-xs text-ink-400'>{p.invoice_number}</p>
										)}
									</td>
									<td className='p-3 text-xs text-ink-600'>
										{(p.purchase_items ?? [])
											.map(
												it =>
													`${it.variants?.products?.name ?? 'Producto'} x${it.quantity}`
											)
											.join(' · ')}
									</td>
									<td className='p-3 text-right font-semibold'>
										{formatMoney(Number(p.total_usd) || 0)}
									</td>
								</tr>
							))}
							{purchases.length === 0 && (
								<tr>
									<td colSpan={4} className='p-6 text-center text-ink-400'>
										Todavía no cargaste ninguna compra.
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			</section>

			<style>{`.inp{width:100%;border:1px solid #d6d3d1;border-radius:0.5rem;padding:0.5rem 0.75rem;font-size:0.875rem;outline:none;background:#fff}.inp:focus{box-shadow:0 0 0 2px rgba(37,99,235,.25)}`}</style>
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
	<label className='block'>
		<span className='text-xs font-semibold text-ink-600'>{label}</span>
		<div className='mt-1'>{children}</div>
	</label>
);
