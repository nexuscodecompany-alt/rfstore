import { NavLink } from 'react-router-dom';
import { dashboardLinks } from '../../constants/links';
import { Logo } from '../shared/Logo';
import { IoLogOutOutline } from 'react-icons/io5';
import { signOut } from '../../actions';
import { usePaymentsEnabled } from '../../hooks';

interface Props {
	onNavigate?: () => void;
}

export const Sidebar = ({ onNavigate }: Props) => {
	const { enabled: paymentsEnabled } = usePaymentsEnabled();
	const links = dashboardLinks.filter(
		l => paymentsEnabled || l.href !== '/dashboard/pagos'
	);

	const handleLogout = async () => {
		await signOut();
	};

	return (
		<div className='flex h-full w-full flex-col gap-8 bg-ink-900 px-4 py-6 text-ink-300'>
			<div className='flex items-center justify-center px-2'>
				<Logo isDashboard />
			</div>

			<nav className='flex-1 space-y-1.5'>
				{links.map(link => (
					<NavLink
						key={link.id}
						to={link.href}
						end={link.href === '/dashboard'}
						onClick={onNavigate}
						className={({ isActive }) =>
							`group flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200 ${
								isActive
									? 'bg-gradient-to-r from-brand-600 to-brand-700 text-white shadow-glow-brand'
									: 'text-ink-300 hover:bg-white/5 hover:text-white'
							}`
						}
					>
						<span className='shrink-0'>{link.icon}</span>
						<span>{link.title}</span>
					</NavLink>
				))}
			</nav>

			<button
				className='flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-3 text-sm font-semibold text-ink-200 transition-all hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-300'
				onClick={handleLogout}
			>
				<IoLogOutOutline size={20} />
				<span>Cerrar sesión</span>
			</button>
		</div>
	);
};
