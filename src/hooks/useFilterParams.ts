import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Filtros que viven en la URL (no en useState).
 *
 * Por qué: si los filtros están en el estado del componente, entrar a un
 * producto lo desmonta y al volver con "atrás" se vuelve a montar de cero —
 * el cliente perdía la marca, el precio, la página y el orden que tenía
 * puestos (pasaba en la tienda y también en el panel al editar un producto).
 *
 * Con los filtros en la URL el navegador los restaura solo al volver, y de
 * yapa el link queda compartible ("mirá esta búsqueda") y se puede recargar
 * la página sin perder nada.
 *
 * Los cambios se escriben con `replace: true`: cada ajuste de filtro pisa la
 * entrada del historial en vez de agregar una nueva, así "atrás" vuelve a la
 * página anterior de verdad y no a cada tilde que el usuario fue tocando.
 */
export type ParamValue = string | number | string[] | null | undefined;

export const useFilterParams = () => {
	const [searchParams, setSearchParams] = useSearchParams();

	const get = useCallback(
		(key: string): string => searchParams.get(key) ?? '',
		[searchParams]
	);

	/** Lista separada por comas: ?brand=id1,id2 */
	const getList = useCallback(
		(key: string): string[] =>
			(searchParams.get(key) ?? '')
				.split(',')
				.map(s => s.trim())
				.filter(Boolean),
		[searchParams]
	);

	const getNumber = useCallback(
		(key: string): number | undefined => {
			const raw = searchParams.get(key);
			if (raw === null || raw.trim() === '') return undefined;
			const n = Number(raw);
			return Number.isFinite(n) ? n : undefined;
		},
		[searchParams]
	);

	const getBool = useCallback(
		(key: string): boolean => searchParams.get(key) === '1',
		[searchParams]
	);

	/**
	 * Escribe varios parámetros de una. Un valor vacío / null / undefined /
	 * lista vacía BORRA el parámetro, así la URL queda limpia (sólo lo que el
	 * usuario realmente eligió).
	 */
	const patch = useCallback(
		(values: Record<string, ParamValue>, opts?: { push?: boolean }) => {
			setSearchParams(
				prev => {
					const next = new URLSearchParams(prev);
					for (const [key, value] of Object.entries(values)) {
						const empty =
							value === null ||
							value === undefined ||
							value === '' ||
							(Array.isArray(value) && value.length === 0);
						if (empty) next.delete(key);
						else next.set(key, Array.isArray(value) ? value.join(',') : String(value));
					}
					return next;
				},
				{ replace: !opts?.push }
			);
		},
		[setSearchParams]
	);

	/** Agrega o saca un valor de una lista (checkboxes de marca, subcategoría…). */
	const toggleInList = useCallback(
		(key: string, value: string, extra?: Record<string, ParamValue>) => {
			const current = (searchParams.get(key) ?? '').split(',').filter(Boolean);
			const next = current.includes(value)
				? current.filter(v => v !== value)
				: [...current, value];
			patch({ [key]: next, ...extra });
		},
		[searchParams, patch]
	);

	return { searchParams, get, getList, getNumber, getBool, patch, toggleInList };
};
