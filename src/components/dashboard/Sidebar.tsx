import { NavLink, useLocation } from 'react-router-dom';
import { dashboardLinks, type DashboardLink } from '../../constants/links';
import { Logo } from '../shared/Logo';
import { IoLogOutOutline } from 'react-icons/io5';
import { HiChevronDown } from 'react-icons/hi2';
import { signOut } from '../../actions';
import { usePaymentsEnabled, useAdminNotifications } from '../../hooks';

interface Props {
	onNavigate?: () => void;
}

const itemClass = (isActive: boolean) =>
	`group flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200 ${
		isActive
			? 'bg-gradient-to-r from-brand-600 to-brand-700 text-white shadow-glow-brand'
			: 'text-ink-300 hover:bg-white/5 hover:text-white'
	}`;

export const Sidebar = ({ onNavigate }: Props) => {
	const { enabled: paymentsEnabled } = usePaymentsEnabled();
	const { unreadCount } = useAdminNotifications();
	const { pathname } = useLocation();

	// Con la pasarela apagada, Pagos no tiene nada que configurar.
	const visibleChildren = (link: DashboardLink) =>
		(link.children ?? []).filter(
			c => paymentsEnabled || c.href !== '/dashboard/pagos'
		);

	// Un grupo está abierto cuando estás parado en cualquiera de sus hijos. No hay
	// estado que recordar: al entrar a una sección, su grupo ya se ve desplegado.
	const isGroupOpen = (link: DashboardLink) =>
		visibleChildren(link).some(
			c => pathname === c.href || pathname.startsWith(`${c.href}/`)
		) || pathname.startsWith(`${link.href}/`);

	const handleLogout = async () => {
		await signOut();
	};

	return (
		<div className='flex h-full w-full flex-col gap-8 bg-ink-900 px-4 py-6 text-ink-300'>
			<div className='flex items-center justify-center px-2'>
				<Logo isDashboard />
			</div>

			<nav className='flex-1 space-y-1.5'>
				{dashboardLinks.map(link => {
					const children = visibleChildren(link);

					// --- Ítem simple ---
					if (children.length === 0) {
						const showBadge =
							link.href === '/dashboard/cdr' && unreadCount > 0;
						return (
							<NavLink
								key={link.id}
								to={link.href}
								end={link.href === '/dashboard'}
								onClick={onNavigate}
								className={({ isActive }) => itemClass(isActive)}
							>
								<span className='shrink-0'>{link.icon}</span>
								<span className='flex-1'>{link.title}</span>
								{showBadge && (
									<span className='inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-rose-500 text-white text-[10px] font-bold ring-2 ring-ink-900'>
										{unreadCount > 99 ? '99+' : unreadCount}
									</span>
								)}
							</NavLink>
						);
					}

					// --- Grupo con hijos ---
					const open = isGroupOpen(link);
					return (
						<div key={link.id}>
							<NavLink
								to={children[0].href}
								onClick={onNavigate}
								className={() => itemClass(open)}
							>
								<span className='shrink-0'>{link.icon}</span>
								<span className='flex-1'>{link.title}</span>
								<HiChevronDown
									size={16}
									className={`shrink-0 transition-transform duration-200 ${
										open ? 'rotate-180' : 'opacity-50'
									}`}
								/>
							</NavLink>

							{open && (
								<div className='mt-1 space-y-0.5 border-l border-white/10 pl-3 ml-6'>
									{children.map(child => (
										<NavLink
											key={child.id}
											to={child.href}
											end={child.end}
											onClick={onNavigate}
											className={({ isActive }) =>
												`block rounded-lg px-3 py-2 text-[13px] transition-colors ${
													isActive
														? 'bg-white/10 font-semibold text-white'
														: 'text-ink-400 hover:bg-white/5 hover:text-white'
												}`
											}
										>
											{child.title}
										</NavLink>
									))}
								</div>
							)}
						</div>
					);
				})}
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
