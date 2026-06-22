-- RPCs atómicos para ventas manuales que pueden descontar stock.
-- Si vienen items (productos del catálogo), descuenta variants.stock de cada uno
-- (el trigger variants_stock_to_ml sincroniza el stock a la publicación de ML).
-- Si no vienen items, es una venta libre/externa (solo costo/precio).
create or replace function public.create_manual_sale(
  p_concept_id uuid,
  p_description text,
  p_currency text,
  p_sale_amount numeric,
  p_total_usd numeric,
  p_fx_rate numeric,
  p_cost_usd numeric,
  p_extra_usd numeric,
  p_sale_date timestamptz,
  p_items jsonb
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_order_id bigint;
  v_item jsonb;
  v_variant uuid;
  v_qty int;
begin
  if not is_admin() then raise exception 'not_authorized'; end if;

  insert into orders (customer_id, address_id, channel, status, payment_method, payment_status,
    concept_id, manual_description, total_amount, total_original, ml_currency, fx_rate,
    manual_cost_usd, manual_extra_costs_usd, paid_at, created_at)
  values (null, null, 'manual', 'Concretado', null, 'paid',
    p_concept_id, nullif(btrim(coalesce(p_description,'')),''),
    p_total_usd, p_sale_amount, p_currency, coalesce(p_fx_rate,1),
    coalesce(p_cost_usd,0), coalesce(p_extra_usd,0),
    coalesce(p_sale_date, now()), coalesce(p_sale_date, now()))
  returning id into v_order_id;

  if p_items is not null then
    for v_item in select * from jsonb_array_elements(p_items) loop
      v_variant := (v_item->>'variant_id')::uuid;
      v_qty := coalesce((v_item->>'quantity')::int, 0);
      if v_variant is not null and v_qty > 0 then
        insert into order_items (order_id, variant_id, quantity, price, cost_usd)
          values (v_order_id, v_variant, v_qty, 0, 0);
        update variants set stock = greatest(0, stock - v_qty) where id = v_variant;
      end if;
    end loop;
  end if;

  return v_order_id;
end;
$$;

create or replace function public.delete_manual_sale(p_order_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not is_admin() then raise exception 'not_authorized'; end if;
  if not exists (select 1 from orders where id = p_order_id and channel='manual') then
    raise exception 'not_manual_order';
  end if;
  for r in select variant_id, quantity from order_items
           where order_id = p_order_id and variant_id is not null loop
    update variants set stock = stock + r.quantity where id = r.variant_id;
  end loop;
  delete from orders where id = p_order_id; -- order_items en cascada
end;
$$;

grant execute on function public.create_manual_sale(uuid,text,text,numeric,numeric,numeric,numeric,numeric,timestamptz,jsonb) to authenticated;
grant execute on function public.delete_manual_sale(bigint) to authenticated;
