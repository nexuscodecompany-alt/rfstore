-- CDR / doc v2.0 - Fase 2: la reconciliacion de stock pasa a ser EXPLICITA.
--
-- Contexto
-- --------
-- `cdr_bulk_update_stock_price` apaga el stock de todo producto CDR que no venga
-- en el feed (orphans_zeroed). Hasta hoy eso era correcto porque el sync pedia
-- SIEMPRE el catalogo completo (fecha hardcodeada 2015-01-01, 168 veces por dia).
--
-- La doc v2.0 de CDR prohibe eso: repetir el full sync tranca el usuario. Pasamos
-- a llamadas incrementales, y ahi la reconciliacion por ausencia deja de ser valida:
-- un incremental trae solo lo que cambio, asi que "no vino en el feed" ya NO
-- significa "CDR lo dio de baja".
--
-- Hoy lo unico que separa esos dos casos es la guarda `v_incoming >= 1500`, que es
-- un umbral adivinado. Es un BUG LATENTE: el dia que un incremental traiga 1500+
-- productos (una recategorizacion masiva, un cambio general de precios) la guarda
-- se cumple y se apaga el stock de TODO el catalogo.
--
-- Este cambio
-- -----------
-- 1. Nuevo parametro `p_reconcile`. La reconciliacion corre SOLO si quien llama
--    afirma explicitamente que el payload es el catalogo completo. Default false:
--    si alguien llama sin el parametro, NO apaga nada (falla del lado seguro).
-- 2. La guarda `>= 1500` se mantiene ADEMAS del flag, como segundo cinturon.
-- 3. En modo reconcile se refresca `last_synced_at` de todo lo que vino en el feed
--    (antes solo se tocaba al actualizar el precio, asi que los `price_locked`
--    quedaban con fecha vieja y parecian dados de baja).
--
-- Se hace DROP + CREATE en vez de CREATE OR REPLACE porque cambia la firma: si
-- quedaran las dos versiones, la llamada con un solo argumento seria ambigua.
-- La transaccion de la migracion lo hace atomico.

drop function if exists public.cdr_bulk_update_stock_price(jsonb);

