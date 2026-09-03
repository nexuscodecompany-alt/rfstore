# WS de Productos de CDR — cómo lo usamos

Documentación vigente: **v2.0 (01/09/2026)** → `WS-Productos-CDR-v2.0-2026-09-01.pdf`
(el `.txt` es el texto extraído del PDF, para poder buscar y diffear).

La doc anterior (v1.0, con sólo 11 campos y el servicio `get_stock`) queda en
`historico/` únicamente como referencia. **No usarla.**

## Conexión

| | |
|---|---|
| WSDL | `https://www.cdrmedios.com/ws/productos/service.php?class=SublimewsProductosUsuariosCompleto&wsdl` |
| Protocolo | SOAP (rpc/encoded) |
| Método | `productos_con_galeria` |
| Credenciales | `CDR_EMAIL` + `CDR_TOKEN` (secrets de Supabase, NO están en Vercel) |

El `token` NO es la contraseña de la web: es una clave aparte del web service.

## Las 3 reglas que NO se pueden romper

1. **Fecha incremental obligatoria.** Guardar el momento de cada llamada y usarlo
   como parámetro `fecha` en la siguiente. Repetir el full sync (`2015-01-01`)
   **hace que CDR trance el usuario**. No es una recomendación de eficiencia: es
   condición de uso (sección 4.2 de la doc).
2. **Sincronizar mínimo 1 vez por día.** Un producto sin stock se sigue devolviendo
   sólo durante 24 h. Pasado ese plazo desaparece del feed y, como sólo actualizamos
   lo que recibimos, el stock queda **congelado para siempre sin ningún error**
   (sección 4.3). Ya nos pasó una vez.
3. **El cursor de fecha se avanza SÓLO si la corrida terminó bien.** Si falla y
   avanzamos igual, esos cambios se pierden para siempre. (Regla nuestra, derivada
   de la 1: con full sync una corrida fallida se recuperaba sola; con incremental no.)

## Los 24 campos

`codigo` `stock` `nombre` `copete` `descripcion` `descripcion_comercial` `marca`
`webmarca` `fabricante` `garantia` `vinculogarantia` `precio` `moneda` `pvp` `pvpml`
`gtin` `modelo` `nro_parte` `habilitado` `ancho` `alto` `profundidad` `peso` `categoria`
\+ `galeria[]` (`img`, `fecha`, `md5`).

## Trampas (sección 7 de la doc)

- **`habilitado`**: es decimal y puede llegar como `1`/`0` o `"1.0"`/`"0.0"` según el
  cliente SOAP. Comparar por igualdad falla. Único test válido: `Number(x) > 0`.
  El feed **incluye productos deshabilitados**: los filtramos nosotros.
- **Faltan claves enteras**: cuando un dato no está cargado, el servicio a veces
  omite la clave en lugar de mandarla vacía. Confirmado en los combos (código con `+`,
  ej. `MON368+SOP120`): llegan sin `marca`, sin `webmarca` y sin `garantia`.
  Acceder siempre con `?? ''`.
- **`descripcion` es HTML**, `copete` y `nombre` son texto plano.
- **`gtin` NO identifica al producto**: varias variantes (outlet, refurbished, con SO)
  comparten el mismo GTIN. El único identificador es `codigo`.
- **La URL de las imágenes cambia según el usuario que consulta.** Para detectar si
  una imagen cambió se compara el **`md5`**, nunca la URL.
- **Tipos mezclados**: `precio` llega como texto (`"92.00"`), `pvp` como número (`159`).
  Convertir siempre de forma explícita.
- **`pvp`/`pvpml` en 0 = "sin sugerido"**, no "gratis". Sólo el 8,6 % tiene sugerido.
  `precio` = lo que le pagamos a CDR · `pvp` = sugerido web · `pvpml` = sugerido ML
  (más alto, absorbe la comisión).
- **`categoria` es jerarquía**, niveles separados por `>>`.
- **Los errores vienen con HTTP 200**, dentro del string: `{"ERROR":"USUARIO NO CONFIGURADO"}`.
  Validar el contenido antes de procesar.

## Segundo servicio: `get_stock`

