import { useParams, Link } from 'react-router-dom';
import { useLegalPages } from '../hooks/settings/useLegalPages';
import { Loader } from '../components/shared/Loader';

const isHeading = (line: string) =>
	/^(SECCIÓN|VISIÓN|POLÍTICA|CAPÍTULO)\b/i.test(line.trim());

export const LegalPage = () => {
	const { slug } = useParams<{ slug: string }>();
	const { data, isLoading } = useLegalPages();

	if (isLoading) return <Loader />;

	const page = slug ? data?.[slug] : undefined;

	if (!page) {
		return (
			<div className='container py-24 text-center'>
				<h1 className='text-2xl font-bold text-ink-900'>
					Documento no encontrado
				</h1>
				<p className='mt-2 text-ink-500'>
					Esta página legal todavía no está disponible.
				</p>
				<Link
					to='/'
					className='mt-6 inline-block rounded-full bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-700'
				>
					Volver al inicio
				</Link>
			</div>
		);
	}

	const lines = page.content.split('\n');

	return (
		<div className='container max-w-3xl py-12 lg:py-16'>
			<div className='mb-8 border-b border-ink-200 pb-6'>
				<p className='section-eyebrow'>Legal</p>
				<h1 className='mt-2 text-3xl font-bold tracking-tight text-ink-900'>
					{page.title}
				</h1>
			</div>

			<div className='space-y-3 text-[15px] leading-relaxed text-ink-600'>
				{lines.map((line, i) => {
					const t = line.trim();
					if (!t) return <div key={i} className='h-2' />;
					if (isHeading(t))
						return (
							<h2
								key={i}
								className='pt-5 text-base font-bold uppercase tracking-wide text-ink-900'
							>
								{t}
							</h2>
						);
					return <p key={i}>{t}</p>;
				})}
			</div>
		</div>
	);
};
