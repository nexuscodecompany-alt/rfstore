-- 20/11/2026: sacar un candado de CDR no traia el stock/precio de vuelta.
--
-- El sync de CDR es incremental (solo trae lo que CDR modifico desde el cursor) y
-- el WS no tiene consulta por codigo. Si CDR mandaba un producto mientras tenia
-- stock_locked/price_locked, el dato se descartaba y, al sacar el candado, CDR no
-- lo volvia a mandar hasta el proximo cambio (caso FIL114, PLA Lite marron).
--
-- Fix: guardamos SIEMPRE lo ultimo que mando CDR (cdr_feed_stock / cdr_feed_price),
-- con o sin candado, y al apagar el candado se aplica eso. Sin llamadas extra a CDR.

alter table public.variants
  add column if not exists cdr_feed_stock int,
  add column if not exists cdr_feed_price numeric,
  add column if not exists cdr_feed_at timestamptz;

comment on column public.variants.cdr_feed_stock is
  'Ultimo stock efectivo que mando CDR (menos reservas), guardado AUNQUE el producto tenga stock_locked. Se aplica al sacar el candado.';
comment on column public.variants.cdr_feed_price is
  'Ultimo costo USD que mando CDR, guardado AUNQUE el producto tenga price_locked. Se aplica al sacar el candado.';

-- Backfill: lo de los productos sin candado ya es lo ultimo que mando CDR.
update public.variants v
   set cdr_feed_stock = v.cdr_stock, cdr_feed_price = v.price
  from public.products p
 where p.id = v.product_id and p.source = 'cdr'
   and not p.stock_locked and not p.price_locked
   and v.cdr_feed_stock is null;

