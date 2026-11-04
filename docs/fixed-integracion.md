# Integración Fixed (facturación electrónica) — guía completa

Estado: **análisis terminado, nada implementado** (04/11/2026).
Fuente: las 41 páginas de https://developers.fixed.uy + el contrato `openapi.json`
(Fixed - API de Integración 1.0.0, changelog 2026-10-22), leídos completos.
Verificado contra el ambiente de testing con las claves que pasó el cliente (solo lectura).

---

## 0. Resumen en una pantalla

- Fixed emite los CFE (comprobantes fiscales electrónicos) ante DGI. Nosotros solo le
  mandamos la venta por API (`POST /ventaCrear`) y guardamos lo que devuelve.
- **Sin RUT → e-Ticket (101). Con RUT → e-Factura (111).** Lo decide Fixed según el cliente.
- **Anular = nota de crédito por el TOTAL** (`/ventaDevolucionTotalCrear`): 102 o 112.
  No hay devolución parcial por API.
- La respuesta de DGI es **asíncrona**: el CFE sale `sinrespuesta` y después pasa a
  `aceptado` o `rechazado` → hay que consultarlo (`/ventaConsulta`) hasta que se resuelva.
- El total que mandamos tiene que coincidir **al centésimo** con el que calcula Fixed (E15).
- Toda emisión lleva `idempotencyKey` para que un reintento no facture dos veces.
- Emisión **manual**: botón "Facturar" en cada orden del panel (web, Mercado Libre y manuales).

---

## 1. Ambientes y credenciales

| Ambiente | URL base | Efecto |
|---|---|---|
| Testing | `https://southamerica-east1-fixedtesting-10ce2.cloudfunctions.net/apiFixed` | No va a DGI ni a los clientes |
| Producción | `https://southamerica-east1-fixedproduccion-fiv2q.cloudfunctions.net/apiFixed` | Comprobantes reales |

- Las rutas son iguales en los dos; cambian la URL base y el par de claves. **Las claves no
  se cruzan entre ambientes.**
- Headers en cada request: `x-api-key`, `x-api-secret`, `Content-Type: application/json`.
- `x-api-secret` vive SOLO en el backend (Supabase secrets). Nunca en el frontend ni en
  `app_settings` (que es de lectura pública).
- La empresa la resuelve Fixed por la clave: no se manda RUT ni id de empresa en el cuerpo.
- Producción: las claves se generan en `acceso.fixed.uy/accesoAPI` (las genera el cliente).
- Testing: se obtienen creando una empresa de prueba (`/crearEmpresaPrueba`, dura **96 h**)
  o desde la cuenta Fixed (no se borra). Visor web de testing: `testing.fixed.uy`.
- Soporte: soporte@fixed.uy (incluir ambiente, fecha aproximada e `idCFE`).

### Lo que verifiqué con las claves de testing del cliente (04/11/2026, solo lectura)

- `keepAlive` responde.
- `validarCredenciales` → OK. Empresa **"ARAUJO MARTIN FLORENCIA VALENTINA Y CHARLONE
  ALMEIDA RODRIGO"**, RUT `220006580014_old`: es una copia de testing de la empresa real
  (persistente, no la de 96 h).
- `localesListado` → **un solo local**: "Central", PNTE. GIRO 2472, Montevideo, codigoDgi 3,
  id `xqjGCqc5609LWNUrUOcJ` (en producción hay que volver a listarlo: el id puede ser otro).
- `consultaCAE` (vigentes) → hay numeración para 101, 102, 111 y 112, serie A. Ojo: un tramo
  1–100 vence el 09/11/2026 (en testing no importa; en producción revisarlo antes de salir).
- `serviciosRubrosListado` → rubro existente "Varios".
- `consultaFacturacionDia` hoy → vacío.
- Detalle técnico: los `POST` sin cuerpo (`validarCredenciales`, `localesListado`,
  `serviciosRubrosListado`) exigen header `Content-Length`; mandar `{}` como cuerpo, si no
  Google devuelve **411**.

**Secrets a crear en Supabase** (no en el repo, no en el chat):
`FIXED_BASE_URL`, `FIXED_API_KEY`, `FIXED_API_SECRET`. Las de testing ya están en la
conversación; las de producción las carga el cliente directo en Supabase.

---

## 2. Conceptos que hay que cumplir a rajatabla

### 2.1 Errores
- Toda respuesta trae `descripcion` y `codigoError`.
- **Éxito = `codigoError` vacío** en: ventas, consulta, impresión, CAE, CFE recibidos, RUT.
  **Éxito = `"0"`** en: locales, rubros, facturación del día, mostrar cliente.
  → El cliente HTTP tiene que saber qué regla aplica a cada endpoint.
- Errores de negocio vuelven con **HTTP 500** y el código en `codigoError` (no confiar en
  el status solo). Credenciales mal → **HTTP 401** (familia A).
