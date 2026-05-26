import {
	EditorContent,
	JSONContent,
	useEditor,
	type Editor as EditorType,
} from '@tiptap/react';
import { FieldErrors, UseFormSetValue } from 'react-hook-form';
import { ProductFormValues } from '../../../lib/validators';
import StarterKit from '@tiptap/starter-kit';
import { ReactNode, useEffect } from 'react';

interface Props {
	setValue: UseFormSetValue<ProductFormValues>;
	errors: FieldErrors<ProductFormValues>;
	initialContent?: JSONContent;
}

// Los productos de CDR guardan la descripción como un nodo { type: 'html', html }.
// Tiptap no lo entiende, así que extraemos el HTML como string para que lo parsee.
const normalizeContent = (content?: JSONContent): JSONContent | string => {
	const first = content?.content?.[0] as { type?: string; html?: string } | undefined;
	if (first?.type === 'html') {
		return first.html ?? '';
	}
	return content ?? '';
};

export const MenuBar = ({
	editor,
}: {
	editor: EditorType | null;
}) => {
	const buttonClass = (isActive: boolean) =>
		`w-8 h-7 grid place-items-center  border text-sm rounded transition-all ${
			isActive
				? 'border-blue-500 bg-blue-100 text-blue-700'
				: 'border-gray-300 bg-white text-gray-600 hover:bg-gray-100'
		}`;

	if (!editor) {
		return null;
	}

	return (
		<div className='flex flex-wrap gap-3'>
			<button
				onClick={() =>
					editor.chain().focus().toggleHeading({ level: 1 }).run()
				}
				className={buttonClass(
					editor.isActive('heading', { level: 1 })
				)}
				type='button'
			>
				H1
			</button>

			<button
				onClick={() =>
					editor.chain().focus().toggleHeading({ level: 2 }).run()
				}
				className={buttonClass(
					editor.isActive('heading', { level: 2 })
				)}
				type='button'
			>
				H2
			</button>

			<button
				onClick={() =>
					editor.chain().focus().toggleHeading({ level: 3 }).run()
				}
				className={buttonClass(
					editor.isActive('heading', { level: 3 })
				)}
				type='button'
			>
				H3
			</button>

			<button
				onClick={() => editor.chain().focus().toggleBold().run()}
				className={buttonClass(editor.isActive('bold'))}
				type='button'
			>
				N
			</button>

			<button
				onClick={() => editor.chain().focus().toggleItalic().run()}
				className={buttonClass(editor.isActive('italic'))}
				type='button'
			>
				K
			</button>

			<button
				onClick={() => editor.chain().focus().toggleStrike().run()}
				className={buttonClass(editor.isActive('strike'))}
				type='button'
			>
				S
			</button>
		</div>
	);
};

export const Editor = ({
	setValue,
	errors,
	initialContent,
}: Props) => {
	const editor = useEditor({
		extensions: [StarterKit],
		content: normalizeContent(initialContent),
		onUpdate: ({ editor }) => {
			// Aquí actualizamos el valor del campo 'description.content en el formulario
			const content = editor.getJSON();
			setValue('description', content, { shouldValidate: true });
		},
		editorProps: {
			attributes: {
				class:
					'focus:outline-none min-h-[150px] prose prose-sm sm:prose-base',
			},
		},
	});

	useEffect(() => {
		if (initialContent && editor) {
			editor.commands.setContent(normalizeContent(initialContent));
		}
	}, [initialContent, editor]);

	return (
		<div className='space-y-3'>
			<MenuBar editor={editor} />

			<EditorContent editor={editor} />

			{errors.description && (
				<p className='text-red-500 text-xs mt-1'>
					{(errors.description.message as ReactNode) ||
						'Debe escribir una descripción'}
				</p>
			)}
		</div>
	);
};
