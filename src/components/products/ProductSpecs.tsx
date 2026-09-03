import { HiOutlineShieldCheck } from 'react-icons/hi2';

/**
 * Ficha tecnica del producto: garantia, modelo, peso y medidas.
 *
 * Los datos vienen del WS de CDR v2.0 (columnas cdr_*, ver docs/cdr/README.md).
 * Se muestran SOLO los que existen: una ficha con cinco "No disponible" es peor
 * que una ficha corta.
 *
 * El GTIN a proposito NO se muestra: al comprador no le dice nada y ademas no
 * identifica al producto (varias variantes comparten el mismo, doc 7.4). Se usa
 * puertas adentro para publicar en MercadoLibre.
 */

interface Props {
	garantia?: string | null;
	modelo?: string | null;
	pesoGramos?: number | string | null;
	anchoCm?: number | string | null;
	altoCm?: number | string | null;
	profundidadCm?: number | string | null;
}

// Numeros en formato local: 1,2 kg y no 1.2 kg.
const nf = (n: number, dec = 1) =>
	n.toLocaleString('es-UY', { minimumFractionDigits: 0, maximumFractionDigits: dec });

const num = (v: number | string | null | undefined): number | null => {
	const n = Number(v ?? 0);
	return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * CDR manda la garantia como texto libre y no todos los valores se entienden
 * solos en una ficha de venta. "Funcional" (514 productos) es el caso claro:
 * dice algo puertas adentro, nada al comprador.
 */
function labelGarantia(raw: string): string | null {
	const t = raw.trim();
	if (!t) return null;
	const lower = t.toLowerCase();
	if (lower === 'sin garantía' || lower === 'sin garantia') return null;
	if (lower === 'funcional') return 'Garantía funcional';
	// "Oficial tercerizada 1 año" ya se explica solo; el resto ("1 año", "6 meses",
	// "90 días contra defecto de fabricación") tambien.
	return t.charAt(0).toUpperCase() + t.slice(1);
}

export const ProductSpecs = ({
	garantia,
	modelo,
	pesoGramos,
	anchoCm,
	altoCm,
	profundidadCm,
}: Props) => {
	const peso = num(pesoGramos);
	const ancho = num(anchoCm);
	const alto = num(altoCm);
	const prof = num(profundidadCm);

	const garantiaLabel = garantia ? labelGarantia(garantia) : null;
	// Las medidas solo sirven completas: "18,9 cm" sin las otras dos no dice nada.
	const medidas = ancho && alto && prof ? `${nf(ancho)} × ${nf(alto)} × ${nf(prof)} cm` : null;
	const pesoLabel = peso ? (peso >= 1000 ? `${nf(peso / 1000, 2)} kg` : `${nf(peso, 0)} g`) : null;

	const filas = [
		modelo ? { k: 'Modelo', v: modelo } : null,
		pesoLabel ? { k: 'Peso', v: pesoLabel } : null,
		medidas ? { k: 'Medidas', v: medidas } : null,
	].filter(Boolean) as { k: string; v: string }[];

	// Sin un solo dato no hay nada que mostrar: no dejamos un titulo huerfano.
	if (!garantiaLabel && filas.length === 0) return null;

	return (
		<section className="my-8" aria-labelledby="ficha-tecnica">
			<h2 id="ficha-tecnica" className="sr-only">
				Ficha técnica
			</h2>

			{/* La garantia es argumento de venta, no un dato mas de la tabla: va primero
			    y con mas peso visual que las medidas. */}
			{garantiaLabel && (
				<p className="flex items-center gap-2 text-sm font-semibold tracking-tight text-ink-800">
					<HiOutlineShieldCheck className="size-5 shrink-0 text-brand-600" aria-hidden />
					{garantiaLabel}
				</p>
			)}

			{filas.length > 0 && (
				<dl className={`grid grid-cols-[auto_1fr] gap-x-6 text-sm ${garantiaLabel ? 'mt-4' : ''}`}>
					{filas.map(({ k, v }, i) => (
						<div key={k} className="contents">
							<dt
								className={`py-2 text-ink-500 ${i > 0 ? 'border-t border-ink-100' : ''}`}
							>
								{k}
							</dt>
							<dd
								className={`py-2 font-medium tracking-tight text-ink-800 ${i > 0 ? 'border-t border-ink-100' : ''}`}
							>
								{v}
							</dd>
						</div>
					))}
				</dl>
			)}
		</section>
	);
};