- **El mismo código significa cosas distintas según el endpoint** (E02 = moneda incorrecta
  en `/ventaCrear`, empresa no encontrada en otros). Interpretar siempre endpoint + código.
- Comunes: A01 faltan credenciales · A02 api-key inválida/inactiva · A03 secret inválido ·
  A04 error interno validando · A05 API desactivada temporalmente · A06 el plan no incluye
  API · V01 body con formato inválido (tipo, faltante o **campo no reconocido**) · V02 error
  inesperado.
  → V01 por "campo no reconocido": **no mandar campos de más**.

### 2.2 Idempotencia
- `idempotencyKey` identifica el **intento de emisión**, no el contenido. UUID v4 generado
  justo antes de emitir (recomendado) o el id único de la venta en nuestro sistema.
- **Nunca** derivarla de importes/cliente (hash): dos ventas iguales chocarían.
- Misma key + mismos datos → Fixed devuelve el resultado original (éxito o error).
  Misma key + datos distintos → **E23** → hay que generar key nueva.
  **E22** = ya hay una emisión en curso con esa key → esperar y reintentar con la misma.
- Aplica a `/ventaCrear` y `/ventaDevolucionTotalCrear`.
- No reutilizar keys de testing en producción.
- **Decisión de diseño:** UUID por intento, guardado en la base ANTES de llamar, junto con
  el JSON exacto enviado. Un reintento por corte de red reenvía ese mismo JSON con la misma
  key. Si el admin corrige datos (p. ej. tras un E18), es un intento nuevo con key nueva.
  (No usamos el id de la orden como key: tras un rechazo de DGI o un E18 hay que poder
  emitir de nuevo la misma orden con datos corregidos.)

### 2.3 Límites
- `consultarRUTDGI`: 20 por minuto por empresa (HTTP 429, E04).
- `consultarCFERecibidos`: rango máximo 31 días.
- `crearEmpresaPrueba`: límite por hora (429).
- Largos (si se pasan, rechaza; **no trunca**): ver 4.4.

---

## 3. Los 16 endpoints

| Endpoint | Para qué | ¿Lo usamos? |
|---|---|---|
| `GET /keepAlive` | ¿API viva? sin credenciales | Sí, chequeo de salud |
| `POST /validarCredenciales` | valida el par y devuelve RUT + nombre | Sí, al configurar y en "probar conexión" |
| `POST /ventaCrear` | **emite el CFE** | **Sí, el núcleo** |
| `POST /ventaDevolucionTotalCrear` | **nota de crédito total** | **Sí, anular** |
| `POST /ventaConsulta` | estado DGI de un CFE | **Sí, cron de seguimiento** |
| `POST /imprimirCFE` | regenera URLs/PDF de un CFE existente | Sí, si vinieron vacías o para ML |
| `POST /consultaFacturacionDia` | lista lo emitido en una fecha | Sí, conciliación diaria |
| `POST /obtenerProximoNumero` | próxima serie/número (no reserva) | Solo informativo (ver ley 19.210) |
| `POST /localesListado` | locales activos (id para `local`) | Sí, al configurar |
| `POST /consultaCAE` | numeraciones vigentes | Sí, chequeo antes de producción y alerta |
| `POST /consultarRUTDGI` | razón social/domicilio de un RUT en DGI | Opcional: "Completar con DGI" en el modal |
| `POST /clienteMostrar` | cliente ya guardado en Fixed | No hace falta (ventaCrear crea/actualiza) |
| `POST /serviciosRubrosListado` | rubros | Al configurar |
| `POST /serviciosRubrosAgregarEditar` | crear/editar rubro | No (ventaCrear crea el rubro si no existe) |
| `POST /consultarCFERecibidos` | comprobantes de compra recibidos | Fuera de alcance (es lo de `testing.fixed.uy/CFEsRecibidos`) |
| `POST /crearEmpresaPrueba` | empresa de testing 96 h | No (ya tenemos testing persistente) |

---

## 4. `POST /ventaCrear` en detalle

### 4.1 Campos del cuerpo
Obligatorios: `cliente` (objeto o `null`), `fecha` (`dd/mm/aaaa`), `moneda` (ISO: UYU, USD…),
`montoBruto` (0 = precios sin IVA, 1 = con IVA incluido), `lineasVenta` (≥1), `observaciones`
(string, puede ser `""`), `totalAPagar`, `redondear` (bool).
Opcionales: `local` (id), `formaDePago` (`contado` default | `credito`), `cotizacion`
(pesos por unidad de la moneda; se ignora en UYU; si no va, usa la del día de la empresa en
Fixed o la del BCU), `ordenCompra`, `idempotencyKey`.

