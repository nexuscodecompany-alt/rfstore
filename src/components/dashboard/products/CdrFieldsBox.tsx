import { HiOutlineArrowTopRightOnSquare } from 'react-icons/hi2';

/**
 * Todo lo que CDR manda de un producto, tal cual llega.
 *
 * Es de SÓLO LECTURA a propósito: son datos del proveedor, se refrescan en cada corrida
 * del sync (cada 5 min) y cualquier cosa que se editara acá se perdería en la siguiente.
 * Lo que sí se edita —nombre, descripción, precio, stock— tiene sus propios campos arriba
 * y sus candados.
 *
 * Sirve para dos cosas concretas: ver de dónde salió lo que se publica en la web y en
 * Mercado Libre (garantía, peso, medidas), y detectar cuándo CDR manda algo raro.
 */

/**
 * Sólo los campos que este bloque necesita, todos opcionales. Se define acá en vez de
 * reusar `Product` a propósito: el formulario recibe el producto con el tipo generado de
 * Supabase (donde `brand_id` puede ser null) y no con la interfaz de la tienda, así que
 * atarse a una de las dos formas rompe con la otra sin ganar nada.
 */
export interface CdrFieldsSource {
	source?: string | null;
	cdr_marca?: string | null;
	cdr_marca_url?: string | null;
	cdr_fabricante_url?: string | null;
	cdr_categoria?: string | null;
	cdr_descripcion_comercial?: string | null;
	cdr_garantia?: string | null;
	cdr_garantia_url?: string | null;
	cdr_modelo?: string | null;
	cdr_gtin?: string | null;
	cdr_nro_parte?: string | null;
	cdr_pvp_usd?: number | string | null;
	cdr_pvpml_usd?: number | string | null;
	cdr_peso_gramos?: number | string | null;
	cdr_ancho_cm?: number | string | null;
	cdr_alto_cm?: number | string | null;
	cdr_profundidad_cm?: number | string | null;
	cdr_habilitado?: boolean | null;
	cdr_fields_updated_at?: string | null;
}

interface Props {
	product?: CdrFieldsSource | null;
}

const nf = (n: number, dec = 1) =>
	n.toLocaleString('es-UY', { minimumFractionDigits: 0, maximumFractionDigits: dec });

const num = (v: unknown): number | null => {
	const n = Number(v ?? 0);
	return Number.isFinite(n) && n > 0 ? n : null;
};

/** Una fila de dato. Si no hay valor no se pinta: una ficha con diez "—" no dice nada. */
const Dato = ({ k, children }: { k: string; children: React.ReactNode }) => (
	<div className='flex items-baseline justify-between gap-3 py-1.5'>
		<dt className='shrink-0 text-xs text-slate-500'>{k}</dt>
		<dd className='min-w-0 break-words text-right text-xs font-medium text-slate-800'>
			{children}
		</dd>
	</div>
);

const Enlace = ({ href, texto }: { href: string; texto: string }) => (
	<a
		href={href.startsWith('http') ? href : `https://${href}`}
		target='_blank'
		rel='noopener noreferrer'
		className='inline-flex items-center gap-1 text-brand-600 hover:text-brand-800 hover:underline'
	>
		<span className='truncate'>{texto}</span>
		<HiOutlineArrowTopRightOnSquare className='size-3 shrink-0' aria-hidden />
	</a>
);

