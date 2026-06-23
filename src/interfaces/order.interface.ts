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
	total_original?: number | null;
	ml_currency?: 'USD' | 'UYU' | string | null;
	fx_rate?: number | null;
	created_at: string;
	channel?: string | null;
	ml_order_id?: string | null;
	ml_pack_id?: string | null;
	payment_method?: string | null;
	payment_status?: string | null;
	concept_id?: string | null;
	manual_description?: string | null;
	sale_concepts?: { name: string } | null;
	customers: {
		full_name: string;
		email: string;
	} | null;
}
