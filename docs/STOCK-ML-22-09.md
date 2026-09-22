# Se vendió en ML algo que no había en stock — 22/09/2026

## Qué pasó

Se vendió un **Xiaomi Redmi Note 15 Pro 12GB 512GB negro (CEL2261)** por MercadoLibre.
RF Store tenía stock **0** desde el 02/09. ML lo seguía ofreciendo.

La venta entró por la **publicación de catálogo** `MLU1466713836` (la ficha
`/p/MLU72995972`), que cuelga de nuestra publicación `MLU1418183296`.

Al revisarlo no era un caso aislado: **32 publicaciones activas ofrecían 154 unidades que no
existían**, y 607 de 1576 inventarios tenían una cantidad distinta a la de RF.

## La causa (una sola, repetida en tres lugares)

Las tres defensas que existían decidían mirando **`ml_item_mapping.status`** — nuestra propia
anotación — en lugar del estado real de ML. Cuando esa anotación quedaba desactualizada, era a
la vez **la causa del problema y la razón por la que nadie lo veía**.

| Dónde | Qué hacía | Consecuencia |
|---|---|---|
| `ml-process-sync-queue` (stock 0) | `if (mapping.status === 'paused') return ok` sin consultar a ML | Si ML la tenía activa, nunca recibía el 0. Y el trigger sólo encola cuando el stock **cambia**, así que una vez en 0 no se reintentaba jamás |
| `ml-process-sync-queue` (moderadas) | v13 convirtió el fallo en `skipped_moderated` con `result='ok'` | Publicación con stock fantasma reportada como éxito. CEL2261 estuvo así desde el 12/08 |
| `health-alerts` | `ml_active_no_stock` exigía `m.status === 'active'` | Las 32 tenían el mapping en `paused` y ML las tenía activas → invisibles |

Lo más revelador es la asimetría del primer punto: el camino inverso (volvió el stock, mapping
en `paused`) **sí** le pregunta a ML desde la v11. Se desconfiaba del mapping donde no había
riesgo y se le creía justo donde equivocarse se paga con una venta que no se puede cumplir.

Y nada comparaba nunca contra ML: `last_known_stock` es lo que **empujamos**, no lo que ML
tiene. En CEL2261 decía `10` desde el 30/06 y nadie lo desmintió en tres meses.

## El modelo que hay que entender: `user_product_id`

En ML el stock **no vive en la publicación**, vive en el *producto de inventario*
(`user_product_id`). Varias publicaciones pueden compartirlo: típicamente la propia y la de
catálogo. **Un solo stock detrás de varias publicaciones.**

Verificado en vivo: `MLU1466144108` (bloqueada por ML) pasó de 10 a 9 al escribir 9 en
`MLU1488151706`, su hermana de catálogo.

Dos consecuencias:

1. Las publicaciones de catálogo (54, sin mapping propio en RF por diseño) quedan cubiertas
   solas: cuelgan del mismo inventario que su publicación padre.
2. Cuando ML **bloquea** una publicación (`under_review` + `forbidden`) no deja tocarle ni el
   stock ni el estado — se probaron todos los caminos de la API y todos fallan:

   | Intento | Resultado |
   |---|---|
   | `PUT /items/{id}` con `available_quantity` | 400 `field_not_updatable` |
   | `PUT /items/{id}` con `status: paused` | 400 `item.status.not_modifiable` |
   | `PUT /user-products/{upid}/stock` | 404 (la API de inventario es sólo lectura) |
   | `PUT /items/{id}/stock`, `/inventory`, variantes | 404 |

   Pero **sí se puede bajar por una publicación hermana** del mismo inventario. Ésa es la
   única vía, y es la que usa el reconciliador.

## Qué se cambió

### `ml-stock-reconcile` (nuevo) — la red de seguridad

Cada hora (cron `ml-stock-reconcile-hourly`, minuto 45) barre **todas** las publicaciones del
vendedor contra la API de ML, agrupa por `user_product_id` y corrige las cantidades.

- No depende del trigger, ni de la cola, ni de que el mapping esté al día.
- Prioriza lo que está **ofreciendo de más**; si la corrida no alcanza (tope 300 escrituras),
  lo que queda afuera es lo inofensivo y lo toma la corrida siguiente.
- Para bloqueadas: escribe por una hermana editable del mismo inventario.
- **Nunca reactiva ni despausa nada.** Bajar stock corta ventas; subir estado las crea, y eso
  es decisión del dueño (ver el freeze de vacaciones de 09/2026).
- Lo que no puede corregir queda en `ml_item_mapping.stock_out_of_sync` y dispara un mail
  **inmediato** (no espera al reporte de las 9).
- `?dry=1` muestra qué haría sin tocar nada.

### `ml-process-sync-queue` v14 — la fuente

- Con stock ≤ umbral, **el estado lo dicta ML**: siempre se lee antes de decidir.
- Para dejar de vender ahora escribe `available_quantity: 0` en vez de `status: paused`. ML
  pausa sola con `out_of_stock` (el sub_status que la reactivación sabe reconocer), es
  idempotente y **se propaga a la publicación de catálogo** — que antes quedaba afuera y es
  por donde se vendió el Redmi.
- Las bloqueadas ya no se reportan como `ok`: se marcan y el reconciliador las intenta por una
  hermana.

### `health-alerts` v7 — el vigilante

- `ml_active_no_stock` y `ml_qty_mismatch` ya no filtran por nuestro mapping: el estado lo
  dicta ML.
- Nuevo `ml_stock_out_of_sync`: lo que se intentó corregir y ML no dejó.
- Nuevo chequeo `stock_reconcile`: vigila que el reconciliador siga corriendo.

### Esquema

- `ml_item_mapping`: `ml_verified_qty` / `ml_verified_status` / `ml_verified_at` (lo que ML
  **realmente** reportó, separado de `last_known_stock`, que es lo que empujamos) y
  `stock_out_of_sync` / `out_of_sync_since` / `out_of_sync_reason`.
- `ml_stock_reconcile_runs`: historial de corridas.

### Un incidente evitado por poco

Desplegar `ml-process-sync-queue` por la API de Supabase lo dejó en `verify_jwt=true`, y el
cron 13 llamaba **sin** cabecera de autorización → 401. La cola de ML habría quedado muerta en
silencio. Se pasó al patrón del resto de los ticks: `ml_sync_queue_tick()`, que saca el token
del Vault. Ahora funciona con `verify_jwt` en true o en false, indistinto.

## Lo que queda abierto

1. **24 publicaciones bloqueadas por ML** (`under_review`/`forbidden`) sin hermana editable.
   No hay forma de corregirlas por API: hay que destrabarlas en ML o darlas de baja. El
   sistema avisa por mail mientras estén así.
2. **2 conflictos de mapeo**: productos duplicados en RF que comparten un inventario de ML —
   `MOU274`/`MOU274C` y `NOT3242`/`NOT3242W`. Cualquier cantidad que escribamos estaría mal
   para uno de los dos, así que el reconciliador los reporta y no los toca. Hay que unificar
   los productos en RF o desvincular las publicaciones.

## Cómo verificar que sigue sano

```sql
-- Última corrida del reconciliador (esperado: cada hora, sobreventa tendiendo a 0)
select created_at, mismatches, report->>'sobreventa' as sobreventa,
       fixed, unfixable, report->>'unidades_de_mas' as unidades
from ml_stock_reconcile_runs where not dry_run order by id desc limit 5;

-- Lo que ML no deja corregir
select ml_item_id, out_of_sync_since, out_of_sync_reason
from ml_item_mapping where stock_out_of_sync;
```
