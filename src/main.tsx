import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import {
	QueryClient,
	QueryClientProvider,
} from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { initPixel, pageView } from './lib/pixel';
import { getCookieConsent } from './lib/consent';

const queryClient = new QueryClient();

// Meta Pixel: init + PageView inicial, y un PageView en cada navegación del SPA.
// Sólo con las cookies aceptadas; si el visitante acepta después, lo carga el
// aviso (CookieBanner). Sin Pixel, pageView() no hace nada.
if (getCookieConsent() === 'accepted') initPixel();
let lastPixelPath = window.location.pathname + window.location.search;
router.subscribe(state => {
	const path = state.location.pathname + state.location.search;
	if (path !== lastPixelPath) {
		lastPixelPath = path;
		pageView();
	}
});

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
			<Toaster />
		</QueryClientProvider>
	</StrictMode>
);
