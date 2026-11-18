-- 18/11/2026 — Stock propio cargado a mano en productos "Ambos" (sin pasar por Compras).
--
-- Caso que lo disparó: CON202 (joystick GameSir). El dueño puso "Ambos" y escribió el stock
-- en el form del producto, pero ese campo es el TOTAL (variants.stock), no el stock propio.
-- El sync de CDR recalcula stock = cdr_stock + owned_stock cada 5 min y lo pisó: CDR 1 +
-- propio 0 = 1, cuando en el depósito había 1 más. owned_stock sólo entraba por receive_purchase.
--
-- set_owned_stock fija el stock propio, recalcula el total y deja el ajuste anotado en
-- stock_movements ('ajuste'). Compras sigue siendo la vía para registrar costo; esto es
-- para "tengo N en el depósito", sin cargar una compra.

create or replace function public.set_owned_stock(p_variant_id uuid, p_qty int, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_prev int;
  v_cdr int;
  v_locked boolean;
  v_product uuid;
  v_fulfillment text;
  v_delta int;
  v_stock int;
begin
  if not public.is_admin() then
    raise exception 'solo admin';
  end if;
  if p_qty is null or p_qty < 0 then
    raise exception 'El stock propio no puede ser negativo';
  end if;

  select greatest(coalesce(v.owned_stock, 0), 0), greatest(coalesce(v.cdr_stock, 0), 0),
         p.stock_locked, p.id, p.fulfillment
    into v_prev, v_cdr, v_locked, v_product, v_fulfillment
    from variants v join products p on p.id = v.product_id
   where v.id = p_variant_id
   for update of v;
  if v_product is null then
    raise exception 'Variante no encontrada';
  end if;

  v_delta := p_qty - v_prev;
  if v_delta = 0 then
    select stock into v_stock from variants where id = p_variant_id;
    return jsonb_build_object('changed', false, 'owned_stock', p_qty, 'stock', v_stock);
  end if;

  -- Mismo criterio que cdr_bulk_update_stock_price: sin candado el total es CDR + propio.
  -- Con candado de stock (Propio) el número lo maneja el admin: se suma la diferencia.
  update variants
     set owned_stock = p_qty,
         stock = case when v_locked then greatest(stock + v_delta, 0) else v_cdr + p_qty end
   where id = p_variant_id
  returning stock into v_stock;

  -- Igual que receive_purchase: un dropship al que le cargan stock propio pasa a "Ambos".
  if v_fulfillment = 'dropship' and p_qty > 0 then
    update products set fulfillment = 'ambos' where id = v_product;
  end if;

  insert into stock_movements(variant_id, kind, quantity, note, created_by)
  values (p_variant_id, 'ajuste', v_delta,
          coalesce(nullif(trim(p_note), ''), 'Stock propio ajustado a mano desde el producto'),
          auth.uid());

  return jsonb_build_object('changed', true, 'owned_stock', p_qty, 'stock', v_stock, 'delta', v_delta);
end
$function$;

-- Regla de rfstore-rpcs-expuestas-agujero: toda RPC nueva define quién la llama.
revoke all on function public.set_owned_stock(uuid, int, text) from public, anon;
grant execute on function public.set_owned_stock(uuid, int, text) to authenticated, service_role;

-- Pasar de "Propio" a "Ambos"/"Dropship" tiene que devolverle el stock al sync de CDR:
-- antes el candado de stock quedaba puesto y la parte de CDR no se actualizaba nunca más.
-- El de PRECIO no se toca: puede ser un precio manual puesto a propósito.
create or replace function public.trg_products_fulfillment_locks()
returns trigger
language plpgsql
as $function$
begin
  if new.fulfillment = 'propio' then
    -- Producto que no es de CDR: precio y stock los manejamos nosotros.
    new.stock_locked := true;
    new.price_locked := true;
  elsif tg_op = 'UPDATE' and old.fulfillment = 'propio' and new.source = 'cdr' then
    new.stock_locked := false;
  end if;
  return new;
end;
$function$;
