import { TableOrdersAdmin } from '../../components/dashboard';
import { Loader } from '../../components/shared/Loader';
import { useAllOrders } from '../../hooks';

export const DashboardOrdersPage = () => {
	const { data, isLoading } = useAllOrders();

	if (isLoading || !data) return <Loader />;

	return (
		<div className='space-y-5'>
			<div>
				<h1 className='text-2xl font-bold text-ink-900'>Órdenes</h1>
				<p className='text-sm text-ink-500'>
					{data.length}{' '}
					{data.length === 1 ? 'pedido registrado' : 'pedidos registrados'}
				</p>
			</div>

			<TableOrdersAdmin orders={data} />
		</div>
	);
};