Línea (`lineasVenta[]`), todos obligatorios salvo `codigo`: `cantidad` (>0, ≤3 decimales),
`descripcion` (≤80), `descripcionLarga` (≤500, puede ser `""`), `rubro` (nombre o id; se
crea si no existe), `tasaIva` (enum `CfeDgiTasaIva`: `Basic` 22 %, `Min` 10 %, `Exe` 0 %,
`Exp`, `Otro`, `NoFac`, `Suspenso`, `Percibido`, `literalE`), `descuentoMonto` (importe, no
%, ≥0, ≤2 decimales, en la misma base que el precio), `precioUnitario` (>0, ≤2 decimales),
`codigo` (opcional: SKU / código de barras, viaja en el comprobante).

Cliente (si no es `null`), todos los campos presentes (string vacío donde no aplique):
`tipoDocumento` (2 RUT, 3 CI, 4 Otros, 5 Pasaporte, 6 DNI, 7 NIFE), `documento`, `pais`
(opcional salvo 4/5/6/7), `razonSocial`, `nombreComercial`, `domicilio`, `localidad`,
`departamento`, `domicilioEntrega`, `mailEnvioFactura`, `telefono`, `observaciones`.

### 4.2 Qué comprobante sale
| Cliente | Venta | Nota de crédito |
|---|---|---|
| `null` o sin RUT (CI, pasaporte…) | 101 e-Ticket | 102 |
| RUT (`tipoDocumento` 2) | 111 e-Factura | 112 |
No se emiten por API: exportación, cuenta ajena ni contingencia (esos desde la web de Fixed).

### 4.3 Cómo calcula Fixed el total (hay que replicarlo EXACTO)
Por línea:
1. `importe = round2(precioUnitario × cantidad − descuentoMonto)`.
2. Con `montoBruto: 1` el importe ya es el total de la línea (IVA incluido).
   Con `montoBruto: 0`: `round2(importe × (1 + tasa/100))`.
3. `total = round2(suma de los totales de línea)`.
4. Si `redondear: true`, se redondea al entero más cercano.
Redondear **cada línea por separado** (calcular IVA sobre el total da diferencias → E15).
Si da E15, la `descripcion` trae el total que calculó Fixed.
**Nosotros: siempre `montoBruto: 1`** (nuestros precios incluyen IVA) → el total es la suma
de `round2(precio × cantidad − descuento)` por línea. Simple y sin sorpresas de IVA.

### 4.4 Reglas del cliente y largos
- Siempre obligatorio `nombreComercial` (si va cliente).
- RUT: `documento` RUT válido + `razonSocial`, `domicilio`, `localidad`, `departamento`.
- CI: si va documento, tiene que ser cédula válida (dígito verificador).
- 4/5/7: `pais` ISO-2; 4 y 7 además `razonSocial`. DNI (6): `pais` ∈ AR, BR, CL, PY.
- Falta o inválido → **E18**.
- **Venta > 5000 UI** (≈ USD 800 hoy): DGI exige `documento`, `domicilio`, `localidad` y
  `departamento` con cualquier tipo de documento → si falta, **E19**. Consumidor final
  anónimo NO sirve por encima de ese monto.
- Largos: `razonSocial` y `nombreComercial` 150 · `domicilio` 70 · `localidad` y
  `departamento` 30 (E18) · `descripcion` 80 · `descripcionLarga` 500 (E24) ·
  `observaciones` (adenda): la referencia dice 2000, la página de Límites y el índice de
  errores dicen 500 → **usamos ≤ 500** (E25).
- Identificación del cliente en Fixed (misma empresa y mismo tipoDocumento): busca por
  `documento`; si no, por `mailEnvioFactura` (sin mayúsculas/espacios); si no hay ninguno de
  los dos, crea siempre uno nuevo. → Mandar siempre el mail del cliente evita duplicar fichas.

### 4.5 Respuesta y qué guardar
Éxito (`codigoError` vacío): `idCFE` (clave para consultar, imprimir y anular), `idVenta`,
`serie`, `numero`, `tipoCFE`, `comprobante` ("e-Ticket A 1523"), `urlA4`, `urlTicket`,
`urlVerificarCFE`, `htmlTicket`, `pdfBase64` (PDF A4), `xml` (CFE firmado), `observaciones`.
URLs en `testing.fixed.uy` (testing) / `acceso.fixed.uy` (producción).
**Caso trampa:** HTTP 200, `codigoError` vacío y **URLs vacías** → el CFE YA SE EMITIÓ (falló
solo el armado del PDF; la `descripcion` trae el `idCFE`). **No reemitir**: pedir las URLs
con `/imprimirCFE`.