Consulta el stock de una lista puntual de códigos, en tiempo real. **No se habilita
por defecto** — hay que pedírselo a CDR. Lo usaría `cdr-check-stock` en el checkout.

## Dónde vive esto en el código

| Pieza | Qué hace |
|---|---|
| `supabase/functions/_shared/cdr-soap.ts` | Cliente SOAP (armado del sobre a mano) |
| `supabase/functions/cdr-sync-products/` | Sync de catálogo, precio, stock y contenido |
| `supabase/functions/cdr-fill-images/` | Relleno de imágenes faltantes |
| `supabase/functions/cdr-check-stock/` | Validación de stock en el checkout |
| RPC `cdr_bulk_update_stock_price` | Update de precio/stock en lote + reconciliación |
| RPC `cdr_bulk_update_content` | Detección de cambios de contenido por hash |

---

## Hallazgos NUESTROS (verificados contra el WS, no están en la doc de CDR)

Medidos el 03/09/2026 con la edge function `cdr-probe` (read-only), catálogo de 1857 productos.

### 1. Los productos deshabilitados IGNORAN el filtro de fecha

**Los productos con `habilitado = 0` se devuelven SIEMPRE, en toda respuesta, sin importar
qué `fecha` se pida.** Verificado pidiendo una fecha de *pasado mañana*: devolvió 52
productos, los 52 con `habilitado = 0` y ninguno habilitado.

Es el mecanismo de CDR para avisar "este producto ya no va más", y es una buena noticia:
no hace falta esperar al full sync para enterarse de una baja. Vienen en cada llamada
incremental, con `stock = 0`.

Consecuencia para el diseño: en una corrida incremental los deshabilitados pueden ser la
MAYORÍA del payload (52 de ~60). Hay que filtrarlos siempre, y nunca darlos de alta.

### 2. Los porcentajes reales de llenado (catálogo completo, no la muestra de la doc)

Mejores que los publicados en varios campos:

| Campo | Doc v2.0 | Real medido |
|---|---|---|
| `peso` `ancho` `alto` `profundidad` | ~68 % | **~64 %** (ver nota) |
| `nro_parte` | 63,8 % | 62,5 % |
| `gtin` | 84,4 % | 84,2 % |
| `garantia` | 96,9 % | 96,7 % |
| `marca` | 96,8 % | 96,6 % |
| `modelo` | 77,7 % | 78,0 % |
| `categoria` `descripcion` `precio` | 100 % | 100 % |
| `pvp` **mayor a 0** | 8,6 % | 8,8 % (163 de 1857) |
| `pvpml` mayor a 0 | — | 4,9 % (91 de 1857) |

`descripcion` viene con HTML en 1857 de 1857. Las 3857 imágenes traen `md5`.

> **Corrección al medir contra la base (03/09, después del backfill).** El sondeo contaba
> un campo como "cargado" si la clave venía con algo, y `peso` llega como `"0"` en muchos
> productos: eso es *clave presente, dato ausente*. Contando sólo valores mayores a 0, las
> medidas dan **~64 %** (1183 de 1853 con peso, 1229 con las tres medidas), que es lo que
> decía la doc. **La doc tenía razón y el sondeo la subestimó como mejora.** Vale para
> cualquier campo numérico: `0` no es un valor, es un vacío disfrazado — igual que `pvp`.

### 3. Peso real de cada tipo de llamada

| Llamada | Productos | Payload | Tiempo |
|---|---|---|---|
| Full sync (`2015-01-01`) | 1857 | **4,0 MB** | 8,1 s |
| Incremental 24 h | 464 | 986 KB | 3,2 s |
| Incremental 1 h | 53 | 114 KB | 0,8 s |

Con 168 full syncs diarios eso eran **~672 MB/día**. Incremental + 2 full: **~24 MB/día**.

### 4. `get_stock` NO responde "USUARIO NO CONFIGURADO"

Responde `{"ERROR":"NO SE RECIBIERON PRODUCTOS"}` en 96 ms. O sea el servicio **existe,
acepta nuestras credenciales y contesta**: lo que rechaza es cómo le mandamos el array
`productos` en el sobre SOAP (rpc/encoded). Puede ser un problema NUESTRO de encoding,
no de habilitación. Antes de pedirle nada a CDR, probar variantes del array.