export const CdrFieldsBox = ({ product }: Props) => {
	if (!product || product.source !== 'cdr') return null;

	const p = product;
	const peso = num(p.cdr_peso_gramos);
	const ancho = num(p.cdr_ancho_cm);
	const alto = num(p.cdr_alto_cm);
	const prof = num(p.cdr_profundidad_cm);
	const pvp = num(p.cdr_pvp_usd);
	const pvpml = num(p.cdr_pvpml_usd);

	const medidas = ancho && alto && prof ? `${nf(ancho)} × ${nf(alto)} × ${nf(prof)} cm` : null;
	const pesoLabel = peso ? (peso >= 1000 ? `${nf(peso / 1000, 2)} kg` : `${nf(peso, 0)} g`) : null;

	const actualizado = p.cdr_fields_updated_at
		? new Date(p.cdr_fields_updated_at).toLocaleString('es-UY', {
				timeZone: 'America/Montevideo',
				day: '2-digit',
				month: '2-digit',
				hour: '2-digit',
				minute: '2-digit',
			})
		: null;

	// Si CDR todavía no mandó nada de este producto (entró antes de que existieran estos
	// campos y aún no pasó por una corrida), no tiene sentido mostrar el bloque vacío.
	const hayAlgo =
		p.cdr_marca || p.cdr_categoria || p.cdr_garantia || p.cdr_modelo || p.cdr_gtin ||
		p.cdr_nro_parte || pesoLabel || medidas || pvp || pvpml || p.cdr_descripcion_comercial;
	if (!hayAlgo) return null;

	return (
		<section className='mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3'>
			<div className='flex items-baseline justify-between gap-2'>
				<h3 className='text-sm font-semibold text-slate-800'>Datos que manda CDR</h3>
				{p.cdr_habilitado === false && (
					<span className='rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-700'>
						Despublicado en CDR
					</span>
				)}
			</div>
			<p className='mt-0.5 text-xs text-slate-500'>
				Se actualizan solos en cada sincronización. No se editan acá: lo que cambies se
				pisa en la próxima corrida.
				{actualizado && <span className='block'>Última actualización: {actualizado}</span>}
			</p>

			<dl className='mt-2 divide-y divide-slate-200'>
				{p.cdr_marca && <Dato k='Marca'>{p.cdr_marca}</Dato>}
				{p.cdr_categoria && (
					// La jerarquía de CDR viene como "A >> B >> C". Es referencia para clasificar:
					// no es la categoría de la tienda.
					<Dato k='Categoría en CDR'>{p.cdr_categoria}</Dato>
				)}
				{p.cdr_garantia && <Dato k='Garantía'>{p.cdr_garantia}</Dato>}
				{p.cdr_garantia_url && (
					<Dato k='Service de garantía'>
						<Enlace href={p.cdr_garantia_url} texto='Ver' />
					</Dato>
				)}
				{p.cdr_modelo && <Dato k='Modelo'>{p.cdr_modelo}</Dato>}
				{p.cdr_nro_parte && <Dato k='Nro. de parte'>{p.cdr_nro_parte}</Dato>}
				{p.cdr_gtin && (
					<Dato k='GTIN'>
						<span className='font-mono'>{p.cdr_gtin}</span>
					</Dato>
				)}
				{pesoLabel && <Dato k='Peso'>{pesoLabel}</Dato>}
				{medidas && <Dato k='Medidas (an × al × prof)'>{medidas}</Dato>}
				{/* CDR manda 0 cuando no cargó sugerido, así que si no hay valor la fila no
				    aparece: publicar un 0 como precio sería un error caro. */}
				{pvp && <Dato k='Sugerido web (CDR)'>US$ {nf(pvp, 2)}</Dato>}
				{pvpml && <Dato k='Sugerido ML (CDR)'>US$ {nf(pvpml, 2)}</Dato>}
				{p.cdr_marca_url && (
					<Dato k='Sitio de la marca'>
						<Enlace href={p.cdr_marca_url} texto={p.cdr_marca_url.replace(/^https?:\/\//, '')} />
					</Dato>
				)}
				{p.cdr_fabricante_url && (
					<Dato k='Ficha del fabricante'>
						<Enlace href={p.cdr_fabricante_url} texto='Ver producto' />
					</Dato>
				)}
			</dl>

			{p.cdr_descripcion_comercial && (
				<div className='mt-2 border-t border-slate-200 pt-2'>
					<p className='text-xs text-slate-500'>Texto de venta de CDR</p>
					<p className='mt-0.5 text-xs text-slate-700'>{p.cdr_descripcion_comercial}</p>
				</div>
			)}
		</section>
	);
};
