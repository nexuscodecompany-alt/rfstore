-- Cancelar una venta devuelve el stock (RF + ML) y la saca del dashboard.
-- Flag idempotente para no devolver dos veces.
alter table public.orders add column if not exists stock_returned boolean not null default false;

-- Cambio de estado por el admin (selector de la lista/detalle). Si pasa a un estado
-- de cancelación y el stock no fue devuelto, lo repone (dispara variants_stock_to_ml
-- → sync a ML). Si reactiva una orden cancelada, lo vuelve a descontar. Idempotente.
create or replace function public.change_order_status(p_order_id bigint, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_old text;
  v_returned boolean;
  v_old_cancel boolean;
  v_new_cancel boolean;
begin
  if not is_admin() then raise exception 'not_authorized'; end if;
  select status, coalesce(stock_returned,false) into v_old, v_returned
    from orders where id = p_order_id for update;
  if v_old is null then raise exception 'order_not_found'; end if;

  v_old_cancel := lower(coalesce(v_old,'')) in ('cancelado','rechazado','expirado','cancelled');
  v_new_cancel := lower(coalesce(p_status,'')) in ('cancelado','rechazado','expirado','cancelled');

  if v_new_cancel and not v_old_cancel and not v_returned then
    update variants v set stock = v.stock + oi.quantity
      from order_items oi where oi.order_id = p_order_id and oi.variant_id = v.id;
    update orders set status = p_status, stock_returned = true where id = p_order_id;
  elsif (not v_new_cancel) and v_old_cancel and v_returned then
    update variants v set stock = greatest(0, v.stock - oi.quantity)
      from order_items oi where oi.order_id = p_order_id and oi.variant_id = v.id;
    update orders set status = p_status, stock_returned = false where id = p_order_id;
  else
    update orders set status = p_status where id = p_order_id;
  end if;
end;
$$;

grant execute on function public.change_order_status(bigint, text) to authenticated;

-- release_order_stock (ciclo web pago_pendiente) marca el flag al liberar.
create or replace function public.release_order_stock(p_order_id bigint, p_new_status text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_current_status text; it record;
BEGIN
  IF p_new_status NOT IN ('rechazado', 'expirado', 'cancelado') THEN
    RAISE EXCEPTION 'Nuevo estado inválido: %', p_new_status;
  END IF;
  SELECT status INTO v_current_status FROM orders WHERE id = p_order_id FOR UPDATE;
  IF v_current_status IS NULL THEN RAISE EXCEPTION 'Orden no encontrada'; END IF;
  IF v_current_status <> 'pago_pendiente' THEN RETURN false; END IF;
  FOR it IN SELECT variant_id, quantity FROM order_items WHERE order_id = p_order_id LOOP
    UPDATE variants SET stock = stock + it.quantity WHERE id = it.variant_id;
  END LOOP;
  UPDATE orders SET status = p_new_status, stock_returned = true,
        payment_status = CASE WHEN p_new_status = 'rechazado' THEN 'rejected' ELSE payment_status END
    WHERE id = p_order_id;
  RETURN true;
END;
$function$;

-- delete_manual_sale: solo devolver stock si no fue ya devuelto (evita doble).
create or replace function public.delete_manual_sale(p_order_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare r record; v_returned boolean;
begin
  if not is_admin() then raise exception 'not_authorized'; end if;
  select coalesce(stock_returned,false) into v_returned from orders
    where id = p_order_id and channel='manual';
  if v_returned is null then raise exception 'not_manual_order'; end if;
  if not v_returned then
    for r in select variant_id, quantity from order_items
             where order_id = p_order_id and variant_id is not null loop
      update variants set stock = stock + r.quantity where id = r.variant_id;
    end loop;
  end if;
  delete from orders where id = p_order_id;
end;
$$;
