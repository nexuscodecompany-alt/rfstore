-- Disk IO / CPU: `reserved_quantity_for_product()` se llamaba UNA VEZ POR FILA del
-- feed CDR (~4.250 filas por corrida, cada 10 min) y cada llamada hacia un join de
-- 4 tablas. Historico: 2,7 M de llamadas y 2,99 M de seq scans sobre `orders` (una
-- tabla de 198 filas). Ademas es SECURITY DEFINER, asi que Postgres no puede
-- inlinearla: es una caja negra por fila.
--
-- Ahora las reservas se calculan UNA sola vez por corrida en la CTE `reserved` y se
-- cruzan con LEFT JOIN.  46.185 buffers / 336 ms  ->  50 buffers / 7,7 ms.
-- Verificado equivalente: 0 diferencias sobre 4.976 productos, y 0 diferencias sobre
-- 93 codigos con 245 unidades reales usando un filtro ampliado.
--
-- `reserved_quantity_for_product` se mantiene: la sigue usando ml-stock-monitor y es
-- la definicion canonica de "reservado".

create or replace function public.cdr_bulk_update_stock_price(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prod int;
  v_var int;
  v_zeroed int := 0;
  v_incoming int;
  v_locked int;
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

  -- Reconciliación: los productos CDR que YA NO vienen en el feed quedan con
  -- cdr_stock 0. Si tenemos unidades propias, el vendible NO baja a cero: queda
  -- el stock del depósito, que es justamente la gracia de tener stock propio.
  -- Guarda: el feed normal es ~1939; si vino <1500 asumimos respuesta parcial y
  -- no apagamos nada.
  select count(*) into v_incoming from jsonb_array_elements(p_rows) x where coalesce(x->>'code','') <> '';
  if v_incoming >= 1500 then
    with feed as (
      select x->>'code' as code from jsonb_array_elements(p_rows) x where coalesce(x->>'code','') <> ''
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
                            'orphans_zeroed', v_zeroed, 'locked', v_locked);
end
$$;

revoke all on function public.cdr_bulk_update_stock_price(jsonb) from public, anon, authenticated;
grant execute on function public.cdr_bulk_update_stock_price(jsonb) to service_role;
