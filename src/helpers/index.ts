import { Color, Product, VariantProduct } from '../interfaces';
import { supabase } from '../supabase/client';

// Función para formatear el precio a dólares
export const formatPrice = (price: number) => {
	// Formato USD completamente hardcodeado
	const formatted = price.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
	return `USD ${formatted}`;
};

// Función para preparar los productos - (CELULARES)
export const prepareProducts = (products: Product[]) => {
	return products.map(product => {
		// Agrupar las variantes por color
		const colors = product.variants.reduce(
			(acc: Color[], variant: VariantProduct) => {
				const existingColor = acc.find(
					item => item.color === variant.color
				);

				if (existingColor) {
					// Si ya existe el color, comparamos los precios
					existingColor.price = Math.min(
						existingColor.price,
						variant.price
					);
				} // Mantenemos el precio mínimo
				else {
					acc.push({
						color: variant.color,
						price: variant.price,
						name: variant.color_name,
					});
				}

				return acc;
			},
			[]
		);

		// Obtener el precio más bajo de las variantes agrupadas
		const price = Math.min(...colors.map(item => item.price));

		// Devolver el producto formateado
		return {
			...product,
			price,
			colors: colors.map(({ name, color }) => ({ name, color })),
			variants: product.variants,
			brandName: (product as any).brand?.name,
			categoryName: (product as any).category?.name,
			source: (product as any).source ?? 'local',
			external_code: (product as any).external_code ?? null,
		};
	});
};

// Función para formatear la fecha a formato 3 de enero de 2022
export const formatDateLong = (date: string): string => {
	const dateObject = new Date(date);

	return dateObject.toLocaleDateString('es-ES', {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	});
};

// Función para formatear la fecha a formato dd/mm/yyyy
export const formatDate = (date: string): string => {
	const dateObject = new Date(date);
	return dateObject.toLocaleDateString('es-ES', {
		year: 'numeric',
		month: '2-digit',
		day: 'numeric',
	});
};

// Función para obtener el estado del pedido en español
export const getStatus = (status: string): string => {
	switch (status) {
		case 'Pending':
			return 'Pendiente';
		case 'Paid':
			return 'Pagado';
		case 'Shipped':
			return 'Enviado';
		case 'Delivered':
			return 'Entregado';
		default:
			return status;
	}
};

// Función para generar el slug de un producto
export const generateSlug = (name: string): string => {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/(^-|-$)/g, '');
};

// Función para generar un slug único
export const generateUniqueSlug = async (name: string, existingSlug?: string): Promise<string> => {
	let baseSlug = generateSlug(name);
	let uniqueSlug = baseSlug;
	let counter = 1;

	// Si es el mismo slug existente, no necesitamos verificar duplicados
	if (existingSlug === baseSlug) {
		return baseSlug;
	}

	// Verificar si el slug ya existe y generar uno único
	while (counter <= 100) { // Limitar a 100 intentos para evitar loops infinitos
		try {
			const { data, error } = await supabase
				.from('products')
				.select('id')
				.eq('slug', uniqueSlug)
				.single();

			// Si no hay error y hay datos, significa que el slug existe
			if (!error && data) {
				uniqueSlug = `${baseSlug}-${counter}`;
				counter++;
			} else {
				// El slug es único
				break;
			}
		} catch (error) {
			// Si hay error, significa que el slug no existe o hay un problema de conexión
			console.warn('Error checking slug uniqueness:', error);
			break;
		}
	}

	return uniqueSlug;
};

// Función para extraer el path relativo al bucket de una URL
export const extractFilePath = (url: string) => {
	// Si es una URL de placeholder o no es una URL válida de Supabase, retornar null
	if (!url || url.includes('placeholder.svg') || !url.includes('/storage/v1/object/public/product-images/')) {
		return null;
	}

	const parts = url.split(
		'/storage/v1/object/public/product-images/'
	);
	// EJEMPLO PARTS: ['/storage/v1/ object/public/product-images/', '02930920302302030293023-iphone-12-pro-max.jpg']

	if (parts.length !== 2) {
		return null;
	}

	return parts[1];
};
