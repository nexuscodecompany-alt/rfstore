import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

// Posición de scroll por entrada del historial. Vive fuera del componente para
// sobrevivir a los desmontajes (entrar a un producto desmonta la tienda).
const scrollPositions = new Map<string, number>();

/**
 * Maneja el scroll entre navegaciones:
 *  - Navegación nueva a otra página -> arriba de todo.
 *  - "Atrás" / "adelante" (POP) -> vuelve a donde estaba el usuario. Antes lo
 *    mandaba siempre al techo, así que volver de un producto a la tienda te
 *    dejaba arriba de todo y había que bajar de nuevo hasta el producto.
 *  - Cambio de filtros (misma página, sólo cambia el query string) -> no se
 *    toca el scroll: sería un salto molesto mientras se tildan filtros.
 */
export const ScrollToTop = () => {
	const { pathname, key } = useLocation();
	const navigationType = useNavigationType();
	const lastPath = useRef(pathname);

	// Guarda la posición de ESTA entrada del historial justo antes de dejarla
	// (el cleanup corre con el key viejo, que es exactamente lo que queremos).
	useEffect(() => {
		return () => {
			scrollPositions.set(key, window.scrollY);
		};
	}, [key]);

	useEffect(() => {
		if (navigationType === 'POP') {
			const y = scrollPositions.get(key);
			lastPath.current = pathname;
			if (y == null) return;
			// El listado se pinta con la caché de react-query, pero puede tardar
			// un frame: reintentamos una vez por las dudas.
			requestAnimationFrame(() => window.scrollTo(0, y));
			const t = setTimeout(() => window.scrollTo(0, y), 150);
			return () => clearTimeout(t);
		}

		// Sólo al cambiar de página de verdad (no al tocar filtros).
		if (pathname !== lastPath.current) {
			lastPath.current = pathname;
			window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
		}
	}, [pathname, key, navigationType]);

	return null;
};
