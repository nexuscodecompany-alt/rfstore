import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { navbarLinks } from '../../constants/links';
import {
	HiOutlineSearch,
	HiOutlineShoppingBag,
	HiOutlineUser,
	HiOutlineLogout,
} from 'react-icons/hi';
import { HiOutlineClipboardDocumentList, HiOutlineSquares2X2 } from 'react-icons/hi2';
import { FaBarsStaggered } from 'react-icons/fa6';
import { Logo } from './Logo';
import { useGlobalStore } from '../../store/global.store';
import { useCartStore } from '../../store/cart.store';
import { useCustomer, useUser, useRoleUser } from '../../hooks';
import { LuLoader2 } from 'react-icons/lu';
import { signOut } from '../../actions';
import toast from 'react-hot-toast';

export const Navbar = () => {
	const openSheet = useGlobalStore(state => state.openSheet);
	const totalItemsInCart = useCartStore(state => state.totalItemsInCart);
	const setActiveNavMobile = useGlobalStore(state => state.setActiveNavMobile);
	const { session, isLoading } = useUser();
	const navigate = useNavigate();

	const userId = session?.user.id;
	const { data: customer } = useCustomer(userId!);
	const { data: role } = useRoleUser(userId ?? '');

	const [scrolled, setScrolled] = useState(false);
	const [profileOpen, setProfileOpen] = useState(false);
	const profileRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const onScroll = () => setScrolled(window.scrollY > 8);
		onScroll();
		window.addEventListener('scroll', onScroll, { passive: true });
		return () => window.removeEventListener('scroll', onScroll);
	}, []);

	useEffect(() => {
		const onClickOutside = (e: MouseEvent) => {
			if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
				setProfileOpen(false);
			}
		};
		document.addEventListener('mousedown', onClickOutside);
		return () => document.removeEventListener('mousedown', onClickOutside);
	}, []);

	const onSignOut = async () => {
		try {
			await signOut();
			setProfileOpen(false);
			toast.success('Sesión cerrada');
			navigate('/');
		} catch (e) {
			toast.error((e as Error).message);
		}
	};

	const fullName = customer?.full_name ?? '';
	const email = customer?.email ?? session?.user.email ?? '';
	const initial = fullName ? fullName[0]?.toUpperCase() : email[0]?.toUpperCase() ?? '?';
	const isAdmin = role === 'admin';

	return (
		<header
			className={`sticky top-0 z-40 transition-all duration-300 ${
				scrolled
					? 'bg-white/80 backdrop-blur-md border-b border-ink-200/70 shadow-soft'
					: 'bg-white border-b border-transparent'
			}`}
		>
			<div className='flex items-center justify-between px-5 py-3.5 lg:px-12'>
				<Logo />

				<nav className='space-x-1 hidden md:flex'>
					{navbarLinks.map(link => (
						<NavLink
							key={link.id}
							to={link.href}
							className={({ isActive }) =>
								`px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-200 ${
									isActive
										? 'text-brand-700 bg-brand-50'
										: 'text-ink-700 hover:text-brand-700 hover:bg-brand-50/60'
								}`
							}
						>
							{link.title}
						</NavLink>
					))}
				</nav>

				<div className='flex gap-2 items-center'>
					<button
						onClick={() => openSheet('search')}
						className='p-2 rounded-md text-ink-700 hover:text-brand-700 hover:bg-brand-50/60 transition-all'
						aria-label='Buscar'
					>
						<HiOutlineSearch size={22} />
					</button>

					{isLoading ? (
						<div className='p-2'>
							<LuLoader2 className='animate-spin text-brand-600' size={22} />
						</div>
					) : session ? (
						<div className='relative ml-1' ref={profileRef}>
							<button
								onClick={() => setProfileOpen(o => !o)}
								className='grid place-items-center w-9 h-9 rounded-full bg-gradient-to-br from-brand-600 to-brand-700 text-white text-sm font-bold shadow-soft hover:shadow-glow-brand transition-all'
								aria-label='Mi cuenta'
								aria-expanded={profileOpen}
							>
								{initial}
							</button>

							{profileOpen && (
								<div className='absolute right-0 top-11 w-64 bg-white border border-ink-200 rounded-xl shadow-2xl py-2 animate-fade-in z-50'>
									<div className='px-4 py-3 border-b border-ink-100'>
										<p className='text-sm font-semibold text-ink-900 truncate'>
											{fullName || 'Mi cuenta'}
										</p>
										<p className='text-xs text-ink-500 truncate'>{email}</p>
										{isAdmin && (
											<span className='inline-block mt-1.5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-brand-50 text-brand-700 rounded'>
												Admin
											</span>
										)}
									</div>
									<Link
										to='/account/pedidos'
										onClick={() => setProfileOpen(false)}
										className='flex items-center gap-3 px-4 py-2.5 text-sm text-ink-700 hover:bg-brand-50 transition-colors'
									>
										<HiOutlineClipboardDocumentList size={18} />
										Mis pedidos
									</Link>
									{isAdmin && (
										<Link
											to='/dashboard'
											onClick={() => setProfileOpen(false)}
											className='flex items-center gap-3 px-4 py-2.5 text-sm text-ink-700 hover:bg-brand-50 transition-colors'
										>
											<HiOutlineSquares2X2 size={18} />
											Panel admin
										</Link>
									)}
									<div className='border-t border-ink-100 mt-1 pt-1'>
										<button
											onClick={onSignOut}
											className='flex items-center gap-3 px-4 py-2.5 text-sm text-rose-600 hover:bg-rose-50 transition-colors w-full text-left'
										>
											<HiOutlineLogout size={18} />
											Cerrar sesión
										</button>
									</div>
								</div>
							)}
						</div>
					) : (
						<Link
							to='/login'
							className='p-2 rounded-md text-ink-700 hover:text-brand-700 hover:bg-brand-50/60 transition-all'
							aria-label='Iniciar sesión'
						>
							<HiOutlineUser size={22} />
						</Link>
					)}

					<button
						className='relative p-2 rounded-md text-ink-700 hover:text-brand-700 hover:bg-brand-50/60 transition-all'
						onClick={() => openSheet('cart')}
						aria-label='Carrito'
					>
						{totalItemsInCart > 0 && (
							<span className='absolute top-0 right-0 min-w-[18px] h-[18px] grid place-items-center px-1 bg-gradient-to-br from-brand-600 to-brand-700 text-white text-[10px] font-bold rounded-full ring-2 ring-white shadow-soft'>
								{totalItemsInCart}
							</span>
						)}
						<HiOutlineShoppingBag size={22} />
					</button>

					<button
						className='md:hidden ml-1 p-2 rounded-md text-ink-700 hover:bg-ink-100 transition-all'
						onClick={() => setActiveNavMobile(true)}
						aria-label='Menú'
					>
						<FaBarsStaggered size={20} />
					</button>
				</div>
			</div>
		</header>
	);
};
