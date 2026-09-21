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

## Arquitectura del sync: qué corre, cuándo y para qué

**Las dos mitades son distintas y ninguna reemplaza a la otra.** Precio/stock necesitan
frecuencia; las altas necesitan el catálogo completo. Pedir el catálogo completo seguido hace
que CDR bloquee el usuario, así que la única forma de tener las dos cosas es separarlas:

| Cron | jobid | Frecuencia | Modo | Feed | Para qué |
|---|---|---|---|---|---|
| `cdr-sync-5min` | 8 | cada 5 min | `full` | incremental | **Precio y stock en casi tiempo real.** Barato (8-60 productos). También ve las bajas: los deshabilitados vienen siempre (Hallazgo 1) |
| `cdr-sync-fullfeed` | 27 | 06:40 y 18:40 UTC | `full` + `full_feed` | **completo** | **Altas** + reconciliación por ausencia (apaga el stock de lo que CDR dejó de mandar) |
| `cdr-fill-images` | 20 | 08:20 UTC | — | completo | Rellena imágenes faltantes |
| `cdr-daily-digest` | 19 | 09:00 UTC | — | — | Mail al cliente con los productos nuevos del día |
| `cdr-sync-daily-newonly` | 3 | **APAGADO** | `new-only` | — | Obsoleto: `full` ya hace altas + updates. No reactivar (ver incidente) |

Son **3 llamadas de catálogo completo por día** (2 del fullfeed + 1 de imágenes) y ~288
incrementales. Dentro de lo que la doc de CDR tolera.

**Por qué `mode: 'full'` en los dos:** `full` = `new-only` + `update-prices`. Lo que cambia el
comportamiento **no es el modo sino `full_feed`**, que decide si se pide el catálogo entero y si
se reconcilia (`index.ts:359` y `:449`). Un `full` sin `full_feed` es un incremental que
actualiza; con `full_feed` es la corrida completa que además da de alta.

### Reglas para no volver a romperlo

1. **Las altas cuelgan del feed completo, nunca del incremental** (Hallazgo 5).
2. **Todo cron que pida el catálogo completo se cuenta**: son 3/día. Agregar uno es decisión
   consciente, no un detalle.
3. **`to_insert > 0` con `inserted = 0` sostenido es una falla**, aunque `ok: true`. Es
   exactamente lo que se vio 36 corridas seguidas sin que nadie lo notara.
4. Los productos nuevos entran `active = false`, sin marca ni categoría: **no se publican
   solos**, esperan al admin. Un alta nunca es destructiva.

---

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

### 5. El feed incremental NO trae los productos nuevos

**La regla más cara de todas, y contradice la letra de la doc de CDR.** La sección 3 dice que
`fecha` "devuelve solo los productos **creados** o modificados desde ese momento". En la
práctica, **los productos nuevos NO aparecen en una llamada incremental**: sólo llegan cuando
se pide el catálogo completo (`fecha = 2015-01-01`).

Evidencia dura (incidente del 03/09 al 21/09/2026):

| Modo | Llamadas | `to_insert` | Resultado |
|---|---|---|---|
| `full` incremental (cada 5 min) | ~5.200 corridas en 18 días | **0 siempre** | Nunca vio un alta |
| `update-prices` full feed (2×/día) | 36 corridas | **55 constante** | Las veía todas |

La corrida del `new-only` del 03/09 lo dejó por escrito: pasó a incremental por el cursor nuevo,
trajo 53 productos y **los 53 eran deshabilitados** (`disabled_in_feed: 53`, `to_insert: 0`).
Ese mismo modo, en full feed, venía insertando 16 productos por día.

**Consecuencia de diseño, no negociable:**

> El incremental sirve para **stock y precio**. Las **altas sólo se detectan en el feed completo.**
> Cualquier rediseño del sync que deje las altas colgando del incremental vuelve a romper esto,
> en silencio y sin un solo error en los logs.

## Flujos revisados al migrar a la v2.0 (03/09/2026)

Todo lo que toca el WS de CDR o depende del sync, y cómo quedó.

| Flujo | Estado | Nota |
|---|---|---|
| `cdr-sync-products` | ✅ v31 | Cursor incremental, filtro `habilitado`, `p_reconcile` |
| `cdr_bulk_update_stock_price` | ✅ | `p_reconcile` explícito; matado el bug del umbral `>= 1500` |
| Crons de CDR | ⚠️ corregido 21/09 | Un tick cada 5 min + full feed 2×/día; `new-only` apagado. **La nota "lo cubre el tick" era FALSA y costó 18 días sin altas** — ver "Hallazgo 5" y el incidente del 03/09 |
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

