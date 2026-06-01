import { JSONContent } from '@tiptap/react';
import { z } from 'zod';

export const userRegisterSchema = z.object({
	email: z.string().email('El correo electrónico no es válido'),
	password: z
		.string()
		.min(6, 'La contraseña debe tener al menos 6 caracteres'),
	fullName: z.string().min(1, 'El nombre completo es requerido'),
	phone: z.string().optional(),
});

export const addressSchema = z.object({
	addressLine1: z
		.string()
		.min(1, 'La dirección es requerida')
		.max(100, 'La dirección no debe exceder los 100 carácteres'),
	addressLine2: z
		.string()
		.max(100, 'La dirección no debe exceder los 100 carácteres')
		.optional(),
	city: z
		.string()
		.min(1, 'La ciudad es requerida')
		.max(50, 'La ciudad no debe exceder los 50 carácteres'),
	state: z
		.string()
		.min(1, 'El estado es requerido')
		.max(50, 'El estado no debe exceder los 50 carácteres'),
	postalCode: z
		.string()
		.max(10, 'El código postal no debe exceder los 10 carácteres')
		.optional(),
	country: z.string().min(1, 'El país es requerido'),
});

export type UserRegisterFormValues = z.infer<
	typeof userRegisterSchema
>;
export type AddressFormValues = z.infer<typeof addressSchema>;

const isContentEmpty = (value: JSONContent): boolean => {
	if (
		!value ||
		!Array.isArray(value.content) ||
		value.content.length == 0
	) {
		return true;
	}

	return !value.content.some(node => {
		// Nodo "html" que usan los productos sincronizados de CDR.
		if (
			node.type === 'html' &&
			typeof (node as { html?: string }).html === 'string' &&
			(node as { html?: string }).html!.trim() !== ''
		) {
			return true;
		}

		return (
			node.type === 'paragraph' &&
			node.content &&
			Array.isArray(node.content) &&
			node.content.some(
				textNode =>
					textNode.type === 'text' &&
					textNode.text &&
					textNode.text.trim() !== ''
			)
		);
	});
};

export const productSchema = z.object({
	name: z.string().min(1, 'El nombre del producto es obligatorio'),
	slug: z
		.string()
		.min(1, 'El slug del producto es obligatorio')
		.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug inválido'),
	brandId: z.string().min(1, 'La marca es obligatoria'),
	categoryId: z.string().min(1, 'La categoría es obligatoria'),
	subcategoryId: z.string().optional(),
	features: z.array(
		z.object({
			value: z
				.string()
				.min(1, 'La característica no puede estar vacía'),
		})
	),
	description: z.custom<JSONContent>(
		value => !isContentEmpty(value),
		{ message: 'La descripción no puede estar vacía' }
	),
	// Las variantes se eliminaron del UI: cada producto tiene un único set de
	// precio + stock. Internamente seguimos guardándolo en la tabla `variants`
	// con placeholders en color/storage/color_name para no romper el modelo de
	// datos existente (order_items, place_order, sync CDR, reserva de stock).
	variants: z
		.array(
			z.object({
				id: z.string().optional(),
				stock: z.number().min(0, 'El stock no puede ser negativo'),
				price: z.number().min(0.01, 'El precio debe ser mayor a 0'),
				storage: z.string().optional().default(''),
				color: z.string().optional().default('#000000'),
				colorName: z.string().optional().default('Único'),
			})
		)
		.length(1, 'Debe haber un único precio + stock'),
	images: z.array(z.any()).min(1, 'Debe haber al menos una imagen'),
});

export type ProductFormValues = z.infer<typeof productSchema>;