---

## Flujos revisados al migrar a la v2.0 (03/09/2026)

Todo lo que toca el WS de CDR o depende del sync, y cómo quedó.

| Flujo | Estado | Nota |
|---|---|---|
| `cdr-sync-products` | ✅ v31 | Cursor incremental, filtro `habilitado`, `p_reconcile` |
| `cdr_bulk_update_stock_price` | ✅ | `p_reconcile` explícito; matado el bug del umbral `>= 1500` |
| Crons de CDR | ✅ | Un tick cada 5 min + full feed 2×/día; `new-only` horario apagado (lo cubre el tick) |
| Trigger → cola → ML | ✅ sin cambios | `variants_stock_to_ml` se dispara por cambio de `stock`, no le importa de dónde venga |
| `health-alerts` | ✅ v5 | Ver abajo: tenía un chequeo que iba a dar falsos críticos |
| Panel `/dashboard/cdr-sync` | ✅ | `cdr_last_full_sync` se sigue actualizando en toda corrida (v31) |
| `cdr-daily-digest` | ✅ sin cambios | Lee `products.created_at` y `cdr_content_changed_at`, no el reporte del sync |
| `cdr-check-stock` (checkout) | ⚠️ sin cambios | Sigue con el `get_stock` muerto; cae al stock de la base, que es correcto |
| `cdr-fill-images` | ⚠️ sin cambios | Ver abajo |

### Lo que se rompía y no era obvio

**`health-alerts` iba a mandar falsos críticos.** El chequeo `cdr_feed_drop` comparaba
"cuántos productos trajo la última corrida" contra la mediana de las anteriores. Con el
sync incremental esa comparación perdió sentido: una corrida trae 0-60 productos y el full
feed 1857, así que tarde o temprano iba a reportar *"el feed de CDR cayó a 54 productos"*
por mail al dueño, siendo el funcionamiento normal. Ahora compara **full contra full**.

**Faltaba la red de seguridad.** Al pasar a incremental, la reconciliación por ausencia sólo
corre en el full feed (2×/día). Si ese cron se apaga, **nadie se enteraba**: los incrementales
seguirían corriendo lo más bien y el stock de los productos que CDR deja de mandar quedaría
congelado, que es exactamente el incidente PAR301. Nuevo chequeo `cdr_full_feed_stale`: avisa
si pasan 14 h sin un full feed (se esperan cada 12 h, y la ventana de CDR es de 24 h).

**Los rate limit ya no cuentan como fallas.** Son autolimitantes y el cursor no avanza, así que
no se pierde nada: llenar el reporte diario con eso sería ruido sin acción posible.

### Pendientes conocidos (no bloquean, pero conviene saberlos)

- **`cdr-fill-images` sigue pidiendo el catálogo COMPLETO** (fecha `2015-01-01` hardcodeada),
  1 vez por día a las 08:20 UTC. Son 4 MB y una llamada más en esa hora concreta (13 en vez
  de 12). Riesgo bajo y se recupera solo, pero si aparece un rate limit a esa hora, es esto.
  Tampoco filtra `habilitado`: puede bajar imágenes de productos despublicados.
- **`health-alerts` no está en el repo** (nunca estuvo). Vive sólo en Supabase. Bajarla con
  el MCP o el CLI antes de tocarla.
- **`cdr-check-stock`** hace un round-trip inútil a `get_stock` en cada checkout. El resultado
  es correcto (cae a la base), pero es latencia al pedo. Ver `historico/`.

---

## Los 24 campos, dónde quedan guardados

Los 13 campos nuevos van a columnas `cdr_*` de `products`, **fuera del hash de contenido**.

