import { useState } from 'react';
import { HiOutlinePlus } from 'react-icons/hi2';
import { TableOrdersAdmin, ManualSaleModal } from '../../components/dashboard';
import { Loader } from '../../components/shared/Loader';
import { useAllOrders, useSaleConcepts } from '../../hooks';

export const DashboardOrdersPage = () => {
	const { data, isLoading } = useAllOrders();
	const { data: concepts = [] } = useSaleConcepts();

	// Modal de venta manual: null = cerrado; 'new' = crear; número = ver/eliminar.
	const [modal, setModal] = useState<'new' | number | null>(null);
	const [filterConcept, setFilterConcept] = useState('');

	if (isLoading || !data) return <Loader />;

	// Filtro por concepto: muestra solo las ventas manuales de ese concepto.
	const filtered = filterConcept
		? data.filter(
				o => o.channel === 'manual' && o.concept_id === filterConcept
		  )
		: data;

	// Los checkouts de MP sin pagar no son ventas: los contamos aparte.
	const unpaid = filtered.filter(
		o => o.payment_method === 'mercadopago' && o.payment_status !== 'paid'
	).length;
	// Una venta ML en carrito (varias órdenes con el mismo ml_pack_id) cuenta como
	// UNA sola venta, igual que se ve agrupada en la tabla.
	const realOrders = filtered.filter(
		o => !(o.payment_method === 'mercadopago' && o.payment_status !== 'paid')
	);
	const packs = new Set<string>();
	let real = 0;
	for (const o of realOrders) {
		if (o.channel === 'ml' && o.ml_pack_id) {
			if (packs.has(o.ml_pack_id)) continue;
			packs.add(o.ml_pack_id);
		}
		real += 1;
	}

	return (
		<div className='space-y-5'>
			<div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
				<div>
					<h1 className='text-2xl font-bold text-ink-900'>Órdenes</h1>
					<p className='text-sm text-ink-500'>
						{real} {real === 1 ? 'orden' : 'órdenes'}
						{unpaid > 0 && (
							<span className='text-ink-400'>
								{' '}· {unpaid} checkout{unpaid === 1 ? '' : 's'} sin pagar
							</span>
						)}
					</p>
				</div>

				<div className='flex flex-wrap items-center gap-2'>
					{concepts.length > 0 && (
						<select
							value={filterConcept}
							onChange={e => setFilterConcept(e.target.value)}
							className='rounded-lg border border-ink-300 px-3 py-2 text-sm text-ink-700 outline-none focus:ring-2 focus:ring-brand-300'
							title='Filtrar ventas manuales por concepto'
						>
							<option value=''>Todas las órdenes</option>
							{concepts.map(c => (
								<option key={c.id} value={c.id}>
									Concepto: {c.name}
								</option>
							))}
						</select>
					)}
					<button
						onClick={() => setModal('new')}
						className='inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700'
					>
						<HiOutlinePlus size={18} /> Venta manual
					</button>
				</div>
			</div>

			<TableOrdersAdmin orders={filtered} onManualClick={id => setModal(id)} />

			<ManualSaleModal
				open={modal !== null}
				saleId={typeof modal === 'number' ? modal : null}
				onClose={() => setModal(null)}
			/>
		</div>
	);
};
