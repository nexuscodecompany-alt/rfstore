# Restaurar ML después de las vacaciones — lunes 21/09/2026

El 15/09/2026 se congeló toda la automatización de MercadoLibre porque el cliente se fue de
vacaciones, pausó sus publicaciones desde ML, y **nuestro sync se las volvió a activar** (47
publicaciones vivas, una de ellas se vendió: orden 346, FIL07).

## Qué se hizo el 15/09

1. `app_settings.ml_auto_reactivate_enabled` → **false** (antes: true).
2. Se encolaron 47 `pause` (`payload.source = 'vacaciones_freeze_2026_09'`) y se procesaron: las
   47 quedaron pausadas en ML. La operación `pause` además deja `auto_paused_stock = false`, así
   que ninguna se puede auto-reactivar.
3. **TODOS los crons que tocan ML apagados** (`cron.alter_job(<id>, active := false)`):
   - 13 `ml-process-sync-queue-tick` — el único que escribía en ML (stock, precio, pausar, activar)
   - 15 `ml-webhook-reprocess` — reprocesa notificaciones (sólo lee de ML)
   - 17 `ml-backfill-fees` — completa comisiones (sólo lee de ML)
   - 23 `ml-backfill-catalog-ids` — backfill de ids de catálogo (sólo lee de ML)
   - 19 `cdr-daily-digest-6am-uy` — digest diario de productos nuevos de CDR, va al CLIENTE
   (22 `health-alerts-hourly` quedó **PRENDIDO**: ese reporte es del desarrollador, no del cliente.)
   (12 `ml-process-publish-queue-tick` ya estaba apagado desde la suspensión de ML.)
4. La lista de las 47 quedó guardada en `app_settings.ml_vacation_freeze`.
5. Verificado contra la API de ML: **0 publicaciones activas** (1078 pausadas).

6. **Candado extra — el productor automático de trabajo hacia ML:**
   `alter table public.variants disable trigger variants_stock_to_ml;`
   Es el único trigger que encola cambios para ML (stock). Con él apagado la cola no vuelve a
   llenarse sola, ni aunque alguien invoque la función a mano. Además se purgó lo que había:
   `ml_sync_queue` pending/processing → `cancelled_vacaciones`.

7. **CANDADO DEFINITIVO — el token de ML está guardado y fuera de juego:**
   ```sql
   create schema if not exists ops;            -- esquema privado, NO expuesto por PostgREST
   create table ops.ml_credentials_freeze as select * from public.ml_credentials;
   delete from public.ml_credentials;
   ```
   Sin fila en `ml_credentials`, **todas** las funciones que hablan con ML cortan en su `getToken()`
   con `no_ml_credentials` / `no_creds` **antes de hacer una sola llamada de red**: verificado en
   `ml-process-sync-queue`, `ml-publish-item`, `ml-update-content`, `ml-item-activate`,
   `ml-catalog-sync`, `ml-webhook` y `health-alerts`. `ml-token-refresh` no encuentra filas que
   refrescar. Es decir: **cero contacto con ML, ni de lectura**, aunque alguien invoque una función
   a mano o apriete un botón del panel.

8. **Mails — quién recibe qué:**
   - `facundohernandez122@gmail.com` = **desarrollador**. Recibe el "Reporte de salud — RF Store"
     (`alerts_notify_email`, sin cambios) y el cron 22 quedó prendido para que siga llegando.
   - **Cliente (RF Store)** = env `ADMIN_EMAIL`, **sin tocar**: sigue recibiendo SÓLO las ventas
     (`mp-webhook`, `send-transfer-email`, `send-order-confirmation`). Si algo falla, no se entera.
   - `app_settings.admin_notify_email` (digest de negocio de CDR, iba al cliente): **la clave no
     existía**; se creó apuntando al desarrollador. **Al restaurar hay que BORRAR la fila.**

Lo que **siguió andando**: la tienda web entera, CDR (precio/stock en RF), el dólar, los mails de
venta (`mp-webhook`, `send-transfer-email`, `send-order-confirmation`) y los carritos abandonados
(esos van al cliente, no al dueño). El endpoint `ml-webhook` sigue publicado y si ML nos avisa algo
lo registra en `ml_webhook_events`, pero sin token no puede consultarle nada a ML: el evento queda
en cola y se reprocesa solo cuando se restauren las credenciales y el cron 15.

**Efecto lateral conocido:** `health-alerts` va a reportar `check_failed: mercadolibre`
(`no_ml_credentials`) en el reporte diario hasta que se restaure. Es esperado, no es una falla.

Crons ACTIVOS durante el freeze: 7 (vencer pendientes), 8 y 27 (CDR precio/stock), 20 (imágenes),
21 (carritos abandonados), 24/25/26 (mantenimiento).

## Pasos del 21/09

> El orden importa: **0 → 1 → 2 → 3 → 4**. Con el paso 3 hecho, todo vuelve a funcionar como antes.