### 4.6 Errores de `/ventaCrear` y qué hace nuestro sistema
| Código | Significado | Reacción |
|---|---|---|
| E02 | moneda incorrecta | error de configuración → alerta |
| E03 | empresa no encontrada | config → alerta |
| E04 | sin firma electrónica vigente | bloquear facturación + alerta al admin |
| E05 | sin CAE disponible | bloquear + alerta (pedir CAE en Fixed/DGI) |
| E08 | fecha inválida | bug nuestro |
| E15 | total no coincide | bug de cálculo → loguear la `descripcion` con el total de Fixed |
| E18 | datos de cliente inválidos | mostrar al admin para corregir → intento nuevo |
| E19 | > 5000 UI sin datos del cliente | pedir documento y domicilio → intento nuevo |
| E20 | formaDePago inválida | bug |
| E21 | cotizacion ≤ 0 | bug / falta cotización |
| E22 | emisión en curso con esa key | reintentar más tarde con la MISMA key |
| E23 | key reusada con otros datos | bug nuestro → generar key nueva |
| E24 / E25 / E26 | largos o números inválidos | bug (validamos antes) |
| X01 | local inválido | config |
| X02 | tasa IVA no habilitada o descuento > importe de la línea | config / bug |
| X03 / X04 / X05 | error inesperado de Fixed | reintentar con la MISMA key |
| A01–A06, V01, V02 | credenciales / formato | config / bug |
| red / timeout | no sabemos si se emitió | reintentar con la MISMA key y el MISMO JSON |

---

## 5. Anular, consultar, imprimir

### 5.1 Nota de crédito — `POST /ventaDevolucionTotalCrear`
Cuerpo: `idCFE` (el de la venta original), `fecha`, `adenda` (obligatorio, `""` si nada,
máx. 2000 / usamos ≤500), `totalADevolver` (**exactamente** el total de la original, si no
E17), opcionales `cotizacion` (no mandar o `1` = la de la venta original, recomendado),
`ordenCompra`, `local` (vacío = el de la original), `idempotencyKey`.
- Respuesta = comprobante NUEVO (102 o 112): guardar SU `idCFE`, no pisar el original.
- No se puede sobre un CFE **rechazado** por DGI (E11). E10 = original no encontrada.
- URLs vacías → `/imprimirCFE` con el idCFE de la nota, no reemitir.
- Errores: E03, E04, E05, E08, E10, E11, E17, E21, E22, E23, E25, X03–X06.
- **Solo total.** Una devolución parcial (1 de 2 productos) no se puede por API → se hace
  desde la web de Fixed o se anula todo y se refactura lo que quedó.

### 5.2 Estado DGI — `POST /ventaConsulta` `{ idCFE }`
`estadoDGI`: `aceptado` (incluye reliquidado/observado) · `rechazado` (motivo en
`motivoRechazoDGI`) · `sinrespuesta` (normal los primeros minutos; NO reemitir).
No dispara una consulta nueva a DGI: devuelve lo que Fixed ya sabe (Fixed consulta solo en
segundo plano). C08 = el idCFE no es de esta empresa.

### 5.3 Impresión — `POST /imprimirCFE` `{ idCFE }`
Devuelve `urlA4`, `urlTicket`, `htmlTicket`, `pdfBase64`, `xml`, más `estadoDGI`. No emite
nada. Sirve para URLs vacías y para obtener el PDF (subirlo a Mercado Libre).

### 5.4 Facturación del día — `POST /consultaFacturacionDia` `{ fecha }`
Lista de comprobantes (`idCFE`, tipo venta/devolución, importe, moneda, cotización,
`creadaDesde` web/Fixed_API/…, `estadoDGI`). Éxito = `"0"`. Para conciliar: detectar CFE
emitidos por API que no tengamos registrados (p. ej. una respuesta perdida).

### 5.5 Próximo número — `POST /obtenerProximoNumero` `{ tipoDocumento, tipo }`
Solo informativo: **no reserva el número** (puede cambiar si se emite otro en el medio).

---

## 6. Cómo se traduce cada orden de RF Store a una venta de Fixed

Datos reales de la base (90 días): **ML 118 órdenes** (UYU, sin cliente, hasta $ 72.800),
**manuales 26** (mayormente USD, casi todas sin cliente y muchas **sin order_items**,
promedio USD 1.882 → muchas superan 5000 UI), **web 9** (MP/transferencia; 2 con RUT).
38 productos tienen nombre de más de 80 caracteres (máx. 94).

### 6.1 Moneda y montos
| Canal | Qué se cobró | Comprobante |
|---|---|---|
| Web MP / Getnet | pesos = `orders.total_original` (USD × dólar BROU congelado en `fx_rate`) | `moneda: "UYU"`, líneas en pesos |
| Web transferencia/depósito | según el medio (tiene `total_original` en pesos) | a definir con el cliente (UYU o USD con `cotizacion = fx_rate`) |
| Web híbrido (MP + transferencia) | parte pesos, parte dólares | un solo CFE, una sola moneda → definir (propuesta: UYU) |
| Mercado Libre | pesos (`ml_currency = UYU`, `total_original`) | `UYU`, **no convertir** |
| Manual | `ml_currency` (casi siempre USD) | esa moneda; si es USD, `cotizacion` = dólar BROU del día de la venta |

