import { NavLink } from 'react-router-dom';
import { dashboardLinks } from '../../constants/links';
import { Logo } from '../shared/Logo';
import { IoLogOutOutline } from 'react-icons/io5';
import { signOut } from '../../actions';
import { usePaymentsEnabled } from '../../hooks';

export const Sidebar = () => {
	const { enabled: paymentsEnabled } = usePaymentsEnabled();
	const links = dashboardLinks.filter(l => paymentsEnabled || l.href !== '/dashboard/pagos');

	const handleLogout = async () => {
		await signOut();
	};

	return (
		<div className='w-[120px] bg-stone-800 text-white flex flex-col gap-10 items-center p-5 fixed h-screen lg:w-[250px]'>
			<Logo isDashboard/>

			<nav className='w-full space-y-5 flex-1'>
				{links.map(link => (
					<NavLink
						key={link.id}
						to={link.href}
						className={({ isActive }) =>
							`flex items-center justify-center gap-3 pl-0 py-3 transition-all duration-300 rounded-md ${
								isActive
									? 'text-white bg-slate-600'
									: 'hover:text-white hover:bg-slate-600'
							} lg:pl-5 lg:justify-start`
						}
					>
						{link.icon}
						<p className='font-semibold hidden lg:block'>
							{link.title}
						</p>
					</NavLink>
				))}
			</nav>

			<button
				className='bg-red-500 w-full py-[10px] rounded-md flex items-center justify-center gap-2 font-semibold text-sm hover:underline'
				onClick={handleLogout}
			>
				<span className='hidden lg:block'>Cerrar sesión</span>
				<IoLogOutOutline size={20} className='inline-block' />
			</button>
		</div>
	);
};
