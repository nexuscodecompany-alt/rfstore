/* ======================================================================= */
/*  Consentimiento de cookies.                                              */
/*                                                                          */
/*  La única cookie que no es necesaria para comprar es la del Pixel de     */
/*  Meta (medición de anuncios). Se carga SÓLO si el visitante acepta; si   */
/*  rechaza o todavía no eligió, la tienda funciona igual sin el Pixel.     */
/*  La elección vive en este navegador (localStorage).                      */
/* ======================================================================= */

export type CookieConsent = 'accepted' | 'rejected';

const KEY = 'rf_cookie_consent';
const OPEN_EVENT = 'rf:open-cookie-banner';

/** Página de Legales con la política (título en el panel: "Privacidad y cookies"). */
export const PRIVACY_PATH = '/legal/privacidad-y-cookies';

export const getCookieConsent = (): CookieConsent | null => {
	try {
		const v = localStorage.getItem(KEY);
		return v === 'accepted' || v === 'rejected' ? v : null;
	} catch {
		// Navegador con el almacenamiento bloqueado: se trata como "no eligió".
		return null;
	}
};

export const setCookieConsent = (v: CookieConsent): void => {
	try {
		localStorage.setItem(KEY, v);
	} catch {
		/* no se recuerda la elección; el aviso vuelve a aparecer, nada más */
	}
};

/** Vuelve a mostrar el aviso (link "Preferencias de cookies" del pie). */
export const openCookieBanner = (): void => {
	window.dispatchEvent(new Event(OPEN_EVENT));
};

export const onOpenCookieBanner = (fn: () => void): (() => void) => {
	window.addEventListener(OPEN_EVENT, fn);
	return () => window.removeEventListener(OPEN_EVENT, fn);
};
