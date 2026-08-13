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
	subcategory_id?: string | null;
	brand?: ProductBrand | null;
	category?: ProductCategory | null;
	source?: 'local' | 'cdr';
	external_code?: string | null;
	/**
	 * Producto manual habilitado para compra online (carrito + pasarela). Los
	 * productos CDR se venden online siempre; los manuales sólo si el admin
	 * prendió esta bandera, si no van por "Consultar por WhatsApp".
	 */
	online_payment?: boolean;
	/** De dónde sale la unidad: dropship (CDR) | propio (depósito RF) | ambos. */
	fulfillment?: 'dropship' | 'propio' | 'ambos';
	price_usd?: number | null;
	markup_percent?: number | null;
	/**
	 * Margen manual (%) fijado por el admin para este producto. Si tiene valor,
	 * pisa el margen por tramo (y los overrides por categoría en ML): rige tanto
	 * en la web como en Mercado Libre. Null/undefined = margen automático.
	 */
	margin_override_percent?: number | null;
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
	online_payment?: boolean;
	/** Margen manual del producto (ver Product.margin_override_percent). */
	margin_override_percent?: number | null;
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
	subcategoryId?: string | null;
	/** Compra online habilitada (productos manuales). */
	onlinePayment?: boolean;
	fulfillment?: 'dropship' | 'propio' | 'ambos';
	/**
	 * Margen manual (%) del producto. `null` = automático por tramo.
	 * `undefined` = no tocar lo que ya esté guardado.
	 */
	marginOverride?: number | null;
}

export interface VariantInput {
	id?: string;
	stock: number;
	price: number;
	color: string;
	storage: string;
	colorName: string;
}
