import { Outlet, useLocation } from 'react-router-dom';
import { Navbar } from '../components/shared/Navbar';
import { Footer } from '../components/shared/Footer';
import { Banner } from '../components/home/Banner';
import { Newsletter } from '../components/home/Newsletter';
import { Sheet } from '../components/shared/Sheet';
import { useGlobalStore } from '../store/global.store';
import { NavbarMobile } from '../components/shared/NavbarMobile';
import { ScrollToTop } from '../components/shared/ScrollToTop';

export const RootLayout = () => {
	const { pathname } = useLocation();

	const isSheetOpen = useGlobalStore(state => state.isSheetOpen);
	const activeNavMobile = useGlobalStore(
		state => state.activeNavMobile
	);

	return (
		<div className='min-h-screen flex flex-col font-montserrat bg-white text-ink-900'>
			<ScrollToTop />
			<Navbar />

			{pathname === '/' && <Banner />}

			<main className='container my-8 flex-1'>
				<Outlet />
			</main>

			{pathname === '/' && <Newsletter />}

			{isSheetOpen && <Sheet />}

			{activeNavMobile && <NavbarMobile />}

			<Footer />
		</div>
	);
};
