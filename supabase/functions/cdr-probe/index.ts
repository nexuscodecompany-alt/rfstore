// deno-lint-ignore-file no-explicit-any
// Edge Function: cdr-probe (v1) - SONDEO READ-ONLY del WS de CDR.
//
// NO escribe absolutamente nada: ni en la base, ni en storage, ni manda mails.
// Existe para verificar contra el servicio REAL lo que promete la doc v2.0
// (docs/cdr/README.md) antes de tocar el sync de produccion.
//
// Responde:
//   - si el WS devuelve {"ERROR": ...} (llega con HTTP 200, hay que mirarlo adentro)
//   - cuantos productos trae y cuanto pesa la respuesta cruda
//   - la union de TODAS las claves vistas (deberian ser 24 + galeria)
//   - % de llenado real por campo (la doc da porcentajes; los verificamos)
//   - el tipo exacto de `habilitado` y sus valores distintos (7.1)
//   - que claves les FALTAN a los combos (codigo con "+") (7.2)
//   - si el parametro `fecha` filtra de verdad (compara 2 ventanas)
//   - si `get_stock` esta habilitado para nuestro usuario (7 / seccion 1)
//
// Uso:  POST { horas?: number, probe_get_stock?: boolean, fecha?: string }
//
// Autocontenido a proposito (sin imports de ../_shared): se deploya como un solo
// archivo, que es como esta funcion se sube y evita el drift de _shared.
const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const SOAP_PRODUCTS_URL =
	'https://www.cdrmedios.com/ws/productos/service.php?class=SublimewsProductosUsuariosCompleto';
const SOAP_STOCKS_URL =
	'https://www.cdrmedios.com/ws/productos/service.php?class=SublimewsProductosStocks';

const CDR_EMAIL = Deno.env.get('CDR_EMAIL')!;
const CDR_TOKEN = Deno.env.get('CDR_TOKEN')!;

// Los 24 campos que promete la doc v2.0, en orden.
const CAMPOS_DOC = [
	'codigo', 'stock', 'nombre', 'copete', 'descripcion', 'descripcion_comercial',
	'marca', 'webmarca', 'fabricante', 'garantia', 'vinculogarantia', 'precio',
	'moneda', 'pvp', 'pvpml', 'gtin', 'modelo', 'nro_parte', 'habilitado',
	'ancho', 'alto', 'profundidad', 'peso', 'categoria',
];

function escapeXml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function buildEnvelope(method: string, params: Record<string, string | string[]>): string {
	const args = Object.entries(params).map(([k, v]) => {
		if (Array.isArray(v)) {
			const items = v.map(it => `<item xsi:type="xsd:string">${escapeXml(it)}</item>`).join('');
			return `<${k} xsi:type="SOAP-ENC:Array" SOAP-ENC:arrayType="xsd:string[${v.length}]">${items}</${k}>`;
		}
		return `<${k} xsi:type="xsd:string">${escapeXml(v)}</${k}>`;
	}).join('');
	return `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/"><SOAP-ENV:Body><${method}>${args}</${method}></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
}

// Devuelve el string CRUDO que manda el WS (sin parsear), para poder inspeccionarlo.
async function callSoapRaw(url: string, method: string, params: Record<string, string | string[]>): Promise<{ raw: string; ms: number; bytes: number }> {
	const t0 = Date.now();
	const resp = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${method}"` },
		body: buildEnvelope(method, params),
	});
	const xml = await resp.text();
	const ms = Date.now() - t0;
	if (!resp.ok) throw new Error(`SOAP HTTP ${resp.status}: ${xml.slice(0, 400)}`);
	const match = xml.match(/<(?:[a-zA-Z0-9_:]+:)?(?:[a-zA-Z0-9_]*[Rr]eturn|return)\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_:]+:)?(?:[a-zA-Z0-9_]*[Rr]eturn|return)>/);
	if (!match) throw new Error(`Sin tag de respuesta SOAP: ${xml.slice(0, 600)}`);
	const raw = match[1]
		.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"').replace(/&apos;/g, "'")
		.replace(/&amp;/g, '&').trim();
	return { raw, ms, bytes: xml.length };
}

// Fecha en el formato que pide CDR: YYYY-MM-DD HH:MM:SS
const fmt = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