Decisión del cliente (27/10): cotización = dólar BROU de la tienda, IVA básico 22 % en todo,
un solo local.

### 6.2 Líneas
- Una línea por `order_item`: `cantidad`, `descripcion` = nombre del producto recortado a
  80 (+ variante si entra), `descripcionLarga` = nombre completo + variante (≤500),
  `codigo` = `external_code`/SKU, `tasaIva: "Basic"`, `rubro` (ver decisiones), precio en
  la moneda del comprobante con IVA incluido (`montoBruto: 1`), 2 decimales.
- Extras del checkout (`is_extra`) son líneas normales.
- **Envío** (`shipping_cost_usd` > 0): línea aparte "Envío a {departamento}", cantidad 1.
- **Cupón/descuento** (`discount_usd`): `descuentoMonto` repartido en las líneas (nunca
  mayor que el importe de la línea → X02). `precioUnitario` no puede ser 0 ni negativo, así
  que no existe "línea de descuento".
- **Ventas manuales sin items**: una línea con `manual_description` / concepto, cantidad 1,
  por el total.
- **ML con varios productos (pack)**: los precios por ítem en pesos no están guardados →
  repartir `total_original` proporcional a los precios en USD (o guardar el precio unitario
  en pesos al importar la venta, mejor).

### 6.3 Cuadre al centésimo (evitar E15 y que coincida con lo cobrado)
1. Convertir cada precio unitario: `round2(precio_usd × fx_rate)`.
2. Total según la regla de Fixed (4.3).
3. Comparar con lo cobrado de verdad (`total_original`). La diferencia de redondeo
   (centésimos, a veces 1 peso porque `total_original` se redondea al entero) se absorbe en
   la línea de cantidad 1 (envío o la última línea): ajustar su precio o su `descuentoMonto`.
4. `totalAPagar` = el total recalculado con la misma regla. Validar en el backend antes de
   mandar; si igual vuelve E15, loguear el total que dice Fixed.

### 6.4 Cliente
- **Con RUT** (checkout ya lo guarda en `orders.invoice_*`, 12 dígitos validados):
  `tipoDocumento 2`, `documento = invoice_rut`, `razonSocial = invoice_business_name`,
  `nombreComercial = invoice_trade_name || invoice_business_name`, `domicilio =
  invoice_address` (≤70), `localidad = invoice_city`, `departamento = invoice_state` (≤30),
  `mailEnvioFactura = invoice_email || customers.email`. → e-Factura 111.
- **Sin RUT, web**: `tipoDocumento 3` (CI) con documento vacío, `nombreComercial =
  full_name`, `domicilioEntrega` = dirección de envío, `mailEnvioFactura` = mail del cliente,
  `telefono`. → e-Ticket 101 a nombre del cliente (Fixed lo identifica por mail).
  Si supera 5000 UI → hace falta cédula + domicilio + localidad + departamento: el checkout
  hoy **no pide cédula** → o se pide en el checkout para compras grandes, o el admin la
  completa en el modal antes de facturar.
- **ML**: las órdenes no tienen cliente. Nombre y documento del comprador salen de ML
  (`buyer.billing_info` → `/orders/billing-info/MLU/{id}`). Pedir permiso de lectura en la
  app de ML si hace falta.
- **Manual sin cliente**: modal para cargar mail/documento, o consumidor final (`cliente:
  null`) si no supera 5000 UI.
- Validaciones locales antes de llamar: RUT (12 dígitos + dígito verificador DGI), CI
  (dígito verificador), largos, departamento válido.

### 6.5 Otros campos
- `fecha`: día de emisión en hora de Uruguay (`America/Montevideo`), `dd/mm/aaaa`.
- `local`: el id de "Central" (configurable; obligatorio enviarlo si hay más de un local).
- `formaDePago`: `contado`.
- `observaciones` (adenda): "Pedido web #474" / "Venta ML 2000012345" / "Venta manual #476"
  (≤500).
- `ordenCompra`: el id de la orden de RF Store (para encontrarla desde Fixed).
- `redondear: false`.

---

## 7. Diseño técnico

### 7.1 Base de datos (migración nueva)
Tabla `invoices` (una fila por CFE: venta o nota de crédito), RLS cerrada (solo admin lee;
escribe solo service_role):
- `id`, `order_id`, `kind` (`venta` | `nota_credito`), `parent_invoice_id` (la NC apunta a
  la venta), `environment` (`testing` | `produccion`).
- `status`: `enviando` → `emitida` (esperando DGI) → `aceptada` | `rechazada_dgi`; `error`
  (no se emitió); `anulada` (tiene NC aceptada).
- `idempotency_key` (uuid, único), `request_json` (lo enviado, para reintentar idéntico),
  `attempts`, `last_error_code`, `last_error_desc`.
