/**
 * Trae TODAS las filas de una consulta, paginando por debajo.
 *
 * Supabase (PostgREST) corta cualquier consulta en `max_rows` filas — por
 * defecto 1000 — y lo hace en silencio: no da error, simplemente devuelve las
 * primeras 1000. Cualquier cifra calculada sobre ese resultado (sumas, conteos,
 * filtros en el navegador) queda mal sin que nadie se entere.
 *
 * Este helper pide la consulta de a páginas con `.range()` hasta que una página
 * vuelve incompleta, así el resultado no depende del tope del servidor.
 *
 * Para CONTAR no uses esto: `select('id', { count: 'exact', head: true })`
 * cuenta en Postgres sin traer una sola fila.
 */

interface PageResult<T> {
	data: T[] | null;
	error: { message: string } | null;
}

interface Options {
	/** Filas por request. Debe ser <= al `max_rows` del proyecto (default 1000). */
	pageSize?: number;
	/** Freno de mano: si se supera, corta y avisa en consola. */
	maxRows?: number;
	/** Nombre para los mensajes de error/aviso. */
	label?: string;
}

export const fetchAllRows = async <T>(
	// Recibe una fábrica y no una consulta ya armada porque los builders de
	// supabase-js se consumen al ejecutarse: hay que rearmarla en cada página.
	makeQuery: (from: number, to: number) => PromiseLike<PageResult<T>>,
	{ pageSize = 1000, maxRows = 50000, label = 'fetchAllRows' }: Options = {}
): Promise<T[]> => {
	const rows: T[] = [];

	for (let from = 0; from < maxRows; from += pageSize) {
		const { data, error } = await makeQuery(from, from + pageSize - 1);
		if (error) throw new Error(error.message);

		const page = data ?? [];
		rows.push(...page);

		// Página incompleta = no hay más nada atrás.
		if (page.length < pageSize) return rows;
	}

	console.warn(
		`${label}: se alcanzó el tope de ${maxRows} filas; el resultado puede estar incompleto.`
	);
	return rows;
};
