import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
	getCookieConsent,
	onOpenCookieBanner,
	setCookieConsent,
	PRIVACY_PATH,
	type CookieConsent,
} from '../../lib/consent';
import { initPixel } from '../../lib/pixel';

/**
 * Aviso de cookies. Aparece hasta que el visitante elige; "Aceptar" carga el
 * Pixel de Meta en el momento, "Rechazar" no carga nada. Si cambia de idea
 * desde el pie ("Preferencias de cookies") y pasa de aceptar a rechazar, se
 * recarga la página para que el Pixel ya cargado deje de correr.
 */
export const CookieBanner = () => {
	const [open, setOpen] = useState(() => getCookieConsent() === null);

	useEffect(() => onOpenCookieBanner(() => setOpen(true)), []);

	if (!open) return null;

	const choose = (v: CookieConsent) => {
		const before = getCookieConsent();
		setCookieConsent(v);
		setOpen(false);
		if (v === 'accepted') initPixel();
		else if (before === 'accepted') window.location.reload();
	};

	return (
		<div
			role='dialog'
			aria-label='Aviso de cookies'
			className='fixed inset-x-0 bottom-0 z-[60] p-4 sm:bottom-4 sm:left-4 sm:right-auto sm:max-w-md'
		>
			<div className='rounded-2xl border border-ink-200 bg-white p-5 shadow-card'>
				<p className='text-sm font-semibold text-ink-900'>Usamos cookies</p>
				<p className='mt-1.5 text-sm leading-relaxed text-ink-600'>
					Las necesarias para que la tienda funcione, y si nos dejás, las de Meta
					para medir nuestros anuncios. Podés cambiarlo cuando quieras desde el pie
					de página.{' '}
					<Link to={PRIVACY_PATH} className='font-medium text-ink-900 underline'>
						Ver política de privacidad
					</Link>
				</p>
				<div className='mt-4 flex gap-2'>
					<button
						onClick={() => choose('rejected')}
						className='flex-1 rounded-full border border-ink-300 px-4 py-2.5 text-sm font-semibold text-ink-800 transition-colors hover:bg-ink-50'
					>
						Rechazar
					</button>
					<button
						onClick={() => choose('accepted')}
						className='flex-1 rounded-full bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-ink-800'
					>
						Aceptar
					</button>
				</div>
			</div>
		</div>
	);
};