### INCIDENTE: 18 días sin altas (03/09 → 21/09/2026) — RESUELTO

**Síntoma:** el cliente preguntó si desde el 03/09 no entraban productos nuevos. Tenía razón:
última alta el 03/09, **cero en 18 días**, con 55 productos acumulados esperando (celulares
Xiaomi Poco C85/C81 Pro, cámaras Canon y Kodak — mercadería vendible).

**Causa.** Al migrar al cursor incremental (v29/v30, 03/09) las altas quedaron huérfanas por la
combinación de dos cosas, ninguna visible en los logs:

1. Se apagó el cron `new-only` anotando *"lo cubre el tick de 5 min"*, porque `mode: 'full'` dice
   ser "altas Y update". Es cierto que inserta — pero corre **incremental**, y el incremental no
   trae altas (Hallazgo 5). `to_insert: 0` en ~5.200 corridas.
2. La única corrida que pedía el catálogo completo (`cdr-sync-fullfeed`, 2×/día) iba en modo
   `update-prices`, que **calcula `to_insert` y no inserta**: el bloque de alta excluye ese modo
   (`index.ts:420`). Registró `to_insert: 55, inserted: 0` — 36 corridas seguidas.

> El modo que **veía** las altas no las insertaba; el que **insertaba** no las veía.
> Las dos corridas decían `ok: true`. Ningún error, ninguna alerta, 18 días.

**Arreglo (21/09):** `cdr_sync_fullfeed_tick` pasó de `mode: 'update-prices'` a `mode: 'full'`.
Una palabra, **cero llamadas nuevas al WS** — la corrida completa ya existía, ahora además da de
alta. Verificado: `to_insert: 55 → inserted: 55, backlog: 0`, los 55 entraron `active = false`.

**Bug de paso, encontrado en el camino (también arreglado):** el feed completo venía con
`ok: false` desde el 18/09 por
`content_update: null value in column "features" violates not-null`. Un producto de CDR sin
copete **ni** modelo **ni** nro_parte **ni** GTIN llega con `features: []`; en
`cdr_bulk_update_content`, `array_agg` sobre cero filas devuelve `NULL` y revienta el lote
entero de contenido. Arreglado con `coalesce(..., '{}'::text[])`. Efecto medido: la sincro de
contenido pasó de `content_applied: 0-1` a **219** en la primera corrida.

**Lo que falló como proceso:** la nota "lo cubre el tick" se escribió sin verificarla contra una
corrida real. Un `to_insert: 55 / inserted: 0` sostenido estuvo a la vista 36 veces.

### Pendientes conocidos (no bloquean, pero conviene saberlos)

- **`cdr-fill-images` sigue pidiendo el catálogo COMPLETO** (fecha `2015-01-01` hardcodeada),
  1 vez por día a las 08:20 UTC. Son 4 MB y una llamada más en esa hora concreta (13 en vez
  de 12). Riesgo bajo y se recupera solo, pero si aparece un rate limit a esa hora, es esto.
  Tampoco filtra `habilitado`: puede bajar imágenes de productos despublicados.
- ~~**`health-alerts` no está en el repo**~~ **RESUELTO 21/09**: ya vive en
  `supabase/functions/health-alerts/` (v6). OJO al redeployarla: el CLI no puede bundlear en
  este entorno (falla el certificado de esm.sh) y **el deploy por MCP la deja en
  `verify_jwt = true`**, que es lo contrario de como estaba. El cron la llamaba SIN
  `Authorization`, así que eso la dejó devolviendo 401. Ahora el cron 22 usa
  `public.health_alerts_tick()`, que manda el JWT del Vault igual que los ticks de CDR, y
  ya no depende de que la función esté abierta.
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

Se ve en **Categorías, marcas y proveedores**, dentro de la tarjeta de Marcas: la lista de las
que faltan, con cuántos productos espera cada una, un ejemplo real y el botón para crearla. Sólo
aparece si hay alguna pendiente. Está ahí y no en el listado de productos a propósito: es donde
se administran las marcas, que es donde se hace la acción.

### Los TRES momentos en que se resuelve una marca

Hay que cubrirlos a los tres o el panel miente. Faltaba el tercero y por eso Xiaomi, Brateck y HP
figuraban como "falta crear" con la marca perfectamente creada:

| Momento | Quién lo resuelve |
|---|---|
| Producto nuevo cuya marca ya existe | `cdr_assign_brand_on_insert` |
| Marca nueva con productos esperándola | `brand_claim_cdr_products` |
| **Producto viejo al que el sync recién ahora le llena `cdr_marca`** | `cdr_assign_brand_on_insert` (ampliado a `UPDATE OF cdr_marca`) |

