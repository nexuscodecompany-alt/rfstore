import { EditorContent, JSONContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect } from 'react';
import { Json } from '../../supabase/supabase';

interface Props {
	content: JSONContent | Json;
}

// Los productos sincronizados desde CDR guardan la descripción como
// { type: 'doc', content: [{ type: 'html', html: '<...>' }] }. Ese nodo "html"
// no existe en el StarterKit de Tiptap, así que lo extraemos como string HTML:
// Tiptap parsea el HTML y conserva solo los nodos conocidos (sanitiza el resto).
const normalizeContent = (content: JSONContent | Json): JSONContent | string => {
	const node = content as { content?: Array<{ type?: string; html?: string }> };
	const first = node?.content?.[0];
	if (first?.type === 'html') {
		return first.html ?? '';
	}
	return content as JSONContent;
};

export const ProductDescription = ({ content }: Props) => {
	const editor = useEditor({
		extensions: [StarterKit],
		content: normalizeContent(content),
		editable: false,
		editorProps: {
			attributes: {
				class: 'prose prose-sm sm:prose-base max-w-none',
			},
		},
	});

	// Tiptap solo aplica el contenido al inicializar; al navegar entre productos
	// la página no se remonta, así que refrescamos el contenido manualmente.
	useEffect(() => {
		if (editor) {
			editor.commands.setContent(normalizeContent(content));
		}
	}, [content, editor]);

	return (
		<div className='mt-12'>
			<h2 className='text-2xl font-bold text-center mb-8 underline'>
				Descripción
			</h2>
			<EditorContent editor={editor} />
		</div>
	);
};