- Respuesta: `id_cfe`, `id_venta`, `tipo_cfe`, `serie`, `numero`, `comprobante`, `moneda`,
  `total`, `cotizacion`, `url_a4`, `url_ticket`, `url_verificar`, `estado_dgi`,
  `motivo_rechazo_dgi`, `dgi_checked_at`, `pdf_path` (storage privado, para ML), `xml_path`.
- `created_by`, `created_at`, `updated_at`.
- Índice único parcial: **una sola venta viva por orden** (no `error`/`rechazada_dgi`/
  `anulada`) → imposible facturar dos veces la misma orden.
- En `orders`: columna derivada o vista con el estado de facturación para el listado.
- `app_settings.fixed_mode` (`off` | `testing` | `produccion`): interruptor, igual que
  Getnet. Nada secreto ahí.
- RPCs nuevas con `revoke`/`grant` explícitos (regla del proyecto).

### 7.2 Edge functions (verify_jwt = true, solo admins; el cron con service_role)
- `_shared/fixed.ts`: cliente HTTP (headers, `{}` en POST sin cuerpo, timeout, éxito vacío
  vs `"0"` por endpoint, HTTP 500 con `codigoError`), armado de la venta, cálculo del total
  igual a Fixed, recortes de largos, validación RUT/CI.
- `fixed-invoice-create` `{ order_id, cliente_override? }`: valida que la orden se pueda
  facturar (pagada, no cancelada, sin factura viva), arma el JSON, guarda la fila
  `enviando` + key + JSON, llama `/ventaCrear`, guarda el resultado. Si la red se corta:
  queda `enviando` y el reintento usa la misma key y el mismo JSON.
- `fixed-invoice-credit-note` `{ invoice_id, motivo }`: NC total sobre una venta
  `aceptada` (o `emitida`), misma lógica de key.
- `fixed-invoice-sync` (cron cada 10 min, solo si hay `emitida`/`enviando`): `/ventaConsulta`
  de las pendientes; `enviando` viejas → reintento con la misma key; URLs vacías →
  `/imprimirCFE`. Una vez por día: `/consultaFacturacionDia` para conciliar y
  `/consultaCAE` para avisar si se acaba la numeración (pocos números o vence).
- `fixed-invoice-pdf` `{ invoice_id }`: URL firmada del PDF para el panel (o directo
  `url_a4`).
- Alertas por mail al admin (como `alertAdmin` de Getnet): E04, E05, rechazo de DGI,
  CAE por acabarse.

### 7.3 Panel de admin (`DashboardOrderPage` + listado de órdenes)
- **Listado de órdenes:** columna/badge "Factura": Sin facturar · Enviando · Emitida
  (esperando DGI) · Aceptada · Rechazada DGI · Error · Anulada. Filtro por estado.
- **Detalle de la orden — bloque "Factura electrónica":**
  - Sin factura → botón **"Facturar"** → modal de vista previa: tipo que va a salir
    (e-Ticket / e-Factura), cliente (editable: tipo y número de documento, razón social,
    domicilio, localidad, departamento, mail), líneas, moneda, cotización y total.
    Avisos: "supera 5000 UI: falta documento y domicilio", "RUT inválido", etc.
    Botón opcional "Completar con DGI" (`consultarRUTDGI`). Confirmar → emite.
  - Emitida/aceptada → comprobante ("e-Factura A 123"), estado DGI, botones **Ver PDF**,
    **Verificar en DGI**, **Anular (nota de crédito)** con confirmación y motivo.
  - Rechazada DGI → motivo + **"Volver a facturar"** (intento nuevo, key nueva).
  - Error → código + explicación en castellano + **"Reintentar"** (misma key si fue
    red/E22/X0x; nueva si se corrigieron datos).
- Opción "No facturar" por orden (ventas que el cliente decide no facturar), para que no
  quede como pendiente.
- **Configuración** (en la página del interruptor, como Getnet): modo off/testing/
  producción, "Probar conexión" (`validarCredenciales` → muestra RUT y nombre), local,
  rubro por defecto, CAE disponibles.
- Cancelar una orden con factura aceptada → avisar "esta orden tiene factura: anulala con
  nota de crédito" (no anular solo).
- Reembolso de Getnet/MP sobre una orden facturada → sugerir la NC.

### 7.4 Entrega de la factura al cliente
- **Web:** en producción Fixed la manda a `mailEnvioFactura` (en testing no). Confirmar con
  Fixed remitente y formato. Además, opcional: link al PDF en nuestro mail o en "Mis pedidos".
- **ML:** subir el PDF a la venta (`POST /packs/{pack_id}/fiscal_documents`). Esa API está
  documentada para Brasil: **verificar que ande en MLU** antes de prometerlo.
- **Manual:** si tiene mail, lo manda Fixed; si no, el admin descarga el PDF.

---

## 8. Flujo completo de una factura

1. Admin abre la orden pagada → **Facturar** → vista previa → corrige datos → Confirmar.
2. Backend valida, arma JSON, calcula total como Fixed, genera `idempotencyKey`, guarda
   fila `enviando` con el JSON.
