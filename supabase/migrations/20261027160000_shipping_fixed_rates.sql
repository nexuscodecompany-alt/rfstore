-- Envíos con tarifa fija por departamento (27/10/2026).
--
-- RF Store deja PQuick (tarifas por zona/barrio) y pasa a:
--   Montevideo  USD 6  · Canelones USD 8  (comprando antes de las 15 h, en el día)
--   resto       DAC, lo abona el cliente al retirar (nunca entra en el total)
--   gratis desde USD 150 en Montevideo Y Canelones.
--
-- El costo lo decide el SERVIDOR a partir del departamento (rf_shipping_quote).
-- Antes place_cdr_order aceptaba el costo que mandaba el navegador y no aplicaba
-- el mínimo de envío gratis: se podía comprar en Montevideo mandando envío 0.
--
-- TRANSICIÓN: mientras el frontend viejo siga en producción, place_cdr_order
-- conserva el comportamiento anterior cuando recibe p_shipping_cost_usd (el
-- viejo siempre lo manda). El frontend nuevo manda null y el servidor calcula.
-- Al subir el frontend nuevo hay que borrar esa rama (ver migración posterior).

-- 1. Nueva zona.
alter table public.orders drop constraint if exists orders_shipping_zone_check;
alter table public.orders add constraint orders_shipping_zone_check
  check (shipping_zone = any (array['montevideo', 'canelones', 'metropolitana', 'interior']));

-- 2. Tarifas. Se conservan las claves viejas (las lee el frontend viejo) y se
--    agregan las nuevas.
insert into public.app_settings(key, value, updated_at)
values ('shipping_rates', '{}'::jsonb, now())
on conflict (key) do nothing;

update public.app_settings
   set value = coalesce(value, '{}'::jsonb) || jsonb_build_object(
         'montevideo_usd', 6,
         'canelones_usd', 8,
         'free_min_usd', 150,
         'free_includes_canelones', true,
         'same_day_cutoff_hour', 15),
       updated_at = now()
 where key = 'shipping_rates';

