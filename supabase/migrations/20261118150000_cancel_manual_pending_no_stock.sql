-- 18/11/2026 — change_order_status, rama ML/manual: cancelar una venta MANUAL pendiente de
-- cobro devolvía `quantity` de stock que nunca se había descontado (stock inflado; en productos
-- con candado o locales quedaba así para siempre). Encontrado en testing con rollback.
-- Ahora devuelve stock_taken_qty, y reactivar una manual sin cobrar no toma stock.

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
      -- Se devuelve sólo lo que de verdad se descontó. Una venta MANUAL pendiente de cobro
      -- nunca tomó stock (stock_taken_qty null): devolverle `quantity` inflaba el catálogo.
      -- ML y web viejos no tienen stock_taken_qty en sus pedidos antiguos y sí lo descontaron;
      -- 5 manuales cobradas viejas tampoco lo tienen, pero su orden tiene stock_taken = true.
      update variants v set stock = v.stock + coalesce(oi.stock_taken_qty,
               case when v_channel = 'manual' and not v_taken then 0 else oi.quantity end)
        from order_items oi where oi.order_id = p_order_id and oi.variant_id = v.id;
      -- 18/11: el depósito recupera lo suyo (trigger order_items_owned_follow).
      update order_items set stock_taken_qty = 0 where order_id = p_order_id;
      perform public.release_order_coupon(p_order_id);
      update orders set status = p_status, stock_returned = true where id = p_order_id;
    elsif (not v_new_cancel) and v_old_cancel and v_returned and v_channel = 'manual' and coalesce(v_pstatus,'') <> 'paid' then
      -- Venta manual sin cobrar: reactivarla no toma stock (se toma al cobrarla).
      update orders set status = p_status, stock_returned = false where id = p_order_id;
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
