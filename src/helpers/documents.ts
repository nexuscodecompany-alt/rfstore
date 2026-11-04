/* Documentos uruguayos. Misma regla que supabase/functions/_shared/fixed.ts. */

export const onlyDigits = (s: unknown) => String(s ?? '').replace(/\D/g, '');

/** Cédula uruguaya (7 u 8 dígitos, con dígito verificador). */
export function isValidCI(raw: string): boolean {
	const d = onlyDigits(raw);
	if (d.length < 7 || d.length > 8) return false;
	const body = d.slice(0, -1).padStart(7, '0');
	const w = [2, 9, 8, 7, 6, 3, 4];
	const sum = body.split('').reduce((acc, c, i) => acc + Number(c) * w[i], 0);
	return (10 - (sum % 10)) % 10 === Number(d.slice(-1));
}
