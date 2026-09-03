const SOAP_PRODUCTS_URL =
	'https://www.cdrmedios.com/ws/productos/service.php?class=SublimewsProductosUsuariosCompleto';

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

async function callSoap(url: string, method: string, params: Record<string, string | string[]>): Promise<string> {
	const envelope = buildEnvelope(method, params);
	const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${method}"` }, body: envelope });
	if (!resp.ok) { const text = await resp.text(); throw new Error(`SOAP HTTP ${resp.status}: ${text.slice(0, 500)}`); }
	const xml = await resp.text();
	const match = xml.match(/<(?:[a-zA-Z0-9_:]+:)?(?:[a-zA-Z0-9_]*[Rr]eturn|return)\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_:]+:)?(?:[a-zA-Z0-9_]*[Rr]eturn|return)>/);
	if (!match) throw new Error(`No se encontro tag de respuesta SOAP: ${xml.slice(0, 800)}`);
	return match[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
}

export interface CdrImage {
	img: string;
	fecha: string;
	/** Hash del ARCHIVO. Para saber si una imagen cambio se compara esto, NUNCA la
	 *  URL: `img` lleva un identificador que varia entre usuarios del servicio, asi
	 *  que la misma foto tiene URL distinta para cada cliente (doc 7.5). */
	md5: string;
}

/**
 * Los 24 campos de la doc v2.0 (01/09/2026). Ver docs/cdr/README.md.
 *
 * CASI TODOS son opcionales a proposito: cuando un dato no esta cargado el WS a
 * veces OMITE la clave entera en vez de mandarla vacia (doc 7.2). Confirmado en
 * los combos (codigo con "+"), que llegan sin `marca`, `webmarca` ni `garantia`.
 * Acceder siempre con `?? ''`.
 *
 * Los tipos vienen MEZCLADOS (doc 7.6): `precio`, `stock`, `peso` y las medidas
 * llegan como string ("92.00", "18.9") y `pvp`/`pvpml` como number. Convertir
 * siempre de forma explicita antes de operar.
 */
export interface CdrProduct {
	/** UNICO identificador. No usar `gtin`: varias variantes (outlet, refurbished,
	 *  con SO preinstalado) comparten el mismo GTIN (doc 7.4). */
	codigo: string;
	stock: string | number;
	nombre: string;
	/** Bajada corta. Texto plano, sin HTML. */
	copete?: string;
	/** Ficha larga. Viene en HTML (1857 de 1857 productos medidos). */
	descripcion?: string;
	/** Texto de venta preparado por CDR. Suele venir vacio (12,7 %). */
	descripcion_comercial?: string;
	marca?: string;
	webmarca?: string;
	fabricante?: string;
	/** Plazo de garantia, texto libre ("1 año"). Viene en el 96,7 %. */
	garantia?: string;
	vinculogarantia?: string;
	/** Nuestro costo de compra. */
	precio: string;
	moneda?: string;
	/** Sugerido para la web. 0 = SIN sugerido cargado, no "gratis" (doc 7.7). */
	pvp?: number | string;
	/** Sugerido para MercadoLibre: mas alto que `pvp` porque absorbe la comision. */
	pvpml?: number | string;
	gtin?: string;
	modelo?: string;
	nro_parte?: string;
	/** Decimal: 1/0 o "1.0"/"0.0" segun el cliente SOAP. Comparar por igualdad
	 *  falla en uno de los dos casos: usar SIEMPRE Number(x) > 0 (doc 7.1). */
	habilitado?: number | string;
	/** Centimetros. */
	ancho?: string | number;
	alto?: string | number;
	profundidad?: string | number;
	/** Gramos. */
	peso?: string | number;
	/** Jerarquia web, niveles separados por " >> " (doc 7.8). */
	categoria?: string;
	galeria?: CdrImage[];
}

export async function fetchProductosConGaleria(email: string, token: string, fechaDesde: string): Promise<CdrProduct[]> {
	const raw = await callSoap(SOAP_PRODUCTS_URL, 'productos_con_galeria', { email, token, fecha: fechaDesde, formato: 'json' });

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (e) {
		throw new Error(`WS CDR: respuesta no es JSON (${e}). Recibido: ${raw.slice(0, 300)}`);
	}

	// El servicio responde HTTP 200 AUNQUE haya fallado: el error viene dentro del
	// string devuelto (doc seccion 9). Sin esto, un "USUARIO NO CONFIGURADO" (que es
	// lo que aparece si CDR nos tranca el usuario por abusar del full sync) llegaba
	// al mail de alerta disfrazado de "la respuesta no es un array", que no dice nada.
	if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
		const err = (parsed as Record<string, unknown>).ERROR ?? (parsed as Record<string, unknown>).error;
		if (err) throw new Error(`WS CDR devolvio ERROR: "${String(err)}" (HTTP 200). Revisar credenciales / formato de fecha / bloqueo del usuario.`);
	}
	if (!Array.isArray(parsed)) throw new Error(`WS CDR: la respuesta no es un array. Recibido: ${raw.slice(0, 300)}`);

	return parsed as CdrProduct[];
}