CREATE OR REPLACE FUNCTION public.cdr_bulk_update_stock_price(p_rows jsonb, p_reconcile boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_prod int;
  v_var int;
  v_zeroed int := 0;
  v_incoming int;
  v_locked int;
  v_seen int := 0;
begin
  with incoming as (
    select x->>'code' as code, (x->>'precio')::numeric as precio
    from jsonb_array_elements(p_rows) x
    where coalesce(x->>'code','') <> ''
  ),
  upd as (
    update products p set price_usd = i.precio, last_synced_at = now()
    from incoming i
    where p.external_code = i.code and p.source = 'cdr' and not p.price_locked
      and p.price_usd is distinct from i.precio
    returning 1
  )
  select count(*) into v_prod from upd;

  with reserved as materialized (
    select p.external_code as code,
           sum(greatest(oi.quantity - coalesce(oi.owned_taken, 0), 0))::int as qty
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
                   else i.eff + greatest(coalesce(v.owned_stock, 0), 0) end,
      -- 20/11: foto de lo que mando CDR, con o sin candado.
      cdr_feed_stock = i.eff,
      cdr_feed_price = i.precio,
      cdr_feed_at = now()
    from incoming i
    join products p on p.external_code = i.code and p.source = 'cdr'
    where v.product_id = p.id
      and ((not p.price_locked and v.price is distinct from i.precio)
           or (not p.stock_locked and (v.cdr_stock is distinct from i.eff
                or v.stock is distinct from i.eff + greatest(coalesce(v.owned_stock, 0), 0)))
           or v.cdr_feed_stock is distinct from i.eff
           or v.cdr_feed_price is distinct from i.precio)
    returning 1
  )
  select count(*) into v_var from uv;

  select count(*) into v_incoming
  from jsonb_array_elements(p_rows) x where coalesce(x->>'code','') <> '';

  if p_reconcile and v_incoming >= 1500 then
    with feed as (
      select x->>'code' as code from jsonb_array_elements(p_rows) x
      where coalesce(x->>'code','') <> ''
    ),
    s as (
      update products p set last_synced_at = now()
      from feed f
      where p.external_code = f.code and p.source = 'cdr'
        and (p.last_synced_at is null or p.last_synced_at < now() - interval '6 hours')
      returning 1
    )
    select count(*) into v_seen from s;

    with feed as (
      select x->>'code' as code from jsonb_array_elements(p_rows) x
      where coalesce(x->>'code','') <> ''
    ),
    z as (
      update variants v set cdr_stock = 0, stock = greatest(coalesce(v.owned_stock, 0), 0),
                            cdr_feed_stock = 0, cdr_feed_at = now()
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

    -- Con candado: no se toca el stock, pero la foto refleja que salio del feed.
    with feed as (
      select x->>'code' as code from jsonb_array_elements(p_rows) x
      where coalesce(x->>'code','') <> ''
    )
    update variants v set cdr_feed_stock = 0, cdr_feed_at = now()
      from products p
     where v.product_id = p.id and p.source = 'cdr' and p.stock_locked
       and coalesce(v.cdr_feed_stock, 0) <> 0
       and not exists (select 1 from feed f where f.code = p.external_code);
  end if;

  select count(*) into v_locked from products
   where source = 'cdr' and (stock_locked or price_locked);

  return jsonb_build_object('products', v_prod, 'variants', v_var,
                            'orphans_zeroed', v_zeroed, 'locked', v_locked,
                            'reconciled', (p_reconcile and v_incoming >= 1500),
                            'seen_refreshed', v_seen, 'incoming', v_incoming);
end
$function$;

-- Al sacar el candado de PRECIO: el costo del producto toma lo ultimo de CDR.
create or replace function public.trg_products_cdr_unlock_price()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_price numeric;
begin
  select v.cdr_feed_price into v_price
    from variants v
   where v.product_id = new.id and v.cdr_feed_price is not null
   order by v.cdr_feed_at desc nulls last
   limit 1;
  if v_price is not null and new.price_usd is distinct from v_price then
    new.price_usd := v_price;
    new.last_synced_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists products_cdr_unlock_price on public.products;
create trigger products_cdr_unlock_price
  before update of price_locked on public.products
  for each row
  when (old.price_locked and not new.price_locked and new.source = 'cdr')
  execute function public.trg_products_cdr_unlock_price();

-- Al sacar cualquier candado: las variantes toman lo ultimo de CDR. AFTER porque
-- los triggers de variants (total_stock, cola de ML) vuelven a tocar products.
create or replace function public.trg_products_cdr_unlock_apply()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_stock_unlocked boolean := old.stock_locked and not new.stock_locked;
  v_price_unlocked boolean := old.price_locked and not new.price_locked;
begin
  update variants v set
    cdr_stock = case when v_stock_unlocked and v.cdr_feed_stock is not null
                     then v.cdr_feed_stock else v.cdr_stock end,
    stock = case when v_stock_unlocked and v.cdr_feed_stock is not null
                 then v.cdr_feed_stock + greatest(coalesce(v.owned_stock, 0), 0) else v.stock end,
    price = case when v_price_unlocked and v.cdr_feed_price is not null
                 then v.cdr_feed_price else v.price end
  where v.product_id = new.id
    and ((v_stock_unlocked and v.cdr_feed_stock is not null
          and (v.cdr_stock is distinct from v.cdr_feed_stock
               or v.stock is distinct from v.cdr_feed_stock + greatest(coalesce(v.owned_stock, 0), 0)))
      or (v_price_unlocked and v.cdr_feed_price is not null and v.price is distinct from v.cdr_feed_price));
  return null;
end;
$$;

drop trigger if exists products_cdr_unlock_apply on public.products;
create trigger products_cdr_unlock_apply
  after update on public.products
  for each row
  when (new.source = 'cdr' and ((old.stock_locked and not new.stock_locked)
                              or (old.price_locked and not new.price_locked)))
  execute function public.trg_products_cdr_unlock_apply();

-- Funciones de trigger: nadie las llama por RPC (ver rfstore-rpcs-expuestas-agujero).
revoke all on function public.trg_products_cdr_unlock_price() from public, anon, authenticated;
revoke all on function public.trg_products_cdr_unlock_apply() from public, anon, authenticated;
