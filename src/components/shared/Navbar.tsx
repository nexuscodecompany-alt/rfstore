import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { navbarLinks } from '../../constants/links';
import {
	HiOutlineSearch,
	HiOutlineShoppingBag,
	HiOutlineUser,
} from 'react-icons/hi';
import { FaBarsStaggered } from 'react-icons/fa6';
import { Logo } from './Logo';
import { useGlobalStore } from '../../store/global.store';
import { useCartStore } from '../../store/cart.store';
import { useCustomer, useUser } from '../../hooks';
import { LuLoader2 } from 'react-icons/lu';

export const Navbar = () => {
	const openSheet = useGlobalStore(state => state.openSheet);
	const totalItemsInCart = useCartStore(state => state.totalItemsInCart);
	const setActiveNavMobile = useGlobalStore(state => state.setActiveNavMobile);
	const { session, isLoading } = useUser();

	const userId = session?.user.id;
	const { data: customer } = useCustomer(userId!);

	const [scrolled, setScrolled] = useState(false);

	useEffect(() => {
		const onScroll = () => setScrolled(window.scrollY > 8);
		onScroll();
		window.addEventListener('scroll', onScroll, { passive: true });
		return () => window.removeEventListener('scroll', onScroll);
	}, []);

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
						<Link
							to='/account'
							className='ml-1 grid place-items-center w-9 h-9 rounded-full bg-gradient-to-br from-brand-600 to-brand-700 text-white text-sm font-bold shadow-soft hover:shadow-glow-brand transition-all'
						>
							{customer && customer.full_name[0]?.toUpperCase()}
						</Link>
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