3. `/ventaCrear`:
   - éxito con URLs → `emitida` + datos del CFE;
   - éxito sin URLs → `emitida` + `/imprimirCFE`;
   - error de datos (E18/E19/E24…) → `error` con el mensaje; corregir = intento nuevo;
   - error transitorio / red / E22 / X0x → queda `enviando`, reintento con la misma key.
4. Cron: `/ventaConsulta` hasta `aceptado` (→ `aceptada`) o `rechazado` (→ `rechazada_dgi`
   + alerta; se puede volver a facturar).
5. Anular: **Anular** → `/ventaDevolucionTotalCrear` por el total exacto → fila nueva
   `nota_credito` → cuando DGI la acepta, la venta pasa a `anulada`.
6. Conciliación diaria con `/consultaFacturacionDia`.

---

## 9. Plan de pruebas en testing (antes de producción)

1. keepAlive, validarCredenciales, localesListado, consultaCAE (hecho, solo lectura).
2. e-Ticket consumidor final, 1 línea, UYU.
3. e-Ticket varias líneas + envío + cupón (descuentoMonto) — total al centésimo.
4. Orden web real convertida USD→UYU con el cuadre contra `total_original`.
5. e-Factura con RUT válido (datos del checkout).
6. Venta en USD con `cotizacion` (manual).
7. > 5000 UI sin documento → esperar **E19** y que el panel lo explique.
8. RUT/CI inválido → **E18**. Nombre de 94 caracteres → recortado, sin E24.
9. Idempotencia: mandar dos veces el mismo JSON con la misma key → mismo `idCFE`, un solo
   comprobante. Misma key con otro dato → **E23**.
10. Corte de red simulado (timeout) → reintento sin duplicar.
11. URLs vacías → `/imprimirCFE`.
12. Seguimiento DGI: `sinrespuesta` → `aceptado` (en testing ver cómo se comporta).
13. Nota de crédito de un e-Ticket (102) y de una e-Factura (112); `totalADevolver` mal →
    **E17**.
14. `consultaFacturacionDia` encuentra todo lo emitido.
15. Revisar cada PDF en `testing.fixed.uy`.
Cada prueba se explica antes de mandarla (como con Getnet): en testing no va a DGI.

## 10. Pasar a producción (checklist de la documentación + lo nuestro)

1. El cliente genera las claves de producción en `acceso.fixed.uy/accesoAPI` y las carga
   en Supabase (no por chat). Cambiar `FIXED_BASE_URL`.
2. `validarCredenciales` en producción (RUT 220006580014 sin "_old").
3. Firma electrónica vigente (si no, E04).
4. `consultaCAE` con `soloDisponibles: true` para 101, 102, 111, 112 (si no, E05).
5. `localesListado` en producción y guardar ese id.
6. Emitir un comprobante de bajo importe y verificar `codigoError`, `idCFE` y que `urlA4`
   abra en `acceso.fixed.uy`. (Después anularlo con NC si no corresponde.)
7. Keys nuevas (no reusar las de testing).
8. Interruptor `fixed_mode = produccion`.

---

## 11. Decisiones y preguntas pendientes

Para el cliente:
1. **Transferencias y depósitos:** ¿se factura en pesos o en dólares? ¿Y el pago combinado?
2. **Rubro:** ¿"Varios" para todo o la categoría del producto (Celulares, Notebooks…)?
3. **Compras de más de 5000 UI (≈ USD 800):** ¿pedimos cédula en el checkout cuando el
   total lo supera, o el admin la carga antes de facturar? (DGI la exige.)
4. **¿Qué órdenes se facturan?** ¿Todas las cobradas, o el admin elige? ¿Las ML también
   (ML no factura por el vendedor en Uruguay)?
5. **Fecha:** ¿se factura con la fecha del día de emisión? (La API permite otra fecha;
   DGI tiene reglas para fechas pasadas, consultarlo con el contador.)
6. Devoluciones parciales: por API no se puede; ¿se hacen desde la web de Fixed?

Para Fixed:
1. Remitente y formato del mail con la factura en producción; ¿se puede personalizar?
2. ¿Hay homologación o revisión antes de dar claves de producción? (Getnet la pidió.)
3. Contradicción en la doc: `observaciones`/`adenda` 500 o 2000 caracteres.
4. ¿Cómo responde `estadoDGI` en testing (pasa solo a aceptado)?

**Choque con Getnet (ley 19.210):** Placetopay pide el número de factura **al momento del
pago** para aplicar el descuento de IVA de la ley 19.210 (`additional.invoice`, máx. 9
caracteres), pero nuestra factura sale después, a mano, y `/obtenerProximoNumero` no reserva
el número. Esperar el ejemplo que mandó Getnet: si es obligatorio, hay que facturar
automáticamente al aprobarse el pago con tarjeta, o pedir excepción.

