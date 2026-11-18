-- 18/11/2026 — El stock propio (owned_stock) sigue al stock TOMADO de verdad.
--
-- Bug encontrado en testing (con rollback, sin datos reales afectados: 0 items con owned_taken>0):
-- trg_order_items_fill_cost repartía propio/CDR al INSERTAR el item, o sea en el checkout,
-- ANTES de cobrar; pero el stock vendible recién baja al cobrar (take_order_stock, modelo
-- 20/08). Y ningún camino de cancelación devolvía owned_taken. Resultado: un pedido web sin
-- pagar se comía las unidades del depósito y, al cancelarse, desaparecían para siempre (el
-- sync recalcula stock = CDR + propio con el propio ya en 0).
--
-- Regla nueva: owned_taken acompaña a order_items.stock_taken_qty (la cantidad que de verdad
-- salió del stock), en todos los canales:
--   - INSERT: se toma lo que ya viene tomado (manual editada) y en ML todo (ML vende cobrado).
--   - UPDATE de stock_taken_qty: sube -> se toma primero del depósito; baja -> vuelve primero
--     al depósito. Lo usan take_order_stock (cobro web), create_manual_sale, release_order_stock,
--     reject_manual_payment y change_order_status.
--   - DELETE (update/delete_manual_sale borran los items después de devolver el stock): vuelve
--     lo que seguía tomado.
-- La parte de CDR (cdr_stock) se mueve igual para mantener stock = cdr_stock + owned_stock;
-- de todos modos el sync de CDR la vuelve a fijar con lo que informa CDR.

create or replace function public.order_item_take_owned(p_variant uuid, p_delta int)
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
-- p_delta > 0: se tomaron p_delta unidades; devuelve cuántas salieron del depósito.
-- p_delta < 0: NO se usa (las devoluciones las hace order_item_return_owned).
declare
  v_owned int;
  v_own int;
begin
  if p_variant is null or coalesce(p_delta, 0) <= 0 then return 0; end if;
  select greatest(coalesce(owned_stock, 0), 0) into v_owned from variants where id = p_variant for update;
  v_own := least(p_delta, coalesce(v_owned, 0));
  update variants
     set owned_stock = greatest(coalesce(owned_stock, 0) - v_own, 0),
         cdr_stock = case when cdr_stock is null then null
                          else greatest(cdr_stock - (p_delta - v_own), 0) end
   where id = p_variant;
  return v_own;
end
$function$;

create or replace function public.order_item_return_owned(p_variant uuid, p_back int, p_owned_back int)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
-- Vuelven p_back unidades al stock: p_owned_back al depósito y el resto a la parte de CDR.
begin
  if p_variant is null or coalesce(p_back, 0) <= 0 then return; end if;
  update variants
     set owned_stock = greatest(coalesce(owned_stock, 0), 0) + greatest(coalesce(p_owned_back, 0), 0),
         cdr_stock = case when cdr_stock is null then null
                          else cdr_stock + greatest(p_back - greatest(coalesce(p_owned_back, 0), 0), 0) end
   where id = p_variant;
end
$function$;

revoke all on function public.order_item_take_owned(uuid, int) from public, anon, authenticated;
revoke all on function public.order_item_return_owned(uuid, int, int) from public, anon, authenticated;
grant execute on function public.order_item_take_owned(uuid, int) to service_role;
grant execute on function public.order_item_return_owned(uuid, int, int) to service_role;

-- INSERT: costo como siempre; el reparto SOLO por lo que ya sale tomado.
create or replace function public.trg_order_items_fill_cost()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_channel text;
begin
  if new.cost_usd is null then
    select case
             when v.avg_cost_usd is not null and v.avg_cost_usd > 0 then v.avg_cost_usd
             when p.source = 'cdr' then nullif(p.price_usd, 0)
             else nullif(v.price, 0)
           end
      into new.cost_usd
      from variants v join products p on p.id = v.product_id
     where v.id = new.variant_id;
  end if;

  -- ML vende cobrado y el webhook descuenta el stock en el acto: queda tomado desde ya.
  select coalesce(channel, 'web') into v_channel from orders where id = new.order_id;
  if v_channel = 'ml' and new.stock_taken_qty is null then
    new.stock_taken_qty := new.quantity;
  end if;

  new.owned_taken := public.order_item_take_owned(new.variant_id, coalesce(new.stock_taken_qty, 0));
  return new;
end;
$function$;

-- UPDATE de stock_taken_qty: el depósito acompaña.
create or replace function public.trg_order_items_owned_follow()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_t0 int := greatest(coalesce(old.stock_taken_qty, 0), 0);
  v_t  int := greatest(coalesce(new.stock_taken_qty, 0), 0);
  v_back_own int;
