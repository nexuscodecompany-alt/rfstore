import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
	HiOutlineShoppingBag,
	HiOutlineUser,
	HiOutlineLogout,
} from 'react-icons/hi';
import { HiOutlineClipboardDocumentList, HiOutlineSquares2X2 } from 'react-icons/hi2';
import { FaBarsStaggered } from 'react-icons/fa6';
import { FaWhatsapp } from 'react-icons/fa';
import { Logo } from './Logo';
import { TopBar } from './TopBar';
import { HeaderSearch } from './HeaderSearch';
import { CategoryBar } from './CategoryBar';
import { useGlobalStore } from '../../store/global.store';
import { useCartStore } from '../../store/cart.store';
import { useCustomer, useUser, useRoleUser } from '../../hooks';
import { LuLoader2 } from 'react-icons/lu';
import { signOut } from '../../actions';
import toast from 'react-hot-toast';

const WHATSAPP_URL = `https://wa.me/59894116299?text=${encodeURIComponent(
	'Hola, quería hacer una consulta.'
)}`;

export const Navbar = () => {
	const openSheet = useGlobalStore(state => state.openSheet);
	const totalItemsInCart = useCartStore(state => state.totalItemsInCart);
	const setActiveNavMobile = useGlobalStore(state => state.setActiveNavMobile);
	const { session, isLoading } = useUser();
	const navigate = useNavigate();

	const userId = session?.user.id;
	const { data: customer } = useCustomer(userId!);
	const { data: role } = useRoleUser(userId ?? '');

	const [profileOpen, setProfileOpen] = useState(false);
	const profileRef = useRef<HTMLDivElement | null>(null);

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
		<header className='z-40'>
			<TopBar />

			{/* Bloque sticky: fila principal + barra de categorías (siempre visibles) */}
			<div className='sticky top-0 z-40 border-b border-white/10 bg-ink-950 shadow-soft'>
				{/* Fila principal */}
				<div className='flex items-center gap-4 px-4 py-3 lg:px-10'>
					<Logo />

					{/* Buscador central (desktop) */}
					<div className='hidden flex-1 justify-center md:flex'>
						<HeaderSearch />
					</div>

					<div className='ml-auto flex items-center gap-1.5'>
						{isLoading ? (
							<div className='p-2'>
								<LuLoader2 className='animate-spin text-brand-600' size={22} />
							</div>
						) : session ? (
							<div className='relative' ref={profileRef}>
								<button
									onClick={() => setProfileOpen(o => !o)}
									className='flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-white/10'
									aria-label='Mi cuenta'
									aria-expanded={profileOpen}
								>
									<span className='grid h-8 w-8 place-items-center rounded-full bg-brand-900 text-sm font-bold text-white shadow-soft ring-2 ring-white'>
										{initial}
									</span>
									<span className='hidden text-sm font-medium text-white/80 lg:inline'>
										Mi cuenta
									</span>
								</button>

								{profileOpen && (
									<div className='absolute right-0 top-12 z-50 w-64 animate-fade-in rounded-xl border border-ink-200 bg-white py-2 shadow-2xl'>
										<div className='border-b border-ink-100 px-4 py-3'>
											<p className='truncate text-sm font-semibold text-ink-900'>
												{fullName || 'Mi cuenta'}
											</p>
											<p className='truncate text-xs text-ink-500'>{email}</p>
											{isAdmin && (
												<span className='mt-1.5 inline-block rounded bg-brand-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-700'>
													Admin
												</span>
											)}
										</div>
										<Link
											to='/account/perfil'
											onClick={() => setProfileOpen(false)}
											className='flex items-center gap-3 px-4 py-2.5 text-sm text-ink-700 transition-colors hover:bg-brand-50'
										>
											<HiOutlineUser size={18} />
											Mi perfil
										</Link>
										<Link
											to='/account/pedidos'
											onClick={() => setProfileOpen(false)}
											className='flex items-center gap-3 px-4 py-2.5 text-sm text-ink-700 transition-colors hover:bg-brand-50'
										>
											<HiOutlineClipboardDocumentList size={18} />
											Mis pedidos
										</Link>
										{isAdmin && (
											<Link
												to='/dashboard'
												onClick={() => setProfileOpen(false)}
												className='flex items-center gap-3 px-4 py-2.5 text-sm text-ink-700 transition-colors hover:bg-brand-50'
											>
												<HiOutlineSquares2X2 size={18} />
												Panel admin
											</Link>
										)}
										<div className='mt-1 border-t border-ink-100 pt-1'>
											<button
												onClick={onSignOut}
												className='flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-rose-600 transition-colors hover:bg-rose-50'
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
								className='flex items-center gap-1.5 rounded-md px-2.5 py-2 text-sm font-medium text-white/80 transition-all hover:text-white'
								aria-label='Iniciar sesión'
							>
								<HiOutlineUser size={22} />
								<span className='hidden lg:inline'>Ingresar</span>
							</Link>
						)}

						<button
							className='relative rounded-md p-2 text-white/80 transition-all hover:bg-white/10 hover:text-white'
							onClick={() => openSheet('cart')}
							aria-label='Carrito'
						>
							{totalItemsInCart > 0 && (
								<span className='absolute right-0 top-0 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-gradient-to-br from-brand-600 to-brand-700 px-1 text-[10px] font-bold text-white shadow-soft ring-2 ring-white'>
									{totalItemsInCart}
								</span>
							)}
							<HiOutlineShoppingBag size={22} />
						</button>

						<a
							href={WHATSAPP_URL}
							target='_blank'
							rel='noopener noreferrer'
							className='hidden h-9 w-9 place-items-center rounded-full bg-[#25D366] text-white shadow-soft transition-transform hover:scale-105 sm:grid'
							aria-label='WhatsApp'
						>
							<FaWhatsapp size={20} />
						</a>

						<button
							className='ml-0.5 rounded-md p-2 text-white/80 transition-all hover:bg-white/10 md:hidden'
							onClick={() => setActiveNavMobile(true)}
							aria-label='Menú'
						>
							<FaBarsStaggered size={20} />
						</button>
					</div>
				</div>

				{/* Buscador (mobile) */}
				<div className='px-4 pb-3 md:hidden'>
					<HeaderSearch />
				</div>

				{/* Barra de categorías con mega-menú */}
				<CategoryBar />
			</div>
		</header>
	);
};