-- 3. Cotización de envío: ÚNICA fuente de la regla.
create or replace function public.rf_shipping_quote(p_department text, p_subtotal numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_key text := translate(lower(trim(coalesce(p_department, ''))), 'áéíóúü', 'aeiouu');
  v_dept text;
  v_zone text;
  v_rates jsonb;
  v_cost numeric := 0;
  v_free_min numeric;
  v_free boolean := false;
begin
  v_dept := case v_key
    when 'artigas' then 'Artigas'           when 'canelones' then 'Canelones'
    when 'cerro largo' then 'Cerro Largo'   when 'colonia' then 'Colonia'
    when 'durazno' then 'Durazno'           when 'flores' then 'Flores'
    when 'florida' then 'Florida'           when 'lavalleja' then 'Lavalleja'
    when 'maldonado' then 'Maldonado'       when 'montevideo' then 'Montevideo'
    when 'paysandu' then 'Paysandú'         when 'rio negro' then 'Río Negro'
    when 'rivera' then 'Rivera'             when 'rocha' then 'Rocha'
    when 'salto' then 'Salto'               when 'san jose' then 'San José'
    when 'soriano' then 'Soriano'           when 'tacuarembo' then 'Tacuarembó'
    when 'treinta y tres' then 'Treinta y Tres'
    else null end;
  if v_dept is null then
    raise exception 'Elegí el departamento de destino';
  end if;

  select value into v_rates from app_settings where key = 'shipping_rates';
  v_rates := coalesce(v_rates, '{}'::jsonb);
  v_free_min := coalesce((v_rates->>'free_min_usd')::numeric, 0);

  if v_dept = 'Montevideo' then
    v_zone := 'montevideo';
    v_cost := coalesce((v_rates->>'montevideo_usd')::numeric, 6);
  elsif v_dept = 'Canelones' then
    v_zone := 'canelones';
    v_cost := coalesce((v_rates->>'canelones_usd')::numeric, 8);
  else
    -- Interior: DAC, lo abona el cliente en la agencia. Nunca entra al total.
    v_zone := 'interior';
    v_cost := 0;
  end if;

  if v_free_min > 0 and coalesce(p_subtotal, 0) >= v_free_min
     and (v_zone = 'montevideo'
          or (v_zone = 'canelones' and coalesce((v_rates->>'free_includes_canelones')::boolean, false))) then
    v_free := true;
  end if;

  return jsonb_build_object(
    'zone', v_zone,
    'department', v_dept,
    'base_usd', v_cost,
    'shipping_usd', case when v_free then 0 else v_cost end,
    'free_by_threshold', v_free);
end;
$function$;

-- Sólo la llaman place_cdr_order (security definer) y mp-create-preference
-- (service_role). Nadie más.
revoke all on function public.rf_shipping_quote(text, numeric) from public, anon, authenticated;
grant execute on function public.rf_shipping_quote(text, numeric) to service_role;

-- 4. place_cdr_order con el costo de envío calculado en el servidor.
create or replace function public.place_cdr_order(p_items jsonb, p_total numeric, p_address jsonb, p_payment_method text, p_shipping_zone text, p_shipping_barrio text, p_shipping_department text, p_shipping_cost_usd numeric, p_coupon_code text default null::text, p_invoice jsonb default null::jsonb, p_payment_split jsonb default null::jsonb)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_customer_id uuid;
  v_address_id uuid;
  v_order_id bigint;
  it jsonb;
  v_stock int;
  v_external_code text;
  v_name text;
  v_buyable boolean;
  v_lineas jsonb;
  v_subtotal numeric;
  v_shipping numeric;
  v_zone text;
  v_dept text;
  v_quote jsonb;
  v_discount numeric := 0;
  v_free boolean := false;
  v_coupon_id uuid := null;
  v_total numeric;
  v_cres jsonb;
  v_fx numeric := null;
  v_fx_source text := null;
  v_total_uyu numeric := null;
  v_consumed uuid;
  v_status text;
  v_inv boolean := false;
  v_rut text := null;
  v_mp numeric := 0;
  v_tr numeric := 0;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  select id into v_customer_id from customers where user_id = v_uid limit 1;
  if v_customer_id is null then raise exception 'Cliente no encontrado'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'El carrito está vacío'; end if;
  if p_payment_method not in ('mercadopago', 'transfer', 'deposit', 'hybrid') then
    raise exception 'Método de pago inválido'; end if;

  -- Disponibilidad y "vendible online". Aviso temprano, no reserva.
  for it in select * from jsonb_array_elements(p_items)
  loop
    select v.stock, p.external_code, p.name, (p.source = 'cdr' or coalesce(p.online_payment, false))
      into v_stock, v_external_code, v_name, v_buyable
      from variants v join products p on p.id = v.product_id
      where v.id = (it->>'variant_id')::uuid;
    if v_stock is null then raise exception 'Variante no encontrada'; end if;
    if not v_buyable then raise exception 'El producto % es solo por consulta', coalesce(v_name, v_external_code, 'seleccionado'); end if;
    if v_stock < (it->>'quantity')::int then raise exception 'Sin stock para %', coalesce(v_external_code, v_name, 'producto'); end if;
  end loop;

  -- PRECIO CANÓNICO: se calcula acá, nunca se toma del cliente. Queda en una
  -- variable jsonb que se reusa para el subtotal, el cupón y los order_items.
  select jsonb_agg(jsonb_build_object(
           'variant_id',   v.id,
           'quantity',     (e->>'quantity')::int,
           'price',        public.rf_sale_price(
                             case when p.source = 'cdr' then coalesce(p.price_usd, 0)
                                  else coalesce(v.price, 0) end,
                             p.margin_override_percent),
           'cost',         case when p.source = 'cdr' then nullif(p.price_usd, 0)
                                else nullif(v.price, 0) end,
           'is_extra',     coalesce((e->>'is_extra')::boolean, false),
           'extra_source', case when coalesce((e->>'is_extra')::boolean, false)
                                then nullif(e->>'extra_source','') else null end))
    into v_lineas
    from jsonb_array_elements(p_items) e
    join variants v on v.id = (e->>'variant_id')::uuid
    join products p on p.id = v.product_id;

  if v_lineas is null then raise exception 'No se pudieron resolver los productos del carrito'; end if;

  select coalesce(sum((l->>'price')::numeric * (l->>'quantity')::int), 0)
    into v_subtotal from jsonb_array_elements(v_lineas) l;

  if p_shipping_cost_usd is null then
    -- Esquema nuevo: el envío sale del departamento, nunca del cliente.
    v_quote := public.rf_shipping_quote(
                 coalesce(nullif(trim(p_shipping_department), ''), p_address->>'state'),
                 v_subtotal);
    v_zone := v_quote->>'zone';
    v_dept := v_quote->>'department';
    v_shipping := (v_quote->>'shipping_usd')::numeric;
    if v_zone in ('montevideo', 'canelones') and coalesce(trim(p_shipping_barrio), '') = '' then
      raise exception 'Ingresá tu barrio';
    end if;
  else
    -- TRANSICIÓN: frontend viejo (zonas de PQuick). Borrar al subir el nuevo.
    v_zone := p_shipping_zone;
    v_dept := p_shipping_department;
    v_shipping := case when p_shipping_zone = 'interior' then 0
                       else coalesce(p_shipping_cost_usd, 0) end;
  end if;

  if p_coupon_code is not null and length(trim(p_coupon_code)) > 0 then
    -- Un cupón restringido a transferencia NO entra en un pago híbrido: la parte
    -- de MercadoPago paga comisión de pasarela, que es el motivo del descuento.
    v_cres := public.apply_coupon(p_coupon_code, v_lineas, v_subtotal, v_shipping, p_payment_method);
    if (v_cres->>'valid')::boolean then
      v_discount := coalesce((v_cres->>'discount_usd')::numeric, 0);
      v_free := coalesce((v_cres->>'free_shipping')::boolean, false);
      v_coupon_id := (v_cres->>'coupon_id')::uuid;
    else
      raise exception '%', coalesce(v_cres->>'reason', 'Cupón inválido');
    end if;
  end if;
  if v_free then v_shipping := 0; end if;
  v_total := greatest(0, v_subtotal - v_discount + v_shipping);

  -- ---- PAGO HÍBRIDO ----
  if p_payment_method = 'hybrid' then
    if p_payment_split is null then raise exception 'Falta el desglose del pago combinado'; end if;
    v_mp := round(coalesce((p_payment_split->>'mercadopago')::numeric, 0), 2);
    v_tr := round(coalesce((p_payment_split->>'transfer')::numeric, 0), 2);
    if v_mp <= 0 or v_tr <= 0 then
      raise exception 'En el pago combinado los dos montos tienen que ser mayores a cero';
    end if;
    if abs((v_mp + v_tr) - v_total) > 0.01 then
      raise exception 'Los montos del pago combinado suman USD % y el total del pedido es USD %. Revisá el desglose.',
        to_char(v_mp + v_tr, 'FM999999990.00'), to_char(v_total, 'FM999999990.00');
    end if;
  end if;

  -- ---- FACTURA CON RUT ----
  if p_invoice is not null and coalesce((p_invoice->>'requested')::boolean, false) then
    v_inv := true;
    v_rut := nullif(regexp_replace(coalesce(p_invoice->>'rut',''), '[^0-9]', '', 'g'), '');
    if v_rut is null or length(v_rut) <> 12 then
      raise exception 'El RUT tiene que tener 12 dígitos'; end if;
    if coalesce(trim(p_invoice->>'business_name'), '') = '' then
      raise exception 'Ingresá la razón social para la factura'; end if;
    if coalesce(trim(p_invoice->>'address'), '') = '' then
      raise exception 'Ingresá el domicilio fiscal para la factura'; end if;
  end if;

  select (value->>'rate')::numeric, value->>'source'
    into v_fx, v_fx_source
    from app_settings where key = 'usd_uyu_rate_cache';
  if v_fx is not null and v_fx > 0 then
    v_total_uyu := round(v_total * v_fx);
  else
    v_fx := null; v_fx_source := null;
  end if;

  insert into addresses(address_line1, address_line2, city, state, postal_code, country, customer_id)
  values (coalesce(p_address->>'address_line1', ''), p_address->>'address_line2',
          coalesce(p_address->>'city', ''), coalesce(p_address->>'state', ''),
          p_address->>'postal_code', coalesce(nullif(p_address->>'country', ''), 'Uruguay'), v_customer_id)
  returning id into v_address_id;

  -- El híbrido queda "Pendiente": no está pago hasta que entren las DOS partes.
  v_status := case when p_payment_method = 'hybrid' then 'Pendiente' else 'pago_pendiente' end;

  insert into orders(customer_id, address_id, total_amount, status, payment_method, payment_status,
                     shipping_zone, shipping_barrio, shipping_department, shipping_cost_usd,
                     coupon_id, coupon_code, discount_usd, fx_rate, fx_source, total_original,
                     payment_split,
                     invoice_requested, invoice_rut, invoice_business_name, invoice_trade_name,
                     invoice_address, invoice_city, invoice_state, invoice_email)
  values (v_customer_id, v_address_id, v_total, v_status, p_payment_method, 'pending',
          v_zone, nullif(trim(p_shipping_barrio), ''), v_dept, v_shipping,
          v_coupon_id, case when v_coupon_id is not null then upper(trim(p_coupon_code)) else null end, v_discount,
          v_fx, v_fx_source, v_total_uyu,
          case when p_payment_method = 'hybrid'
               then jsonb_build_object('mercadopago', v_mp, 'transfer', v_tr) else null end,
          v_inv, v_rut,
          case when v_inv then trim(p_invoice->>'business_name') end,
          case when v_inv then nullif(trim(p_invoice->>'trade_name'), '') end,
          case when v_inv then trim(p_invoice->>'address') end,
          case when v_inv then nullif(trim(p_invoice->>'city'), '') end,
          case when v_inv then nullif(trim(p_invoice->>'state'), '') end,
          case when v_inv then nullif(trim(p_invoice->>'email'), '') end)
  returning id into v_order_id;

  insert into order_items(order_id, variant_id, price, quantity, cost_usd, is_extra, extra_source)
  select v_order_id, (l->>'variant_id')::uuid, (l->>'price')::numeric, (l->>'quantity')::int,
         (l->>'cost')::numeric, (l->>'is_extra')::boolean, l->>'extra_source'
    from jsonb_array_elements(v_lineas) l;

  -- El stock NO se descuenta acá: esta orden todavía no cobró un peso. Se
  -- descuenta cuando entra la plata, vía take_order_stock (webhook de MP,
  -- register_hybrid_payment o la confirmación manual del admin).

  -- Consumo atómico del cupón.
  if v_coupon_id is not null then
    update coupons
       set used_count = used_count + 1
     where id = v_coupon_id
       and (max_uses is null or used_count < max_uses)
    returning id into v_consumed;
    if v_consumed is null then
      raise exception 'El cupón se agotó mientras confirmábamos tu pedido';
    end if;
  end if;

  return v_order_id;
end;
$function$;