Deno.serve(async req => {
	if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

	const body: { horas?: number; fecha?: string; probe_get_stock?: boolean } =
		req.method === 'POST' ? await req.json().catch(() => ({})) : {};
	const horas = Number(body.horas ?? 24) || 24;
	const out: any = { probe_version: 1, corrido_at: new Date().toISOString() };

	try {
		// ---- Llamada principal (INCREMENTAL, no full sync) ----------------
		const fechaMain = body.fecha ?? fmt(new Date(Date.now() - horas * 3600_000));
		out.fecha_consultada = fechaMain;
		const { raw, ms, bytes } = await callSoapRaw(SOAP_PRODUCTS_URL, 'productos_con_galeria', {
			email: CDR_EMAIL, token: CDR_TOKEN, fecha: fechaMain, formato: 'json',
		});
		out.respuesta = { ms, bytes_xml: bytes, bytes_payload: raw.length, primeros_120: raw.slice(0, 120) };

		// ---- Deteccion de error (viene con HTTP 200, seccion 9) -----------
		let parsed: any;
		try { parsed = JSON.parse(raw); }
		catch (e) { out.error_parseo = String(e); out.raw_muestra = raw.slice(0, 500); return json(out); }

		if (!Array.isArray(parsed)) {
			out.ES_ERROR_DEL_WS = true;
			out.error_payload = parsed;
			out.diagnostico = parsed?.ERROR
				? `El WS respondio ERROR: "${parsed.ERROR}". HTTP 200 igual (seccion 9 de la doc).`
				: 'El WS no devolvio un array.';
			return json(out);
		}

		const prods: any[] = parsed;
		out.cantidad = prods.length;

		// ---- Union de claves + % de llenado -------------------------------
		const clavesVistas = new Set<string>();
		for (const p of prods) for (const k of Object.keys(p ?? {})) clavesVistas.add(k);
		out.claves_presentes = [...clavesVistas].sort();
		out.campos_doc_faltantes = CAMPOS_DOC.filter(c => !clavesVistas.has(c));
		out.campos_no_documentados = [...clavesVistas].filter(c => c !== 'galeria' && !CAMPOS_DOC.includes(c));

		const llenado: Record<string, string> = {};
		const ausencia: Record<string, number> = {};
		if (prods.length > 0) {
			for (const c of CAMPOS_DOC) {
				let conValor = 0, sinClave = 0;
				for (const p of prods) {
					if (!(c in (p ?? {}))) { sinClave++; continue; }
					const v = (p as any)[c];
					if (v !== null && v !== undefined && String(v).trim() !== '') conValor++;
				}
				llenado[c] = `${((conValor / prods.length) * 100).toFixed(1)}%`;
				if (sinClave > 0) ausencia[c] = sinClave;
			}
		}
		out.llenado_por_campo = llenado;
		out.claves_ausentes_por_campo = ausencia; // seccion 7.2

		// ---- habilitado: tipo real y valores (seccion 7.1) ----------------
		const tipos = new Set<string>(), valores = new Set<string>();
		let habilitadoCero = 0;
		for (const p of prods) {
			tipos.add(typeof p?.habilitado);
			valores.add(JSON.stringify(p?.habilitado));
			if (Number(p?.habilitado ?? 0) <= 0) habilitadoCero++;
		}
		out.habilitado = {
			tipos_js: [...tipos],
			valores_distintos: [...valores].slice(0, 10),
			productos_deshabilitados: habilitadoCero,
			nota: 'Se filtran con Number(x) > 0. Si aparece > 0 aca, hoy los estamos importando igual.',
		};

		// ---- Combos: que claves les faltan (seccion 7.2) -------------------
		const combos = prods.filter(p => String(p?.codigo ?? '').includes('+'));
		out.combos = { cantidad: combos.length };
		if (combos.length > 0) {
			const faltan: Record<string, number> = {};
			for (const c of combos) for (const k of CAMPOS_DOC) if (!(k in c)) faltan[k] = (faltan[k] ?? 0) + 1;
			out.combos.claves_faltantes = faltan;
			out.combos.ejemplo_codigo = combos[0]?.codigo;
			out.combos.ejemplo_claves = Object.keys(combos[0] ?? {});
		}

		// ---- descripcion: HTML de verdad? (7.3) ----------------------------
		const conDesc = prods.filter(p => String(p?.descripcion ?? '').trim() !== '');
		out.descripcion_html = {
			con_descripcion: conDesc.length,
			con_etiquetas: conDesc.filter(p => /<[a-z][\s\S]*>/i.test(String(p.descripcion))).length,
		};

		// ---- Tipos numericos mezclados (7.6) -------------------------------
		const tipoDe = (campo: string) => {
			const t = new Set<string>();
			for (const p of prods) if (p?.[campo] !== undefined) t.add(typeof p[campo]);
			return [...t];
		};
		out.tipos_numericos = {
			precio: tipoDe('precio'), stock: tipoDe('stock'), pvp: tipoDe('pvp'),
			pvpml: tipoDe('pvpml'), peso: tipoDe('peso'), ancho: tipoDe('ancho'),
		};

		// ---- pvp / pvpml en 0 = "sin sugerido" (7.7) ------------------------
		out.sugeridos = {
			pvp_mayor_a_cero: prods.filter(p => Number(p?.pvp ?? 0) > 0).length,
			pvpml_mayor_a_cero: prods.filter(p => Number(p?.pvpml ?? 0) > 0).length,
		};

		// ---- categoria como jerarquia (7.8) ---------------------------------
		const cats = prods.map(p => String(p?.categoria ?? '')).filter(Boolean);
		out.categorias = {
			con_categoria: cats.length,
			con_separador: cats.filter(c => c.includes('>>')).length,
			niveles_max: cats.reduce((m, c) => Math.max(m, c.split('>>').length), 0),
			ejemplos: [...new Set(cats)].slice(0, 5),
		};

		// ---- galeria + md5 (7.5) ---------------------------------------------
		let imgs = 0, conMd5 = 0;
		for (const p of prods) for (const g of (p?.galeria ?? [])) { imgs++; if (g?.md5) conMd5++; }
		out.galeria = { imagenes: imgs, con_md5: conMd5 };

		// ---- Producto de ejemplo (uno real, entero) --------------------------
		if (prods.length > 0) {
			const ej = { ...prods[0] };
			if (typeof ej.descripcion === 'string') ej.descripcion = ej.descripcion.slice(0, 220) + '…';
			out.ejemplo_producto = ej;
		}

		// ---- El parametro `fecha` filtra de verdad? (seccion 4) ---------------
		// Segunda llamada con una ventana MUCHO mas chica. Si devuelve menos, filtra.
		try {
			const fechaCorta = fmt(new Date(Date.now() - 3600_000)); // 1 hora
			const r2 = await callSoapRaw(SOAP_PRODUCTS_URL, 'productos_con_galeria', {
				email: CDR_EMAIL, token: CDR_TOKEN, fecha: fechaCorta, formato: 'json',
			});
			const p2 = JSON.parse(r2.raw);
			out.prueba_incremental = {
				ventana_larga: { fecha: fechaMain, productos: prods.length, bytes: raw.length, ms },
				ventana_1h: { fecha: fechaCorta, productos: Array.isArray(p2) ? p2.length : null, bytes: r2.raw.length, ms: r2.ms },
				filtra: Array.isArray(p2) ? p2.length < prods.length : null,
			};
		} catch (e) { out.prueba_incremental = { error: String(e) }; }

		// ---- get_stock esta habilitado? (opcional) -----------------------------
		if (body.probe_get_stock) {
			const codigos = prods.slice(0, 3).map(p => String(p.codigo)).filter(Boolean);
			try {
				const rs = await callSoapRaw(SOAP_STOCKS_URL, 'get_stock', {
					email: CDR_EMAIL, token: CDR_TOKEN, productos: codigos, formato: 'json',
				});
				let parsedStock: any = null;
				try { parsedStock = JSON.parse(rs.raw); } catch { /* queda el crudo */ }
				out.get_stock = {
					habilitado: Array.isArray(parsedStock),
					codigos_consultados: codigos,
					respuesta: parsedStock ?? rs.raw.slice(0, 300),
					ms: rs.ms,
				};
			} catch (e) {
				out.get_stock = { habilitado: false, error: String(e), codigos_consultados: codigos };
			}
		}

		return json(out);
	} catch (e: any) {
		out.error_fatal = e?.message ?? String(e);
		return json(out, 500);
	}
});

function json(obj: unknown, status = 200): Response {
	return new Response(JSON.stringify(obj, null, 2), {
		headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		status,
	});
}
