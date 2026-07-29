-- ---------------------------------------------------------------------------
-- PAGO ONLINE PARA PRODUCTOS MANUALES
--
-- Hasta ahora "se puede comprar online" era sinónimo de "viene de CDR"
-- (products.source = 'cdr'); todo lo cargado a mano caía en "Consultar por
-- WhatsApp". Ahora el admin decide producto por producto con esta bandera:
--   source = 'cdr'                -> pago online (como siempre)
--   source = 'local' + online_payment = true -> pago online (nuevo)
--   source = 'local' + online_payment = false -> consulta por WhatsApp
--
-- Default false: ningún producto manual ya cargado cambia de comportamiento.
-- ---------------------------------------------------------------------------

alter table public.products
	add column if not exists online_payment boolean not null default false;

comment on column public.products.online_payment is
	'Producto manual habilitado para compra online (carrito + checkout). Los productos CDR (source=cdr) se venden online siempre, sin depender de esta bandera.';

-- ---------------------------------------------------------------------------
-- Vista de la tienda: exponer la bandera. La vista se recrea con la MISMA
-- lista de columnas y `online_payment` agregada al final (requisito de
-- CREATE OR REPLACE VIEW).
-- ---------------------------------------------------------------------------

create or replace view public.products_with_price as
	with sales as (
		select v.product_id, sum(oi.quantity)::integer as units
		from order_items oi
			join orders o on o.id = oi.order_id
			join variants v on v.id = oi.variant_id
		where lower(o.status) <> all (array['cancelado'::text, 'expirado'::text])
		group by v.product_id
	), base as (
		select p.id,
			p.name,
			p.slug,
			p.images,
			p.features,
			p.description,
			p.created_at,
			p.brand_id,
			p.category_id,
			(select min(rf_sale_price(v.price)) from variants v where v.product_id = p.id) as price,
			p.source,
			p.external_code,
			p.subcategory_id,
			greatest(
				case
					when p.name ~* '\m(iphone|macbook|ipad|airpods|apple\s*watch|mac\s*mini|imac)\M'::text then 100
					when p.name ~* '\m(notebook|laptop|monitor|gaming|gamer|playstation|xbox|ssd nvme)\M'::text then 70
					when p.name ~* '\m(smartphone|tablet|impresora|router|nas|webcam)\M'::text then 40
					else 0
				end,
				case
					when c.name = any (array['Celulares & Accesorios'::text, 'PC, Notebooks & Tablets'::text, 'Gaming'::text, 'Audio & Imagen'::text]) then 50
					else 0
				end) as heur,
			lower(coalesce(b.name, ''::text)) = any (array['apple'::text, 'asus'::text, 'xiaomi'::text, 'lenovo'::text, 'suunto'::text, 'jbl'::text, 'ezviz'::text, 'bambu lab'::text]) as is_top_brand,
			coalesce(s.units, 0) as units_sold,
			p.online_payment
		from products p
			left join categories c on c.id = p.category_id
			left join brands b on b.id = p.brand_id
			left join sales s on s.product_id = p.id
		where p.active and (p.source is distinct from 'cdr'::text or coalesce((select sum(v.stock) from variants v where v.product_id = p.id), 0::bigint) > 0)
	), ranked as (
		select base.id,
			base.name,
			base.slug,
			base.images,
			base.features,
			base.description,
			base.created_at,
			base.brand_id,
			base.category_id,
			base.price,
			base.source,
			base.external_code,
			base.subcategory_id,
			base.heur,
			base.is_top_brand,
			base.units_sold,
			base.online_payment,
			case
				when base.is_top_brand then row_number() over (partition by base.brand_id order by base.units_sold desc, base.heur desc, base.price desc nulls last, base.created_at desc)
				else null::bigint
			end as brand_rank
		from base
	)
	select id,
		name,
		slug,
		images,
		features,
		description,
		created_at,
		brand_id,
		category_id,
		price,
		source,
		external_code,
		subcategory_id,
		(case
			when brand_rank is not null and brand_rank <= 25 then 1000000 - brand_rank
			else heur::bigint
		end)::integer as featured_score,
		online_payment
	from ranked;

-- ---------------------------------------------------------------------------
-- place_cdr_order: candado server-side. El RPC nunca miró el origen del
-- producto, así que un carrito manipulado podía generar una orden de un
-- producto "por consulta". Ahora rechaza cualquier item que no esté
-- habilitado para venta online.
-- ---------------------------------------------------------------------------

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
  v_name text;
  v_buyable boolean;
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

  -- Validar stock (con lock) y que el producto se venda online
  for it in select * from jsonb_array_elements(p_items)
  loop
    select v.stock, p.external_code, p.name, (p.source = 'cdr' or coalesce(p.online_payment, false))
      into v_stock, v_external_code, v_name, v_buyable
      from variants v join products p on p.id = v.product_id
      where v.id = (it->>'variant_id')::uuid for update;
    if v_stock is null then raise exception 'Variante no encontrada'; end if;
    if not v_buyable then raise exception 'El producto % es solo por consulta', coalesce(v_name, v_external_code, 'seleccionado'); end if;
    if v_stock < (it->>'quantity')::int then raise exception 'Sin stock para %', coalesce(v_external_code, v_name, 'producto'); end if;
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
