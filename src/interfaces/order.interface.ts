export interface OrderInput {
	address: {
		addressLine1: string;
		addressLine2?: string;
		city: string;
		state: string;
		postalCode?: string;
		country: string;
	};
	cartItems: {
		variantId: string;
		quantity: number;
		price: number;
	}[];
	totalAmount: number;
}

export interface OrderItemSingle {
	created_at: string;
	id: number;
	status: string;
	total_amount: number;
}

export interface OrderWithCustomer {
	id: number;
	status: string;
	total_amount: number;
	created_at: string;
	channel?: string | null;
	ml_order_id?: string | null;
	payment_method?: string | null;
	payment_status?: string | null;
	customers: {
		full_name: string;
		email: string;
	} | null;
}