El tercero es el que se pasó por alto: los productos que entraron antes de que existieran las
columnas `cdr_*` no tenían `cdr_marca`. El sync se la fue completando después, pero para entonces
ya no eran un INSERT, así que nadie les asignaba el `brand_id` aunque la marca existiera.

Con los tres cubiertos, **"sin `brand_id` teniendo `cdr_marca`" significa de verdad "esa marca no
existe"**. Antes no era cierto, y cualquier consulta que asumiera eso daba un resultado engañoso.

**Las marcas NO se crean solas, a propósito.** Las crea el admin, igual que decide qué producto
nuevo activar. Lo automático es lo de después.

El trigger `brand_claim_cdr_products` sobre `brands` cierra el círculo: al **crear** una marca
—o al **corregirle el nombre**, si se cargó con un typo— se lleva de una todos los productos de
CDR que la estaban esperando. Va en la base y no en el panel para que valga por cualquier vía de
alta. Verificado: crear "Hollyland" asoció 12 productos en el acto.

Con eso quedan cubiertos los dos sentidos: producto nuevo de marca conocida (se asigna al entrar)
y marca nueva con productos ya esperando (se asignan al crearla).

---

## Chequeos de consistencia (correr cuando algo huela raro)

```sql
-- 1. ¿Entran altas? Si esto tiene más de ~2 días y CDR sigue publicando, algo se rompió.
select max(created_at) from products where source = 'cdr';

-- 2. LA SEÑAL QUE SE NOS PASÓ 18 DÍAS: detecta nuevos y no inserta ninguno.
select created_at, mode, report->>'feed_mode' as feed, to_insert, inserted, ok
  from cdr_sync_run_history
 where report->>'feed_mode' = 'full'
 order by created_at desc limit 5;
-- to_insert > 0 con inserted = 0, sostenido, es una FALLA aunque diga ok: true.

-- 3. El feed completo tiene que correr 2 veces al día y terminar ok.
select count(*) from cdr_sync_run_history
 where report->>'feed_mode' = 'full' and ok and created_at > now() - interval '24 hours';

-- 4. Stock congelado: productos con stock que el feed completo no confirma hace días.
select count(*) from products p join variants v on v.product_id = p.id
 where p.source = 'cdr' and v.stock > 0
   and (p.last_synced_at is null or p.last_synced_at < now() - interval '48 hours');

-- 5. Productos rotos (sin variante = sin precio ni stock, no vendibles).
select external_code, name from products p
 where p.source = 'cdr'
   and not exists (select 1 from variants v where v.product_id = p.id);
```

### Estado al 21/09/2026, después del arreglo

| Chequeo | Valor | Lectura |
|---|---|---|
| Stock congelado >48 h | 0 | ✅ la reconciliación funciona |
| Productos sin variante | 3 | ⚠️ `MON242O`, `KIT11`, `IMP133+BOT16-19` — los tres de la carga inicial del 22/05 e **inactivos**, así que no se venden ni molestan. Limpieza pendiente, sin urgencia |
| Productos sin imágenes | 11 | ✅ explicado: son los que CDR ya no manda (`not_in_feed` del `cdr-fill-images`) |
| Inactivos sin categoría | 2855 | ℹ️ backlog de **clasificación**, no del sync: más de la mitad del catálogo de CDR nunca se publicó. Es decisión comercial, pero conviene que el dueño sepa el tamaño |
| Full feeds ok en 24 h | 1 | ⚠️ era 0: los anteriores morían con `ok: false` por el bug de `features`. Desde el arreglo vuelven a ser 2/día |

---

## El vigilante: por qué no avisó (21/09/2026)

El reporte diario llegaba todos los días a `facundohernandez122@gmail.com` — pero el 19 y el
20/09 decía **"todo en orden"** mientras las altas llevaban 16 días caídas. Dos agujeros:

**1. No había ningún chequeo de altas.** Se vigilaba que el sync *corriera* y que el stock no
quedara congelado, pero nunca que *entraran productos nuevos*.

**2. `cdr_failed_runs` miraba "las últimas 20 corridas" sin distinguir el tipo.** Con 288
incrementales por día, **20 corridas son 90 minutos**. Un full feed que corre cada 12 h no cae
nunca en esa ventana: por eso el `ok: false` del full feed, que venía desde el 18/09, no se
reportó ni una vez. El chequeo no estaba roto — estaba mirando el lugar equivocado.

### Chequeos nuevos (v6)