| Campo del WS | Columna | Notas |
|---|---|---|
| `marca` | `cdr_marca` | Sugiere `brand_id`, no lo pisa |
| `webmarca` · `fabricante` | `cdr_marca_url` · `cdr_fabricante_url` | |
| `categoria` | `cdr_categoria` | Jerarquía con `>>`. **No** se mapea sola |
| `garantia` · `vinculogarantia` | `cdr_garantia` · `cdr_garantia_url` | |
| `descripcion_comercial` | `cdr_descripcion_comercial` | |
| `gtin` · `modelo` · `nro_parte` | `cdr_gtin` · `cdr_modelo` · `cdr_nro_parte` | Antes vivían como texto dentro de `features` |
| `pvp` · `pvpml` | `cdr_pvp_usd` · `cdr_pvpml_usd` | **0 se guarda como NULL** (7.7) |
| `peso` · `ancho` · `alto` · `profundidad` | `cdr_peso_gramos` · `cdr_ancho_cm` · `cdr_alto_cm` · `cdr_profundidad_cm` | 0 → NULL |
| `habilitado` | `cdr_habilitado` | `false` = CDR lo despublicó |

**Por qué en columnas aparte y no en el hash de contenido:** el hash es
`md5(nombre + copete + descripcion + modelo)` y cambiarle la fórmula marcaría de golpe los
1857 productos como "cambiados" — pisando nombre y descripción de todo lo no bloqueado,
prendiendo `ml_content_dirty` en todo lo publicado en ML y disparando un mail gigante. Estos
son **dato crudo del proveedor**, no contenido editable: se refrescan siempre, sin tocar nada
que el admin haya editado, y el candado `content_locked` sigue valiendo igual que antes.

El RPC `cdr_bulk_update_fields` sólo escribe cuando algo cambió de verdad, así que las 288
corridas diarias no generan escrituras ni disk IO al pedo.

### Marca automática

`cdr_autoassign_brands(p_apply)` asigna `brand_id` por **match exacto** de nombre, y sólo
sobre productos con `brand_id` NULL: una marca puesta a mano nunca se pisa. `p_apply=false`
es dry-run. El trigger `cdr_assign_brand_on_insert` hace lo mismo en las altas nuevas — va
en la base y no en la edge function para que valga por cualquier vía de alta.

Aplicado el 03/09: **345 productos** (342 inactivos, 3 activos). Marcas que CDR manda y no
tenemos dadas de alta: Hollyland (9), Conatel (4), ViviEye (2), Autor, Planar.

**La categoría NO se automatiza.** `cdr_categoria` es la jerarquía de CDR y no mapea 1 a 1
con nuestro árbol; equivocarla mueve productos de lugar en la tienda. Queda guardada como
referencia para clasificar a mano.

### Marcas que CDR manda y no tenemos

El caso inverso, que es el que generaba trabajo invisible: CDR empieza a traer una marca que
no existe en la tienda, esos productos entran sin marca y no se entera nadie hasta que alguien
los mira uno por uno.

`cdr_pending_brands()` (sólo admin) las lista con cuántos productos espera cada una y un par de
ejemplos. Se ve en dos lugares, y en los dos sólo aparece si hay algo pendiente:

- **Productos** — filtro **"Marca por crear"**, al lado de *Nuevos desde CDR* y con el mismo
  comportamiento: badge con el conteo, se prende y apaga, entra en *Limpiar filtros* y vive en
  la URL (`?sinmarca=1`), así que el filtro sobrevive a entrar a un producto y volver con atrás.
  Sólo aparece si hay alguno esperando. Además, en la columna Marca esos productos muestran
  **"Falta crear"** con el nombre que manda CDR, para ver cuál no conviene activar todavía.
- **Categorías, marcas y proveedores** — la lista de marcas pendientes con el botón para crearlas.
  Es donde se hace la acción.

El filtro del listado NO cruza contra `brands`: cuando la marca existe, el trigger ya le puso el
`brand_id`, así que quedarse sin marca teniendo `cdr_marca` **es** la señal de que falta crearla.
Un filtro barato que no necesita subconsulta.

**Las marcas NO se crean solas, a propósito.** Las crea el admin, igual que decide qué producto
nuevo activar. Lo automático es lo de después.

El trigger `brand_claim_cdr_products` sobre `brands` cierra el círculo: al **crear** una marca
—o al **corregirle el nombre**, si se cargó con un typo— se lleva de una todos los productos de
CDR que la estaban esperando. Va en la base y no en el panel para que valga por cualquier vía de
alta. Verificado: crear "Hollyland" asoció 12 productos en el acto.

Con eso quedan cubiertos los dos sentidos: producto nuevo de marca conocida (se asigna al entrar)
y marca nueva con productos ya esperando (se asignan al crearla).
