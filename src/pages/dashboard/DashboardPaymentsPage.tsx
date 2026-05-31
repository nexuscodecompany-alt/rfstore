import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
	confirmManualPayment,
	getPaymentProofSignedUrl,
	getPendingPaymentOrders,
	getAppSettings,
	updateAppSetting,
} from '../../actions';
import toast from 'react-hot-toast';
import { useEffect, useState } from 'react';

interface TransferInfo {
	banco: string;
	titular: string;
	rut: string;
	moneda: string;
	cuenta_santander: string;
	sucursal_santander: string;
	cuenta_externa: string;
}
interface DepositInfo {
	abitab: string;
	redpagos: string;
	instrucciones: string;
}

export const DashboardPaymentsPage = () => {
	const queryClient = useQueryClient();

	const { data: orders = [] } = useQuery({
		queryKey: ['pending_payments'],
		queryFn: getPendingPaymentOrders,
	});
	const { data: settings } = useQuery({
		queryKey: ['app_settings'],
		queryFn: getAppSettings,
	});

	const [transfer, setTransfer] = useState<TransferInfo>({
		banco: '',
		titular: '',
		rut: '',
		moneda: 'USD',
		cuenta_santander: '',
		sucursal_santander: '',
		cuenta_externa: '',
	});
	const [deposit, setDeposit] = useState<DepositInfo>({
		abitab: '',
		redpagos: '',
		instrucciones: '',
	});

	useEffect(() => {
		if (!settings) return;
		const t = settings.get('payment_transfer_info') as TransferInfo | undefined;
		const d = settings.get('payment_deposit_info') as DepositInfo | undefined;
		if (t) setTransfer({ ...transfer, ...t });
		if (d) setDeposit({ ...deposit, ...d });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [settings]);

	const { mutate: saveTransfer } = useMutation({
		mutationFn: () => updateAppSetting('payment_transfer_info', transfer),
		onSuccess: () => toast.success('Datos de transferencia guardados'),
		onError: (e: Error) => toast.error(e.message),
	});
	const { mutate: saveDeposit } = useMutation({
		mutationFn: () => updateAppSetting('payment_deposit_info', deposit),
		onSuccess: () => toast.success('Datos de depósito guardados'),
		onError: (e: Error) => toast.error(e.message),
	});

	const { mutate: doConfirm } = useMutation({
		mutationFn: ({ id, action }: { id: number; action: 'approve' | 'reject' }) =>
			confirmManualPayment(id, action),
		onSuccess: () => {
			toast.success('Listo');
			queryClient.invalidateQueries({ queryKey: ['pending_payments'] });
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const openProof = async (path: string) => {
		try {
			const url = await getPaymentProofSignedUrl(path);
			window.open(url, '_blank');
		} catch (e) {
			toast.error((e as Error).message);
		}
	};

	return (
		<div className='flex flex-col gap-8'>
			<h1 className='text-xl font-bold'>Pagos</h1>

			<section className='p-5 bg-white border border-gray-200 rounded-lg space-y-5'>
				<h2 className='font-semibold'>Datos para transferencia bancaria</h2>
				<p className='text-xs text-gray-500'>
					Los campos que dejes vacíos no se muestran al cliente (ni en la página
					ni en el mail).
				</p>

				<div className='space-y-3'>
					<h3 className='text-xs font-semibold uppercase tracking-wider text-gray-600'>
						Datos generales
					</h3>
					<div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
						<input
							className='border rounded px-3 py-2'
							placeholder='Banco'
							value={transfer.banco}
							onChange={e => setTransfer({ ...transfer, banco: e.target.value })}
						/>
						<input
							className='border rounded px-3 py-2'
							placeholder='Titular'
							value={transfer.titular}
							onChange={e => setTransfer({ ...transfer, titular: e.target.value })}
						/>
						<input
							className='border rounded px-3 py-2'
							placeholder='RUT'
							value={transfer.rut}
							onChange={e => setTransfer({ ...transfer, rut: e.target.value })}
						/>
						<input
							className='border rounded px-3 py-2'
							placeholder='Moneda (ej. USD)'
							value={transfer.moneda}
							onChange={e => setTransfer({ ...transfer, moneda: e.target.value })}
						/>
					</div>
				</div>

				<div className='space-y-3'>
					<h3 className='text-xs font-semibold uppercase tracking-wider text-gray-600'>
						Transferencias dentro de Santander
					</h3>
					<div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
						<input
							className='border rounded px-3 py-2'
							placeholder='Cuenta (ej. 5101278354)'
							value={transfer.cuenta_santander}
							onChange={e => setTransfer({ ...transfer, cuenta_santander: e.target.value })}
						/>
						<input
							className='border rounded px-3 py-2'
							placeholder='Sucursal (ej. 84 - Biarritz)'
							value={transfer.sucursal_santander}
							onChange={e => setTransfer({ ...transfer, sucursal_santander: e.target.value })}
						/>
					</div>
				</div>

				<div className='space-y-3'>
					<h3 className='text-xs font-semibold uppercase tracking-wider text-gray-600'>
						Transferencias desde otros bancos
					</h3>
					<div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
						<input
							className='border rounded px-3 py-2'
							placeholder='Cuenta (ej. 0084005101278354)'
							value={transfer.cuenta_externa}
							onChange={e => setTransfer({ ...transfer, cuenta_externa: e.target.value })}
						/>
					</div>
				</div>

				<button
					className='px-4 py-2 bg-stone-800 text-white rounded-md'
					onClick={() => saveTransfer()}
				>
					Guardar
				</button>
			</section>

			<section className='p-5 bg-white border border-gray-200 rounded-lg space-y-3'>
				<h2 className='font-semibold'>Datos para depósito en redes</h2>
				<div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
					<input
						className='border rounded px-3 py-2'
						placeholder='Abitab (cuenta / código)'
						value={deposit.abitab}
						onChange={e => setDeposit({ ...deposit, abitab: e.target.value })}
					/>
					<input
						className='border rounded px-3 py-2'
						placeholder='Redpagos (cuenta / código)'
						value={deposit.redpagos}
						onChange={e => setDeposit({ ...deposit, redpagos: e.target.value })}
					/>
				</div>
				<textarea
					className='border rounded px-3 py-2 w-full'
					placeholder='Instrucciones para el cliente'
					rows={3}
					value={deposit.instrucciones}
					onChange={e => setDeposit({ ...deposit, instrucciones: e.target.value })}
				/>
				<button
					className='px-4 py-2 bg-stone-800 text-white rounded-md'
					onClick={() => saveDeposit()}
				>
					Guardar
				</button>
			</section>

			<section className='p-5 bg-white border border-gray-200 rounded-lg space-y-3'>
				<h2 className='font-semibold'>Órdenes con pago pendiente ({orders.length})</h2>
				{orders.length === 0 ? (
					<p className='text-sm text-gray-500'>No hay pagos pendientes.</p>
				) : (
					<table className='min-w-full text-sm'>
						<thead className='bg-gray-50 text-left'>
							<tr>
								<th className='p-2'>#</th>
								<th className='p-2'>Cliente</th>
								<th className='p-2'>Total</th>
								<th className='p-2'>Método</th>
								<th className='p-2'>Comprobante</th>
								<th className='p-2'>Acciones</th>
							</tr>
						</thead>
						<tbody>
							{orders.map(o => (
								<tr key={o.id} className='border-t'>
									<td className='p-2'>#{o.id}</td>
									<td className='p-2'>
										{o.customers?.full_name ?? '—'}
										<br />
										<span className='text-xs text-gray-500'>
											{o.customers?.email}
										</span>
									</td>
									<td className='p-2'>USD {o.total_amount}</td>
									<td className='p-2'>{o.payment_method}</td>
									<td className='p-2'>
										{o.payment_proof_url ? (
											<button
												className='text-blue-600 underline'
												onClick={() => openProof(o.payment_proof_url!)}
											>
												Ver
											</button>
										) : (
											<span className='text-gray-400'>—</span>
										)}
									</td>
									<td className='p-2 space-x-2'>
										<button
											className='px-3 py-1 bg-green-600 text-white rounded text-xs'
											onClick={() =>
												doConfirm({ id: o.id, action: 'approve' })
											}
										>
											Aprobar
										</button>
										<button
											className='px-3 py-1 bg-red-600 text-white rounded text-xs'
											onClick={() =>
												doConfirm({ id: o.id, action: 'reject' })
											}
										>
											Rechazar
										</button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</section>
		</div>
	);
};