| Chequeo | Severidad | Qué mira |
|---|---|---|
| `cdr_insert_stalled` | 🔴 crit | El full feed detecta productos para dar de alta y no inserta ninguno. **Es la señal exacta que estuvo a la vista 36 corridas seguidas** |
| `cdr_no_new_products` | 🟠 → 🔴 a los 7 días | Días sin que entre un alta. Red de seguridad por si el fallo viene por otro lado |
| `cdr_full_feed_failed` | 🔴 crit | Full feeds que terminaron mal, mirados **sobre sus propias corridas**, no mezclados con los incrementales |

Al deployar la v6 el chequeo nuevo disparó de entrada: *"7 de las últimas 8 corridas de catálogo
COMPLETO de CDR fallaron"* — las del bug de `features`, que nunca se habían reportado.

### Trampa al redeployar health-alerts

El deploy por MCP deja `verify_jwt = true`, y el cron la llamaba **sin `Authorization`** → 401.
El vigilante se habría quedado mudo justo después de arreglarlo. Resuelto con
`public.health_alerts_tick()`, que manda el JWT del Vault igual que los ticks de CDR.
**Después de cualquier deploy de health-alerts, verificar que el tick devuelva 202:**

```sql
select public.health_alerts_tick();
select id, status_code, left(content,60) from net._http_response order by id desc limit 1;
```

---

## "Stock actualizado": detectar el stock que CDR arrastra (21/09/2026)

**El problema:** CDR puede mandar un producto en el feed todos los días con la misma cantidad
desde hace meses. El feed lo confirma, pero el número puede no ser real.

**Por qué no servía lo que ya había:** `products.last_synced_at` dice cuándo lo **vimos** en el
feed, no cuándo **cambió** el número. Como el feed completo pasa 2 veces por día por todo el
catálogo, para el 100% de lo que tiene stock da "hoy". No distingue nada.

**Lo que se agregó:** `products.stock_changed_at`, que se marca **sólo cuando `total_stock`
cambia de valor**. Se resuelve dentro del `UPDATE` que ya hacía `recalc_product_total_stock`,
comparando el total viejo contra el nuevo, así que **no agrega escrituras** al camino caliente
del bulk de CDR (1800+ productos por corrida). Como cuelga del recálculo, captura el cambio
venga de donde venga: CDR, una venta, ML o una edición manual.

**Backfill:** `ml_sync_log` guarda el stock empujado a ML desde el 11/06/2026; de ahí se derivó
la última vez que ese número cambió para 1154 productos. El resto queda en `null` ("—" en el
panel) y se va completando solo.

**En el panel:** la columna que antes decía **"Fecha"** (y mostraba `created_at`, la fecha de
ALTA) pasó a llamarse **"Modificado"** y muestra `stock_changed_at`. Es el orden por defecto del
listado, descendente: al entrar se ve lo último que CDR movió. La fecha de alta no se perdió,
quedó en el tooltip. Se completa con el chip **"Solo con stock"**.

> **Las tres fechas que se confundían** (esto costó una tarde entera de ida y vuelta):
> | Columna | Qué es | Sirve para |
> |---|---|---|
> | `created_at` ("Fecha", vieja) | cuándo se dio de alta el producto | nada del stock: **no cambia nunca** |
> | `last_synced_at` ("Visto en CDR") | cuándo lo vimos en el feed | nada: el feed completo pasa 2×/día por TODO, así que dice "hoy" para el 100% de lo que tiene stock |
> | `stock_changed_at` ("Modificado") | cuándo CDR **cambió el número** | esto es lo que el admin mira |
>
> El síntoma clásico de la confusión: "la fecha más nueva es del 3/9 y no se mueve". Era
> `created_at`, y el 3/9 fue la última alta antes de que se rompieran (ver el incidente).

**El orden NO se guarda en la URL** (a diferencia de los filtros, que sí). Invertirlo es un solo
click sobre el encabezado, y al persistirlo el listado quedaba pegado al revés: se entraba al
panel y lo más viejo aparecía arriba, sin que fuera obvio por qué ni cómo volver. Vive en estado
local, así que **cada vez que se entra se arranca del estándar** (lo último que CDR movió,
arriba). "Limpiar filtros" también lo resetea.

Un producto sin fecha es uno cuyo stock no se movió desde que se empezó a medir, así que en el
orden descendente cae al fondo, que es justo donde corresponde. Al estrenarlo apareció un
`DRO15 — Dron Potensic ATOM` con 10 unidades y **102 días sin que CDR lo toque**.

## Botón "Descargar CSV" del listado de productos