---

## 12. Orden de implementación sugerido

1. Migración (`invoices`, interruptor, RPCs con grants) + secrets de testing.
2. `_shared/fixed.ts` + `fixed-invoice-create` con pruebas 2–11 contra testing.
3. Panel: badge, bloque de factura, modal de vista previa, configuración.
4. `fixed-invoice-sync` (cron) + alertas.
5. Nota de crédito (pruebas 13).
6. ML: datos del comprador + subida del PDF (verificar MLU).
7. Conciliación diaria y chequeo de CAE.
8. Producción (sección 10).

---

## 13. Implementación (04/11/2026)

Decisiones del cliente aplicadas: moneda = la del cobro (MP/Getnet en pesos; transferencia,
depósito y combinado en dólares con el dólar BROU de la orden; ML y manuales en su moneda) ·
cédula obligatoria en el checkout por encima de 5000 UI · botón "Facturar" manual en TODAS
las órdenes (web, ML, manuales) · rubro = categoría del producto (configurable) · sin
homologación · observaciones ≤ 500.

| Pieza | Archivo |
|---|---|
| Tabla `invoices`, `customers.document_ci`, `app_settings.invoice_config`, cron | `supabase/migrations/20261104130000_fixed_invoices.sql` (aplicada) |
| Cliente Fixed, armado, cuadre, validaciones, reglas de negocio | `supabase/functions/_shared/fixed.ts` (`invoiceCurrency`, `buildDraft`, `fitLinesToTotal`, `validateDraft`, `buildVentaJson`) |
| Acciones del panel (config, preview, emit, retry, refresh, credit_note) | `supabase/functions/fixed-invoice/index.ts` |
| Seguimiento DGI y reintentos (cron 10 min) | `supabase/functions/fixed-invoice-sync/index.ts` |
| Acciones frontend + textos de estados | `src/actions/invoices.ts` |
| Bloque "Factura electrónica" + vista previa editable | `src/components/dashboard/orders/OrderInvoicePanel.tsx` (orden web/ML y modal de venta manual) |
| Estado en el listado de órdenes | `src/components/dashboard/orders/TableOrdersAdmin.tsx` |
| Configuración (interruptor, local, rubro, valor UI, probar conexión) | `src/components/dashboard/InvoiceSettingsSection.tsx` (en Configuración → Pagos) |
| Cédula en el checkout | `CdrCheckoutForm.tsx` + `ensureBuyerSession` + `src/helpers/documents.ts` |

Pruebas hechas contra testing con la librería real: e-Ticket consumidor final (A 57),
reintento con la misma clave = mismo comprobante, otra data con la misma clave = E23,
estado `sinrespuesta` justo después, nota de crédito (NC e-Ticket A 3), segunda NC sobre el
mismo documento = X05 "documento ya afectado", e-Factura con RUT (A 118), venta en USD con
cotización (A 58), > 5000 UI sin documento = E19, con cédula = OK (A 60), cliente sin
documento identificado por mail (A 59). Cuadre al centésimo probado con órdenes reales.

### Mercado Libre (04/11/2026, decidido)
- **Datos del comprador:** con el permiso de **facturación** activado en la app de ML
  (scope `urn:ml:mktp:invoices:/read-write`, activado y cuenta RFSTOREUY reconectada el
  04/11/2026) `GET /orders/{id}/billing_info` devuelve **200**: `doc_type` CI o RUT,
  `doc_number` y en `additional_info` FIRST_NAME/LAST_NAME o BUSINESS_NAME, STREET_NAME,
  STREET_NUMBER, CITY_NAME, STATE_NAME. Probado en 8 ventas: 7 CI y 1 RUT. Antes del
  permiso daba 403. `/orders/billing-info/MLU/{id}` da 404 (no sirve en MLU).
  `mlBillingReceptor()` lo convierte en receptor (CI o RUT validados con dígito
  verificador). Si falla o el documento no valida, sale a **consumidor final** y el admin
  lo puede corregir en la vista previa.
  ⚠ Reconectar ML SIEMPRE logueado como RFSTOREUY: el 04/11 se reconectó con otra cuenta
  (CACE8558528) y el sync de stock dio 403 durante 15 min.
- **Entrega:** el PDF de Fixed se sube a la venta con `POST /packs/{pack_id|order_id}/fiscal_documents`
  (doc oficial "Cargar y obtener facturas", act. 16/03/2026; PDF ≤ 1 MB, uno por pack; ML
  avisa al comprador por notificación y mail; sin restricciones para MLU). Al anular, `DELETE`
  del mismo recurso. **Sólo en producción** (un comprobante de prueba nunca va a una venta real).
  Columnas `invoices.ml_fiscal_document_id / ml_uploaded_at / ml_upload_error`
  (migración 20261104140000). Sin probar todavía: se prueba con la primera factura real.
- Fixed no tiene integración propia con Mercado Libre.
