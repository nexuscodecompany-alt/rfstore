-- change_order_status: en los pedidos WEB el stock se devuelve sólo si se había
-- descontado (29/10/2026).
--
-- Desde el 20/08/2026 un pedido web descuenta stock recién al cobrarse
-- (take_order_stock -> stock_taken / stock_taken_qty). Pero cancelar a mano
-- devolvía SIEMPRE la cantidad pedida: cancelar una transferencia que nunca se
-- pagó sumaba stock que nunca se había sacado (inflaba el catálogo).
--
-- Web: se devuelve exactamente lo descontado (stock_taken_qty) y sólo si
-- stock_taken; al reactivar, el stock se vuelve a tomar sólo si está pago.
-- Mercado Libre, ventas manuales y pedidos web ANTERIORES al cambio de modelo
-- (reservaban stock al crearse, sin stock_taken): SIN CAMBIOS, devuelven la
-- cantidad pedida como siempre.

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

  -- Modelo "stock al cobrar" (stock_taken): web desde el 21/08/2026, o cualquier
  -- pedido que ya tenga la marca.
  if v_channel = 'web' and (v_taken or v_created >= '2026-08-21') then
    -- ---- Pedidos web: el stock sigue a stock_taken ----
    if v_new_cancel and not v_old_cancel then
      if v_taken then
        update variants v set stock = v.stock + coalesce(oi.stock_taken_qty, oi.quantity)
          from order_items oi where oi.order_id = p_order_id and oi.variant_id = v.id;
        update order_items set stock_taken_qty = 0 where order_id = p_order_id;
      end if;
      perform public.release_order_coupon(p_order_id);
      update orders set status = p_status, stock_returned = true, stock_taken = false where id = p_order_id;
    elsif (not v_new_cancel) and v_old_cancel then
      -- Si el stock se había devuelto, ya no está tomado (los cancelados con la
      -- lógica vieja quedaron con stock_taken=true y stock_returned=true).
      update orders
         set status = p_status,
             stock_returned = false,
             stock_taken = case when v_returned then false else stock_taken end
       where id = p_order_id;
      -- Reactivar un pedido cobrado: el stock vuelve a salir del catálogo.
      if v_pstatus = 'paid' then
        perform public.take_order_stock(p_order_id);
      end if;
    else
      update orders set status = p_status where id = p_order_id;
    end if;
  else
    -- ---- Mercado Libre / manuales / web viejos: igual que siempre ----
    if v_new_cancel and not v_old_cancel and not v_returned then
      update variants v set stock = v.stock + oi.quantity
        from order_items oi where oi.order_id = p_order_id and oi.variant_id = v.id;
      perform public.release_order_coupon(p_order_id);
      update orders set status = p_status, stock_returned = true where id = p_order_id;
    elsif (not v_new_cancel) and v_old_cancel and v_returned then
      update variants v set stock = greatest(0, v.stock - oi.quantity)
        from order_items oi where oi.order_id = p_order_id and oi.variant_id = v.id;
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