Exporta el **catálogo entero** (no la página ni los filtros aplicados): código, producto, marca,
categoría, origen, si está publicado en RF Store y el estado en ML, stock, costo, ventas
(unidades totales y separadas por canal), última venta, "stock actualizado", visto en CDR,
candados y el rubro de CDR.

Detalles que importan:

- Sale de la RPC `export_products_report()`, que devuelve **un solo `jsonb`**. Si devolviera
  filas, PostgREST lo cortaría en `max_rows` (5000) y el catálogo ya tiene 5217 — **en silencio
  y sin error**, que es la peor forma de perder datos. Ver [tope de filas](#).
- Sólo ventas en estado `Concretado`, y sin los extras del checkout (`is_extra`).
- La RPC valida `is_admin()` adentro y sólo tiene `execute` para `authenticated`/`service_role`.
- El CSV se arma en el front con `;` como separador y BOM UTF-8: es lo que hace que Excel en
  español lo abra en columnas y no rompa los acentos. Los valores que empiezan con `= + - @` se
  neutralizan para que Excel no los tome como fórmula.

---

## Mapeo automático de categorías (21/09/2026)

CDR manda el rubro en el campo `categoria` (jerarquía `Audio Imagen >> Parlantes`, viene al
100%), se guardaba en `products.cdr_categoria` y **nadie lo usaba**: las altas entraban sin
categoría y había que clasificarlas a mano de a una. La marca sí se resolvía sola.

### Cómo funciona

| Pieza | Qué hace |
|---|---|
| `cdr_category_map` | Tabla `rubro de CDR → categoría + subcategoría`. 124 filas |
| `cdr_derive_category_map(min_confianza)` | La deduce de lo que el dueño ya clasificó a mano |
| `trg_products_map_cdr_categoria` | Trigger en `products`: completa la categoría en el alta |

**La tabla se deduce sola.** Cada vez que el dueño clasificó un producto a mano dejó dicho que
ese rubro de CDR va en esa categoría; lo hizo 1161 veces. Si las N veces que tocó un rubro las
mandó todas a la misma categoría, esa decisión ya está tomada.

**Rubros sin historial propio** (CDR estrena rubros seguido) caen al **prefijo más largo** que
sí lo tenga. Esto importa más de lo que parece: `Impresión >> Impresión 3D >> Filamentos >>
PETG - Sunlu` no existía, pero `Impresión >> Impresión 3D >> Filamentos` sí, y lo resuelve al
100%. **Por primer nivel habría caído en "Impresoras e Insumos", junto con los cartuchos.**

**Umbral de confianza (85%).** Por debajo NO se mapea y el rubro queda pendiente de una persona.
No es un detalle de prolijidad: `Energía >> Pilas y Cargadores` se deduce como **"Seguridad"**
con 56% (históricamente los UPS de Energía se clasificaron ahí), y unas pilas en Seguridad es
peor que no clasificarlas.

### Por qué es un trigger y no va en la edge function

Cubre **cualquier** camino de alta (el sync, una carga manual, un backfill) y no obliga a
redeployar `cdr-sync-products`, cuyo espejo en el repo no coincide con producción. Sólo toca lo
que está vacío: **una categoría elegida a mano nunca se pisa**, y `origen = 'manual'` en el mapa
tampoco se pisa al volver a derivar.

### Resultado

- **92,4% del catálogo vivo clasificado** (1774 de 1920 que CDR sigue mandando).
- 602 productos del backlog clasificados de una.
- Quedan **15 rubros** (146 productos) que necesitan criterio humano.
- Los otros ~2098 sin categoría **no tienen `cdr_categoria` guardado y ninguno sigue vivo en el
  feed**: es catálogo muerto que CDR dejó de mandar. No se pueden clasificar ni hace falta.

### Mantenimiento

```sql
-- Volver a derivar (no pisa los mapeos manuales):
select * from public.cdr_derive_category_map(85);

-- Rubros que CDR manda y todavía no están mapeados:
select distinct p.cdr_categoria, count(*) from products p
 where p.source='cdr' and p.category_id is null and coalesce(p.cdr_categoria,'') <> ''
   and p.cdr_categoria not in (select cdr_categoria from cdr_category_map)
 group by 1 order by 2 desc;

-- Cargar una decisión del dueño (gana sobre lo deducido y no se pisa nunca):
insert into cdr_category_map (cdr_categoria, category_id, origen)
values ('Energía >> Pilas y Cargadores', '<uuid categoría>', 'manual')
on conflict (cdr_categoria) do update
  set category_id = excluded.category_id, origen = 'manual', updated_at = now();
```