create or replace function public.cdr_bulk_update_stock_price(
  p_rows      jsonb,
  p_reconcile boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_prod int;
  v_var int;
  v_zeroed int := 0;
  v_incoming int;
  v_locked int;
  v_seen int := 0;
begin
  -- Costo del producto: no se toca si tiene candado de precio (price_locked).
  with incoming as (
    select x->>'code' as code, (x->>'precio')::numeric as precio
    from jsonb_array_elements(p_rows) x
    where coalesce(x->>'code','') <> ''
  ),
  upd as (
    update products p set price_usd = i.precio, last_synced_at = now()
    from incoming i
    where p.external_code = i.code and p.source = 'cdr' and not p.price_locked
    returning 1
  )
  select count(*) into v_prod from upd;

  -- Variantes: precio sólo si NO hay candado de precio; stock de CDR sólo si NO
  -- hay candado de stock. El stock vendible = CDR (menos reservado) + propio.
  with reserved as materialized (
    -- Mismo criterio que reserved_quantity_for_product(), pero agregado de una
    -- sola pasada para TODOS los códigos en vez de una llamada por fila.
    select p.external_code as code, sum(oi.quantity)::int as qty
    from order_items oi
    join variants vr on vr.id = oi.variant_id
    join products p  on p.id  = vr.product_id
    join orders   o  on o.id  = oi.order_id
    where o.status in ('pago_pendiente', 'Pendiente', 'Cotización')
      and coalesce(o.stock_taken, false)
      and (coalesce(o.paid_mp_usd,0) + coalesce(o.paid_transfer_usd,0)) > 0
    group by p.external_code
  ),
  incoming as (
    select x->>'code' as code,
           (x->>'precio')::numeric as precio,
           greatest(0, (x->>'stock')::int - coalesce(r.qty, 0)) as eff
    from jsonb_array_elements(p_rows) x
    left join reserved r on r.code = x->>'code'
    where coalesce(x->>'code','') <> ''
  ),
  uv as (
    update variants v set
      price = case when p.price_locked then v.price else i.precio end,
      cdr_stock = case when p.stock_locked then v.cdr_stock else i.eff end,
      stock = case when p.stock_locked then v.stock
                   else i.eff + greatest(coalesce(v.owned_stock, 0), 0) end
    from incoming i
    join products p on p.external_code = i.code and p.source = 'cdr'
    where v.product_id = p.id
      and ((not p.price_locked and v.price is distinct from i.precio)
           or (not p.stock_locked and (v.cdr_stock is distinct from i.eff
                or v.stock is distinct from i.eff + greatest(coalesce(v.owned_stock, 0), 0))))
    returning 1
  )
  select count(*) into v_var from uv;

  select count(*) into v_incoming
  from jsonb_array_elements(p_rows) x where coalesce(x->>'code','') <> '';

  -- ------------------------------------------------------------------
  -- Reconciliación: SOLO cuando el que llama afirma que esto es el feed
  -- COMPLETO (p_reconcile). En un sync incremental "no vino" significa
  -- "no cambió", no "lo dieron de baja": apagar ahí seria un desastre.
  -- La guarda de 1500 queda como segundo cinturón por si el full sync
  -- devuelve una respuesta parcial (CDR devuelve conteos inconsistentes).
  -- ------------------------------------------------------------------
  if p_reconcile and v_incoming >= 1500 then
    -- Marca de "CDR me lo mandó en esta pasada completa". Antes last_synced_at
    -- sólo se tocaba al actualizar el precio, así que los price_locked quedaban
    -- con fecha vieja y parecían dados de baja sin estarlo.
    with feed as (
      select x->>'code' as code from jsonb_array_elements(p_rows) x
      where coalesce(x->>'code','') <> ''
    ),
    s as (
      update products p set last_synced_at = now()
      from feed f
      where p.external_code = f.code and p.source = 'cdr'
        and (p.last_synced_at is null or p.last_synced_at < now() - interval '1 minute')
      returning 1
    )
    select count(*) into v_seen from s;

    -- Los productos CDR que YA NO vienen en el feed quedan con cdr_stock 0. Si
    -- tenemos unidades propias, el vendible NO baja a cero: queda el stock del
    -- depósito, que es justamente la gracia de tener stock propio.
    with feed as (
      select x->>'code' as code from jsonb_array_elements(p_rows) x
      where coalesce(x->>'code','') <> ''
    ),
    z as (
      update variants v set cdr_stock = 0, stock = greatest(coalesce(v.owned_stock, 0), 0)
      from products p
      where v.product_id = p.id
        and p.source = 'cdr'
        and not p.stock_locked
        and (v.stock > 0 or coalesce(v.cdr_stock, 0) > 0)
        and v.stock is distinct from greatest(coalesce(v.owned_stock, 0), 0)
        and not exists (select 1 from feed f where f.code = p.external_code)
      returning 1
    )
    select count(*) into v_zeroed from z;
  end if;

  select count(*) into v_locked from products
   where source = 'cdr' and (stock_locked or price_locked);

  return jsonb_build_object('products', v_prod, 'variants', v_var,
                            'orphans_zeroed', v_zeroed, 'locked', v_locked,
                            'reconciled', (p_reconcile and v_incoming >= 1500),
                            'seen_refreshed', v_seen, 'incoming', v_incoming);
end
$function$;

-- Quién puede llamarla: SOLO el service_role (las edge functions). Cambiar la
-- firma crea una función nueva, así que los grants de la anterior NO se heredan
-- y hay que volver a declararlos explícitamente.
revoke all on function public.cdr_bulk_update_stock_price(jsonb, boolean) from public;
revoke all on function public.cdr_bulk_update_stock_price(jsonb, boolean) from anon;
revoke all on function public.cdr_bulk_update_stock_price(jsonb, boolean) from authenticated;
grant execute on function public.cdr_bulk_update_stock_price(jsonb, boolean) to service_role;

comment on function public.cdr_bulk_update_stock_price(jsonb, boolean) is
  'Update en lote de precio/stock de productos CDR. p_reconcile=true SOLO cuando p_rows es el catalogo COMPLETO (full sync): apaga el stock de lo que ya no viene. En sync incremental debe ir en false. Ver docs/cdr/README.md.';
