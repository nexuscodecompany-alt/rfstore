// Cliente SOAP minimalista para el WS de CDR (Sublime Solutions).
// Evitamos dependencias pesadas: armamos el sobre SOAP a mano y parseamos la respuesta.

const SOAP_PRODUCTS_URL =
	'https://www.cdrmedios.com/ws/productos/service.php?class=SublimewsProductosUsuariosCompleto';
const SOAP_STOCKS_URL =
	'https://www.cdrmedios.com/ws/productos/service.php?class=SublimewsProductosStocks';

function escapeXml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

function buildEnvelope(method: string, params: Record<string, string | string[]>): string {
	const args = Object.entries(params)
		.map(([k, v]) => {
			if (Array.isArray(v)) {
				const items = v
					.map(it => `<item xsi:type="xsd:string">${escapeXml(it)}</item>`)
					.join('');
				return `<${k} xsi:type="SOAP-ENC:Array" SOAP-ENC:arrayType="xsd:string[${v.length}]">${items}</${k}>`;
			}
			return `<${k} xsi:type="xsd:string">${escapeXml(v)}</${k}>`;
		})
		.join('');

	return `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope
  xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/">
  <SOAP-ENV:Body>
    <${method}>${args}</${method}>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;
}

async function callSoap(
	url: string,
	method: string,
	params: Record<string, string | string[]>
): Promise<string> {
	const envelope = buildEnvelope(method, params);
	const resp = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'text/xml; charset=utf-8',
			SOAPAction: `"${method}"`,
		},
		body: envelope,
	});

	if (!resp.ok) {
		const text = await resp.text();
		throw new Error(`SOAP HTTP ${resp.status}: ${text.slice(0, 500)}`);
	}

	const xml = await resp.text();

	// El retorno del WS viene como <{method}Return> o <return>. Aceptamos ambas variantes.
	const match = xml.match(/<(?:[a-zA-Z0-9_:]+:)?(?:[a-zA-Z0-9_]*[Rr]eturn|return)\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_:]+:)?(?:[a-zA-Z0-9_]*[Rr]eturn|return)>/);
	if (!match) {
		throw new Error(`No se encontró tag de respuesta SOAP: ${xml.slice(0, 800)}`);
	}

	// Decodificar entidades XML
	const decoded = match[1]
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, '&');

	return decoded.trim();
}

export interface CdrImage {
	img: string;
	fecha: string;
	md5: string;
}

export interface CdrProduct {
	codigo: string;
	stock: string | number;
	nombre: string;
	copete: string;
	descripcion: string;
	precio: string;
	moneda: string;
	gtin?: string;
	modelo?: string;
	nro_parte?: string;
	galeria: CdrImage[];
}

export interface CdrStockItem {
	codigo: string;
	stock: number; // -999 si no existe
}

export async function fetchProductosConGaleria(
	email: string,
	token: string,
	fechaDesde: string
): Promise<CdrProduct[]> {
	const raw = await callSoap(SOAP_PRODUCTS_URL, 'productos_con_galeria', {
		email,
		token,
		fecha: fechaDesde,
		formato: 'json',
	});

	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) {
			throw new Error(`Respuesta WS no es array: ${raw.slice(0, 300)}`);
		}
		return parsed as CdrProduct[];
	} catch (e) {
		throw new Error(`Error parseando JSON del WS: ${e}. Respuesta: ${raw.slice(0, 500)}`);
	}
}

export async function fetchGetStock(
	email: string,
	token: string,
	codigos: string[]
): Promise<CdrStockItem[]> {
	const raw = await callSoap(SOAP_STOCKS_URL, 'get_stock', {
		email,
		token,
		productos: codigos,
		formato: 'json',
	});

	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) {
			throw new Error(`Respuesta WS no es array: ${raw.slice(0, 300)}`);
		}
		return (parsed as Array<{ codigo: string; stock: number | string }>).map(it => ({
			codigo: String(it.codigo),
			stock: typeof it.stock === 'number' ? it.stock : Number(it.stock),
		}));
	} catch (e) {
		throw new Error(`Error parseando JSON del WS: ${e}. Respuesta: ${raw.slice(0, 500)}`);
	}
}
