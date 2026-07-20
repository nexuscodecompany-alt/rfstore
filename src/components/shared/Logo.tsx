import { Link } from 'react-router-dom';

interface Props {
	isDashboard?: boolean;
}

export const Logo = ({ isDashboard }: Props) => {
	return (
		<Link
			to='/'
			className={`inline-flex items-center transition-all ${
				isDashboard ? 'hover:scale-105' : ''
			}`}
			aria-label='RF Store'
		>
			{/* Logo RF blanco sobre negro. mix-blend-screen vuelve transparente el
			    fondo negro para que se funda con el header/sidebar oscuros. */}
			<img
				src='/img/img-docs/logonegrorf.jpg'
				alt='RF Store'
				className='h-16 w-16 object-contain mix-blend-screen'
			/>
		</Link>
	);
};
