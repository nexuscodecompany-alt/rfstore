import { OrderInput } from '../interfaces';
import { supabase } from '../supabase/client';

export const createOrder = async (order: OrderInput) => {
	// La creación de la orden (validación de stock, dirección, items y descuento
	// de stock) se hace de forma atómica en el servidor vía la función place_order,
	// que corre con privilegios y resuelve el cliente a partir del usuario autenticado.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { data, error } = await (supabase as any).rpc('place_order', {
		p_items: order.cartItems.map(item => ({
			variant_id: item.variantId,
			quantity: item.quantity,
			price: item.price,
		})),
		p_total: order.totalAmount,
		p_address: {
			address_line1: order.address.addressLine1,
			address_line2: order.address.addressLine2 ?? null,
			city: order.address.city,
			state: order.address.state,
			postal_code: order.address.postalCode ?? null,
			country: order.address.country,
		},
	});

	if (error) {
		console.log(error);
		throw new Error(error.message || 'No se pudo crear la orden');
	}

	return { id: data as number };
};

export const getOrdersByCustomerId = async () => {
	const { data, error } = await supabase.auth.getUser();

	if (error) {
		console.log(error);
		throw new Error('No se pudo obtener el usuario');
	}

	if (!data.user) {
		throw new Error('Usuario no autenticado');
	}

	const userId = data.user.id;

	const { data: customer, error: customerError } = await supabase
		.from('customers')
		.select('id')
		.eq('user_id', userId)
		.single();

	if (customerError) {
		console.log(customerError);
		throw new Error('No se pudo obtener el cliente');
	}

	const customerId = customer.id;

	const { data: orders, error: ordersError } = await supabase
		.from('orders')
		.select('id, total_amount, status, created_at')
		.eq('customer_id', customerId)
		.order('created_at', { ascending: false });

	if (ordersError) throw new Error(ordersError.message);

	return orders;
};

export const getOrderById = async (orderId: number) => {
	const { data, error: errorUser } = await supabase.auth.getUser();

	if (errorUser) {
		console.log(errorUser);
		throw new Error('No se pudo obtener la sesión');
	}

	if (!data.user) {
		throw new Error('Usuario no autenticado');
	}

	const { data: customer, error: customerError } = await supabase
		.from('customers')
		.select('id')
		.eq('user_id', data.user.id)
		.single();

	if (customerError) {
		console.log(customerError);
		throw new Error('No se pudo obtener el cliente');
	}

	const customerId = customer.id;

	const { data: order, error } = await supabase
		.from('orders')
		.select(
			`
				id, total_amount, status, created_at, payment_method, payment_status,
				addresses:addresses(*),
				order_items:order_items(quantity, price, variants(color_name, storage, products(name, images)))
			`
		)
		.eq('id', orderId)
		.eq('customer_id', customerId)
		.single();

	if (error) {
		console.log(error);
		throw new Error(error.message);
	}

	return {
		id: order.id,
		orderItems: order.order_items.map(item => ({
			productImage: item.variants?.products?.images?.[0] || '',
			productName: item.variants?.products?.name || '',
			price: item.price,
			quantity: item.quantity,
			color_name: item.variants ? item.variants.color_name : '',
			storage: item.variants ? item.variants.storage : '',
		})),
		totalAmount: order.total_amount,
		status: order.status,
		paymentMethod: order.payment_method as string | null,
		paymentStatus: order.payment_status as string,
		created_at: order.created_at,
		address: {
			addressLine1: order.addresses.address_line1,
			addressLine2: order.addresses.address_line2,
			city: order.addresses.city,
			state: order.addresses.state,
			postalCode: order.addresses.postal_code,
			country: order.addresses.country,
		},
		customer: {
			full_name: data.user.user_metadata.full_name,
			email: data.user.email || '',
		},
	};
};

/* ********************************** */
/*            ADMINISTRADOR           */
/* ********************************** */
export const getAllOrders = async () => {
	const { data, error } = await supabase
		.from('orders')
		.select('id, total_amount, status, created_at, customers(full_name, email)')
		.order('created_at', { ascending: false });

	if (error) throw new Error(error.message);

	return data;
};

export const updateOrderStatus = async ({
	id,
	status,
}: {
	id: number;
	status: string;
}) => {
	const { error } = await supabase
		.from('orders')
		.update({ status })
		.eq('id', id);

	if (error) throw new Error(error.message);
};

export const getOrderByIdAdmin = async (id: number) => {
	const { data: order, error } = await supabase
		.from('orders')
		.select(
			`
				id, total_amount, status, created_at,
				addresses:addresses(*),
				order_items:order_items(quantity, price, variants(color_name, storage, products(name, images))),
				customers:customers(full_name, email)
			`
		)
		.eq('id', id)
		.single();

	if (error) throw new Error(error.message);

	return {
		id: order.id,
		orderItems: order.order_items.map(item => ({
			productImage: item.variants?.products?.images?.[0] || '',
			productName: item.variants?.products?.name || '',
			price: item.price,
			quantity: item.quantity,
			color_name: item.variants ? item.variants.color_name : '',
			storage: item.variants ? item.variants.storage : '',
		})),
		totalAmount: order.total_amount,
		status: order.status,
		created_at: order.created_at,
		address: {
			addressLine1: order.addresses.address_line1,
			addressLine2: order.addresses.address_line2,
			city: order.addresses.city,
			state: order.addresses.state,
			postalCode: order.addresses.postal_code,
			country: order.addresses.country,
		},
		customer: {
			full_name: order.customers?.full_name || '',
			email: order.customers?.email || '',
		},
	};
};
