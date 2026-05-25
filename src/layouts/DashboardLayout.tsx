import { Outlet, useNavigate } from 'react-router-dom';
import { Sidebar } from '../components/dashboard';
import { useUser } from '../hooks';
import { useEffect, useState } from 'react';
import { getSession, getUserRole } from '../actions';
import { Loader } from '../components/shared/Loader';
import { supabase } from '../supabase/client';
import { ScrollToTop } from '../components/shared/ScrollToTop';
import { HiBars3, HiXMark } from 'react-icons/hi2';

export const DashboardLayout = () => {
	const navigate = useNavigate();

	const { isLoading, session } = useUser();
	const [roleLoading, setRoleLoading] = useState(true);
	const [drawerOpen, setDrawerOpen] = useState(false);

	useEffect(() => {
		const checkRole = async () => {
			setRoleLoading(true);
			const session = await getSession();
			if (!session) {
				navigate('/login');
			}

			const role = await getUserRole(session.session?.user.id as string);

			if (role !== 'admin') {
				navigate('/', { replace: true });
			}

			setRoleLoading(false);
		};

		checkRole();

		supabase.auth.onAuthStateChange(async (event, session) => {
			if (event === 'SIGNED_OUT' || !session) {
				navigate('/login', { replace: true });
			}
		});
	}, [navigate]);

	if (isLoading || !session || roleLoading) return <Loader />;

	return (
		<div className='min-h-screen bg-ink-50 font-montserrat text-ink-800'>
			<ScrollToTop />

			{/* Sidebar fijo en desktop */}
			<aside className='fixed inset-y-0 left-0 z-30 hidden w-[260px] lg:block'>
				<Sidebar />
			</aside>

			{/* Topbar móvil */}
			<header className='sticky top-0 z-20 flex items-center justify-between border-b border-ink-200 bg-white/90 px-4 py-3 backdrop-blur-md lg:hidden'>
				<button
					onClick={() => setDrawerOpen(true)}
					className='grid h-10 w-10 place-items-center rounded-lg text-ink-700 hover:bg-ink-100'
					aria-label='Abrir menú'
				>
					<HiBars3 size={24} />
				</button>
				<span className='text-sm font-bold tracking-tight text-ink-900'>
					Panel de administración
				</span>
				<div className='w-10' />
			</header>

			{/* Drawer móvil */}
			{drawerOpen && (
				<div className='fixed inset-0 z-40 lg:hidden'>
					<div
						className='absolute inset-0 bg-ink-950/60 backdrop-blur-sm'
						onClick={() => setDrawerOpen(false)}
					/>
					<div className='absolute inset-y-0 left-0 w-[270px] max-w-[80%] animate-slide-in-left shadow-2xl'>
						<button
							onClick={() => setDrawerOpen(false)}
							className='absolute right-3 top-4 z-10 grid h-9 w-9 place-items-center rounded-lg text-ink-300 hover:bg-white/10 hover:text-white'
							aria-label='Cerrar menú'
						>
							<HiXMark size={22} />
						</button>
						<Sidebar onNavigate={() => setDrawerOpen(false)} />
					</div>
				</div>
			)}

			{/* Contenido */}
			<main className='lg:pl-[260px]'>
				<div className='mx-auto max-w-[1400px] p-4 sm:p-6 lg:p-8'>
					<Outlet />
				</div>
			</main>
		</div>
	);
};
