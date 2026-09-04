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
	 * Margen manual (%) de la WEB (RF Store). Si tiene valor pisa el margen por
	 * tramo. Null/undefined = automático.
	 */
	margin_override_percent?: number | null;
	/**
	 * Margen manual (%) de MERCADO LIBRE, independiente del de la web: en ML se
	 * vende más caro para cubrir la comisión. Null/undefined = regla ML automática.
	 */
	ml_margin_override_percent?: number | null;

	/**
	 * Datos crudos del WS de CDR v2.0 (ver docs/cdr/README.md). Son lo que dice el
	 * proveedor, no decisiones nuestras: `cdr_marca` sugiere la marca pero el
	 * `brand_id` manda, y `cdr_categoria` es la jerarquía de CDR, no la nuestra.
	 * Todos opcionales: CDR omite la clave entera cuando el dato no está cargado.
	 */
	cdr_marca?: string | null;
	/** Sitio genérico de la marca. */
	cdr_marca_url?: string | null;
	/** Ficha del producto puntual en el fabricante. Puede quedar caída si lo discontinúan. */
	cdr_fabricante_url?: string | null;
	cdr_categoria?: string | null;
	/** Texto de venta preparado por CDR. Viene en el 12,7 % del catálogo. */
	cdr_descripcion_comercial?: string | null;
	/** Precio sugerido por CDR para la web. NULL = sin sugerido (CDR manda 0, que NO es gratis). */
	cdr_pvp_usd?: number | null;
	/** Sugerido para ML: más alto que el de la web porque absorbe la comisión. */
	cdr_pvpml_usd?: number | null;
	/** Cuándo se refrescaron por última vez estos campos desde el WS. */
	cdr_fields_updated_at?: string | null;
	/** Texto libre: "1 año", "6 meses", "90 días contra defecto de fabricación". */
	cdr_garantia?: string | null;
	cdr_garantia_url?: string | null;
	cdr_modelo?: string | null;
	/** NO identifica al producto: varias variantes comparten el mismo (doc 7.4). */
	cdr_gtin?: string | null;
	cdr_nro_parte?: string | null;
	cdr_peso_gramos?: number | null;
	cdr_ancho_cm?: number | null;
	cdr_alto_cm?: number | null;
	cdr_profundidad_cm?: number | null;
	/** false = CDR despublicó el producto. No lo desactiva solo. */
	cdr_habilitado?: boolean | null;
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
	 * Margen manual (%) de la web. `null` = automático por tramo.
	 * `undefined` = no tocar lo que ya esté guardado.
	 */
	marginOverride?: number | null;
	/** Ídem para Mercado Libre (independiente del de la web). */
	mlMarginOverride?: number | null;
}

export interface VariantInput {
	id?: string;
	stock: number;
	price: number;
	color: string;
	storage: string;
	colorName: string;
}
