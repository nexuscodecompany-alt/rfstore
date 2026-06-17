import { TableOrdersAdmin } from '../../components/dashboard';
import { Loader } from '../../components/shared/Loader';
import { useAllOrders } from '../../hooks';

export const DashboardOrdersPage = () => {
	const { data, isLoading } = useAllOrders();

	if (isLoading || !data) return <Loader />;

	// Los checkouts de MP sin pagar no son ventas: los contamos aparte.
	const unpaid = data.filter(
		o => o.payment_method === 'mercadopago' && o.payment_status !== 'paid'
	).length;
	const real = data.length - unpaid;

	return (
		<div className='space-y-5'>
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

			<TableOrdersAdmin orders={data} />
		</div>
	);
};
