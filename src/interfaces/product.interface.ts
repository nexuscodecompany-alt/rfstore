import { JSONContent } from '@tiptap/react';
import { Json } from '../supabase/supabase';

export interface Color {
	name: string;
	color: string;
	price: number;
}

export interface VariantProduct {
	id: string;
	stock: number;
	price: number;
	storage: string;
	color: string;
	color_name: string;
}

export interface ProductBrand {
	id: string;
	name: string;
}

export interface ProductCategory {
	id: string;
	name: string;
}

export interface Product {
	id: string;
	name: string;
	slug: string;
	features: string[];
	description: Json;
	images: string[];
	created_at: string;
	variants: VariantProduct[];
	brand_id: string;
	category_id: string;
	brand?: ProductBrand | null;
	category?: ProductCategory | null;
	source?: 'local' | 'cdr';
	external_code?: string | null;
	price_usd?: number | null;
	markup_percent?: number | null;
}

export interface PreparedProducts {
	id: string;
	name: string;
	slug: string;
	features: string[];
	description: Json;
	images: string[];
	created_at: string;
	price: number;
	colors: {
		name: string;
		color: string;
	}[];
	variants: VariantProduct[];
	brandName?: string;
	categoryName?: string;
	source?: 'local' | 'cdr';
	external_code?: string | null;
}

export interface ProductInput {
	name: string;
	slug: string;
	features: string[];
	description: JSONContent;
	images: File[];
	variants: VariantInput[];
	brandId: string;
	categoryId: string;
}

export interface VariantInput {
	id?: string;
	stock: number;
	price: number;
	color: string;
	storage: string;
	colorName: string;
}