### 0. Devolver las credenciales de ML
```sql
insert into public.ml_credentials select * from ops.ml_credentials_freeze;
```
El `access_token` dura 6 h, así que seguro esté vencido: la primera función que corra lo renueva
sola con el `refresh_token`. Después de verificar que ML responde:
`drop table ops.ml_credentials_freeze; drop schema ops;`

### 1. Volver a prender el trigger de stock
```sql
alter table public.variants enable trigger variants_stock_to_ml;
```
La cola quedó vacía a propósito, así que no hay nada viejo que descartar.

### 2. Reactivar las 47 publicaciones que el freeze pausó
```sql
insert into public.ml_sync_queue (operation, product_id, variant_id, ml_item_id, payload, status, scheduled_for)
select 'reactivate', m.product_id, m.variant_id, m.ml_item_id,
       jsonb_build_object('source','vacaciones_restore_2026_09'), 'pending', now()
from public.ml_item_mapping m
where m.ml_item_id in (
  select x->>'ml_item_id'
    from public.app_settings, lateral jsonb_array_elements(value->'items') x
   where key = 'ml_vacation_freeze'
);
```
> OJO: `reactivate` sólo corre si `ml_auto_reactivate_enabled = true`, así que hay que hacer el
> paso 3 ANTES o al mismo tiempo. Si el cliente prefiere despausar todo el resto también (las
> ~1031 que pausó él), eso lo hace él desde ML con la acción masiva.

### 3. Volver a prender todo
```sql
update public.app_settings set value = 'true'::jsonb, updated_at = now()
 where key = 'ml_auto_reactivate_enabled';
select cron.alter_job(13, active := true);  -- ml-process-sync-queue-tick
select cron.alter_job(15, active := true);  -- ml-webhook-reprocess
select cron.alter_job(19, active := true);  -- cdr-daily-digest-6am-uy
select cron.alter_job(17, active := true);  -- ml-backfill-fees
select cron.alter_job(22, active := true);  -- health-alerts-hourly
select cron.alter_job(23, active := true);  -- ml-backfill-catalog-ids

-- mails de vuelta al dueño
update public.app_settings set value = '"facundohernandez122@gmail.com"'::jsonb, updated_at = now()
 where key = 'alerts_notify_email';
delete from public.app_settings where key = 'admin_notify_email';  -- no existía antes del freeze

delete from public.app_settings where key = 'ml_vacation_freeze';
```

### 4. Resync completo (ML tiene datos de hace una semana)
Durante el freeze el trigger estuvo apagado, así que ML no se enteró de ningún cambio de stock.
Hay que empujarle el estado actual de todo lo que quedó vivo:
```sql
insert into public.ml_sync_queue (operation, product_id, variant_id, ml_item_id, payload, status, scheduled_for)
select 'update_stock', m.product_id, m.variant_id, m.ml_item_id,
       jsonb_build_object('source','vacaciones_resync'), 'pending', now()
from public.ml_item_mapping m
where m.status = 'active' and m.variant_id is not null;
```
Para los precios, el botón **"Repreciar activas"** del panel (`ml-reprice-active`) hace lo mismo
con la tabla de márgenes vigente. Se drena a 20 por minuto: ~35 min cada 700 publicaciones.

### 5. Verificar (a los ~5 min)
```sql
select status, count(*) from public.ml_sync_queue
 where payload->>'source' = 'vacaciones_restore_2026_09' group by 1;   -- todas en 'done'
select jobid, jobname, active from cron.job where jobid in (13,15,17,19,22,23);  -- todas true
select tgenabled from pg_trigger t join pg_class c on c.oid=t.tgrelid
 where c.relname='variants' and t.tgname='variants_stock_to_ml';  -- debe dar 'O'
select count(*) from public.ml_credentials;  -- debe dar 1
select key, value from public.app_settings where key in ('alerts_notify_email','admin_notify_email');
-- alerts_notify_email = facundohernandez122@gmail.com, admin_notify_email NO debe existir
```

## Pendiente de fondo (el bug que causó todo esto)

`ml-process-sync-queue` no distingue una pausa NUESTRA por stock 0 de una pausa MANUAL del
vendedor: ML reporta las dos como `paused_by_seller`, y la única señal que miramos es nuestro
flag `ml_item_mapping.auto_paused_stock`, que queda prendido de la pausa automática anterior.
Si el vendedor pausa a mano algo que nosotros ya habíamos auto-pausado, al volver el stock se
lo reactivamos por arriba.

Arreglo propuesto: registrar en el mapping el momento de la última pausa NUESTRA
(`auto_paused_at`) y, antes de reactivar, comparar contra `last_updated` del ítem en ML: si ML
fue tocado DESPUÉS de nuestra pausa, la última palabra es del vendedor → no reactivar.
Alternativa más simple: un switch global de "modo vacaciones" en el panel que apague la
reactivación con un click, sin depender de que alguien se acuerde de tocar la base.
