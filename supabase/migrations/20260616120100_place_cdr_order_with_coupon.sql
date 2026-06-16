-- place_cdr_order: agrega p_coupon_code (9º param) y aplica el cupón server-side
-- (subtotal de items, descuento, envío gratis, registra coupon en la orden e
-- incrementa used_count). Aplicado a producción 2026-06-16 vía MCP.

drop function if exists public.place_cdr_order(jsonb, numeric, jsonb, text, text, text, text, numeric);

create or replace function public.place_cdr_order(
  p_items jsonb,
  p_total numeric,
  p_address jsonb,
  p_payment_method text,
  p_shipping_zone text,
  p_shipping_barrio text,
  p_shipping_department text,
  p_shipping_cost_usd numeric,
  p_coupon_code text default null
) returns bigint
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_customer_id uuid;
  v_address_id uuid;
  v_order_id bigint;
  it jsonb;
  v_stock int;
  v_external_code text;
  v_subtotal numeric;
  v_shipping numeric;
  v_discount numeric := 0;
  v_free boolean := false;
  v_coupon_id uuid := null;
  v_total numeric;
  v_cres jsonb;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select id into v_customer_id from customers where user_id = v_uid limit 1;
  if v_customer_id is null then raise exception 'Cliente no encontrado'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'El carrito está vacío'; end if;
  if p_payment_method not in ('mercadopago', 'transfer', 'deposit') then raise exception 'Método de pago inválido'; end if;

  -- Validar stock con lock
  for it in select * from jsonb_array_elements(p_items)
  loop
    select stock, p.external_code into v_stock, v_external_code
      from variants v join products p on p.id = v.product_id
      where v.id = (it->>'variant_id')::uuid for update;
    if v_stock is null then raise exception 'Variante no encontrada'; end if;
    if v_stock < (it->>'quantity')::int then raise exception 'Sin stock para %', coalesce(v_external_code, 'producto'); end if;
  end loop;

  -- Subtotal de productos (autoritativo, desde los items)
  select coalesce(sum((e->>'price')::numeric * (e->>'quantity')::int), 0)
    into v_subtotal from jsonb_array_elements(p_items) e;
  v_shipping := coalesce(p_shipping_cost_usd, 0);

  -- Cupón (server-side)
  if p_coupon_code is not null and length(trim(p_coupon_code)) > 0 then
    v_cres := public.apply_coupon(p_coupon_code, p_items, v_subtotal, v_shipping);
    if (v_cres->>'valid')::boolean then
      v_discount := coalesce((v_cres->>'discount_usd')::numeric, 0);
      v_free := coalesce((v_cres->>'free_shipping')::boolean, false);
      v_coupon_id := (v_cres->>'coupon_id')::uuid;
    end if;
  end if;
  if v_free then v_shipping := 0; end if;
  v_total := greatest(0, v_subtotal - v_discount + v_shipping);

  -- Dirección
  insert into addresses(address_line1, address_line2, city, state, postal_code, country, customer_id)
  values (coalesce(p_address->>'address_line1', ''), p_address->>'address_line2',
          coalesce(p_address->>'city', ''), coalesce(p_address->>'state', ''),
          p_address->>'postal_code', coalesce(nullif(p_address->>'country', ''), 'Uruguay'), v_customer_id)
  returning id into v_address_id;

  -- Orden
  insert into orders(customer_id, address_id, total_amount, status, payment_method, payment_status,
                     shipping_zone, shipping_barrio, shipping_department, shipping_cost_usd,
                     coupon_id, coupon_code, discount_usd)
  values (v_customer_id, v_address_id, v_total, 'pago_pendiente', p_payment_method, 'pending',
          p_shipping_zone, p_shipping_barrio, p_shipping_department, v_shipping,
          v_coupon_id, case when v_coupon_id is not null then upper(trim(p_coupon_code)) else null end, v_discount)
  returning id into v_order_id;

  -- Items
  insert into order_items(order_id, variant_id, price, quantity)
  select v_order_id, (e->>'variant_id')::uuid, (e->>'price')::numeric, (e->>'quantity')::int
  from jsonb_array_elements(p_items) e;

  -- Descontar stock (reserva)
  for it in select * from jsonb_array_elements(p_items)
  loop
    update variants set stock = stock - (it->>'quantity')::int where id = (it->>'variant_id')::uuid;
  end loop;

  -- Registrar uso del cupón
  if v_coupon_id is not null then
    update coupons set used_count = used_count + 1 where id = v_coupon_id;
  end if;

  return v_order_id;
end;
$function$;