begin
  if v_t > v_t0 then
    new.owned_taken := coalesce(old.owned_taken, 0)
                       + public.order_item_take_owned(new.variant_id, v_t - v_t0);
  elsif v_t < v_t0 then
    v_back_own := least(coalesce(old.owned_taken, 0), v_t0 - v_t);
    perform public.order_item_return_owned(new.variant_id, v_t0 - v_t, v_back_own);
    new.owned_taken := coalesce(old.owned_taken, 0) - v_back_own;
  end if;
  return new;
end;
$function$;

drop trigger if exists order_items_owned_follow on public.order_items;
create trigger order_items_owned_follow
  before update of stock_taken_qty on public.order_items
  for each row
  when (old.stock_taken_qty is distinct from new.stock_taken_qty)
  execute function public.trg_order_items_owned_follow();

-- DELETE: lo que seguía tomado vuelve (los que borran ya devolvieron el stock vendible).
create or replace function public.trg_order_items_owned_on_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if coalesce(old.stock_taken_qty, 0) > 0 then
    perform public.order_item_return_owned(old.variant_id, old.stock_taken_qty, coalesce(old.owned_taken, 0));
  end if;
  return old;
end;
$function$;

drop trigger if exists order_items_owned_on_delete on public.order_items;
create trigger order_items_owned_on_delete
  after delete on public.order_items
  for each row execute function public.trg_order_items_owned_on_delete();

-- change_order_status, rama ML / manuales / web viejos: devolvía y retomaba stock por
-- `quantity` sin tocar stock_taken_qty -> el depósito no se enteraba. Ahora se marca.
create or replace function public.change_order_status(p_order_id bigint, p_status text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_old text;
  v_returned boolean;
  v_old_cancel boolean;
  v_new_cancel boolean;
  v_channel text;
  v_taken boolean;
  v_pstatus text;
  v_created timestamptz;
begin
  if not is_admin() then raise exception 'not_authorized'; end if;
  select status, coalesce(stock_returned,false), coalesce(channel,'web'), coalesce(stock_taken,false), payment_status, created_at
    into v_old, v_returned, v_channel, v_taken, v_pstatus, v_created
    from orders where id = p_order_id for update;
  if v_old is null then raise exception 'order_not_found'; end if;

  v_old_cancel := lower(coalesce(v_old,'')) in ('cancelado','rechazado','expirado','cancelled');
  v_new_cancel := lower(coalesce(p_status,'')) in ('cancelado','rechazado','expirado','cancelled');

  if v_channel = 'web' and (v_taken or v_created >= '2026-08-21') then
    if v_new_cancel and not v_old_cancel then
      if v_taken then
        update variants v set stock = v.stock + coalesce(oi.stock_taken_qty, oi.quantity)
          from order_items oi where oi.order_id = p_order_id and oi.variant_id = v.id;
        update order_items set stock_taken_qty = 0 where order_id = p_order_id;
      end if;
      perform public.release_order_coupon(p_order_id);
      update orders set status = p_status, stock_returned = true, stock_taken = false where id = p_order_id;
    elsif (not v_new_cancel) and v_old_cancel then
      update orders
         set status = p_status,
             stock_returned = false,
             stock_taken = case when v_returned then false else stock_taken end
       where id = p_order_id;
      if v_pstatus = 'paid' then
        perform public.take_order_stock(p_order_id);
      end if;
    else
      update orders set status = p_status where id = p_order_id;
    end if;
  else
    if v_new_cancel and not v_old_cancel and not v_returned then
      update variants v set stock = v.stock + oi.quantity
        from order_items oi where oi.order_id = p_order_id and oi.variant_id = v.id;
      -- 18/11: el depósito recupera lo suyo (trigger order_items_owned_follow).
      update order_items set stock_taken_qty = 0 where order_id = p_order_id;
      perform public.release_order_coupon(p_order_id);
      update orders set status = p_status, stock_returned = true where id = p_order_id;
    elsif (not v_new_cancel) and v_old_cancel and v_returned then
      update variants v set stock = greatest(0, v.stock - oi.quantity)
        from order_items oi where oi.order_id = p_order_id and oi.variant_id = v.id;
      -- 18/11: se vuelve a tomar, primero del depósito.
      update order_items set stock_taken_qty = quantity where order_id = p_order_id;
      update orders set status = p_status, stock_returned = false where id = p_order_id;
    else
      update orders set status = p_status where id = p_order_id;
    end if;
  end if;

  if v_new_cancel then
    update orders set payment_status = 'rejected'
      where id = p_order_id and coalesce(payment_status,'') = 'pending';
  end if;
end;
$function$;

-- Sync de CDR: la reserva de un pedido pagado y no entregado es SOLO la parte de CDR.
-- Las unidades que salieron del depósito no son de CDR (antes se restaban de más).
create or replace function public.cdr_bulk_update_stock_price(p_rows jsonb, p_reconcile boolean default false)
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
