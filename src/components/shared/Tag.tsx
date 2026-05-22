type TagType = 'nuevo' | 'agotado';

interface Props {
	contentTag: TagType;
}

const styles: Record<TagType, string> = {
	nuevo: 'bg-brand-600 text-white shadow-glow-brand',
	agotado: 'bg-ink-900/90 text-white backdrop-blur',
};

export const Tag = ({ contentTag }: Props) => {
	return (
		<div className={`w-fit px-2.5 py-1 rounded-md ${styles[contentTag] ?? 'bg-ink-500 text-white'}`}>
			<p className='uppercase text-[10px] font-bold tracking-wider'>{contentTag}</p>
		</div>
	);
};
