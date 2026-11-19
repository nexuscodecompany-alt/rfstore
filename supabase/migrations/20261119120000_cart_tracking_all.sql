-- 19/11/2026 — Carrito abandonado EN GENERAL, no sólo en el checkout.
-- Antes un carrito llegaba a la base recién cuando el cliente abría el checkout y
-- escribía email/teléfono. El que agregaba productos y se iba no dejaba rastro
-- (pedido del dueño: "tenemos que tener sí o sí el carrito en admin").
--
-- Ahora la web avisa cada cambio del carrito (track_cart), con o sin sesión:
--   * sin sesión: se identifica por un id anónimo del navegador (anon_id).
--   * con sesión (cuenta o invitado): por user_id, y adopta el carrito anónimo.
-- stage = 'cart' (sólo agregó al carrito) | 'checkout' (llegó al checkout).
-- Los de stage 'cart' NO guardan email: el mail de recuperación sigue saliendo
-- sólo a los que llegaron al checkout (abandoned-cart-recovery filtra email not null).

alter table public.checkout_leads
  add column if not exists anon_id text,
  add column if not exists stage text not null default 'checkout';

alter table public.checkout_leads drop constraint if exists checkout_leads_stage_chk;
alter table public.checkout_leads
  add constraint checkout_leads_stage_chk check (stage in ('cart','checkout'));

create unique index if not exists checkout_leads_anon_open_idx
  on public.checkout_leads (anon_id)
  where status = 'started' and user_id is null and anon_id is not null;

-- Normaliza el carrito que manda el navegador: sólo los campos que usamos, tope de ítems.
create or replace function public.cart_lead_sanitize(p_cart jsonb)
returns jsonb
language sql
immutable
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'variantId', left(coalesce(e->>'variantId',''), 64),
           'name',      left(coalesce(e->>'name','Producto'), 200),
           'image',     left(coalesce(e->>'image',''), 500),
           'quantity',  least(greatest(coalesce((e->>'quantity')::int, 1), 1), 999),
           'price',     least(greatest(coalesce((e->>'price')::numeric, 0), 0), 1000000)
         )), '[]'::jsonb)
    from (
      select e from jsonb_array_elements(
        case when jsonb_typeof(p_cart) = 'array' then p_cart else '[]'::jsonb end) e
      where jsonb_typeof(e) = 'object'
      limit 50
    ) t;
$$;
revoke all on function public.cart_lead_sanitize(jsonb) from public, anon, authenticated;

create or replace function public.track_cart(p_anon_id text, p_cart jsonb, p_total numeric)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_anon text := nullif(left(trim(coalesce(p_anon_id,'')), 64), '');
  v_cart jsonb := public.cart_lead_sanitize(p_cart);
  v_n int;
  v_total numeric := least(greatest(coalesce(p_total, 0), 0), 10000000);
  v_customer uuid;
  v_user_lead uuid;
  v_anon_lead uuid;
begin
  if v_anon is not null and v_anon !~ '^[0-9a-fA-F-]{36}$' then v_anon := null; end if;
  if v_uid is null and v_anon is null then return; end if;
  v_n := jsonb_array_length(v_cart);

  if v_uid is not null then
    select id into v_customer from customers where user_id = v_uid limit 1;
    select id into v_user_lead from checkout_leads where user_id = v_uid and status = 'started' limit 1;
    if v_anon is not null then
      select id into v_anon_lead from checkout_leads
       where anon_id = v_anon and user_id is null and status = 'started' limit 1;
    end if;

    -- Inició sesión con un carrito anónimo abierto: se lo queda (o se descarta si ya tenía uno).
    if v_anon_lead is not null then
      if v_user_lead is null then
        update checkout_leads set user_id = v_uid, customer_id = coalesce(v_customer, customer_id)
         where id = v_anon_lead;
        v_user_lead := v_anon_lead;
      else
        delete from checkout_leads where id = v_anon_lead;
      end if;
    end if;

    if v_user_lead is null then
      if v_n = 0 then return; end if;
      insert into checkout_leads(user_id, customer_id, anon_id, stage, cart, items_count, total_usd, abandoned_at)
      values (v_uid, v_customer, v_anon, 'cart', v_cart, v_n, v_total, now());
      return;
    end if;

    if v_n = 0 then
      -- Vació el carrito: si sólo había agregado, se borra; si llegó al checkout, queda el registro.
      delete from checkout_leads where id = v_user_lead and stage = 'cart';
      if found then return; end if;
    end if;

    update checkout_leads set
      customer_id = coalesce(v_customer, customer_id),
      anon_id = coalesce(anon_id, v_anon),
      cart = v_cart, items_count = v_n, total_usd = v_total,
      updated_at = now(), abandoned_at = now()
     where id = v_user_lead;
    return;
  end if;

  -- Visitante sin sesión.
  select id into v_anon_lead from checkout_leads
   where anon_id = v_anon and user_id is null and status = 'started' limit 1;
  if v_anon_lead is null then
    if v_n = 0 then return; end if;
    insert into checkout_leads(anon_id, stage, cart, items_count, total_usd, abandoned_at)
    values (v_anon, 'cart', v_cart, v_n, v_total, now());
  elsif v_n = 0 then
    delete from checkout_leads where id = v_anon_lead;
  else
    update checkout_leads set cart = v_cart, items_count = v_n, total_usd = v_total,
      updated_at = now(), abandoned_at = now()
     where id = v_anon_lead;
  end if;
end;
$$;
revoke all on function public.track_cart(text, jsonb, numeric) from public;
grant execute on function public.track_cart(text, jsonb, numeric) to anon, authenticated;

-- track_checkout_lead: marca stage 'checkout', guarda el carrito saneado (con variantId,
-- que necesita restore_abandoned_cart para el link del mail) y adopta el carrito anónimo.
drop function if exists public.track_checkout_lead(text, text, text, jsonb, numeric, text, text);
create or replace function public.track_checkout_lead(
  p_email text, p_phone text, p_full_name text, p_cart jsonb, p_total numeric,
  p_shipping_zone text default null, p_shipping_department text default null,
  p_anon_id text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_customer_id uuid;
  v_id uuid;
  v_anon text := nullif(left(trim(coalesce(p_anon_id,'')), 64), '');
  v_cart jsonb := public.cart_lead_sanitize(p_cart);
begin
  if v_uid is null then return null; end if;
  select id into v_customer_id from customers where user_id = v_uid limit 1;

  select id into v_id from checkout_leads
   where user_id = v_uid and status = 'started'
   limit 1;

  if v_anon is not null then
    if v_id is null then
      update checkout_leads set user_id = v_uid
       where anon_id = v_anon and user_id is null and status = 'started'
      returning id into v_id;
    else
      delete from checkout_leads where anon_id = v_anon and user_id is null and status = 'started';
    end if;
  end if;

  if v_id is null then
    insert into checkout_leads(user_id, customer_id, anon_id, stage, email, phone, full_name, cart,
                               items_count, total_usd, shipping_zone, shipping_department,
                               abandoned_at)
    values (v_uid, v_customer_id, v_anon, 'checkout', nullif(trim(p_email), ''), nullif(trim(p_phone), ''),
            nullif(trim(p_full_name), ''), v_cart,
            jsonb_array_length(v_cart), coalesce(p_total, 0),
            p_shipping_zone, p_shipping_department, now())
    returning id into v_id;
  else
    update checkout_leads set
      stage = 'checkout',
      customer_id = coalesce(v_customer_id, customer_id),
      anon_id = coalesce(anon_id, v_anon),
      email = coalesce(nullif(trim(p_email), ''), email),
      phone = coalesce(nullif(trim(p_phone), ''), phone),
      full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
      cart = v_cart,
      items_count = jsonb_array_length(v_cart),
      total_usd = coalesce(p_total, total_usd),
      shipping_zone = coalesce(p_shipping_zone, shipping_zone),
      shipping_department = coalesce(p_shipping_department, shipping_department),
      updated_at = now(),
      -- Cada señal de vida corre el reloj: el cliente sigue acá, no abandonó.
      abandoned_at = now()
    where id = v_id;
  end if;

  return v_id;
end;
$function$;
revoke all on function public.track_checkout_lead(text, text, text, jsonb, numeric, text, text, text) from public;
grant execute on function public.track_checkout_lead(text, text, text, jsonb, numeric, text, text, text) to anon, authenticated;

-- Al crearse la orden se cierra el carrito también por user_id (los invitados y los
-- carritos adoptados pueden no tener customer_id todavía).
create or replace function public.trg_orders_close_checkout_lead()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_uid uuid;
begin
  if new.customer_id is null then return new; end if;
  select user_id into v_uid from customers where id = new.customer_id;
  update checkout_leads
     set status = 'converted', order_id = new.id, updated_at = now(),
         customer_id = coalesce(customer_id, new.customer_id)
   where status = 'started'
     and (customer_id = new.customer_id or (v_uid is not null and user_id = v_uid));
  return new;
end;
$function$;

-- Panel: agrega stage para distinguir "sólo agregó al carrito" de "llegó al checkout".
drop function if exists public.admin_checkout_activity();
create function public.admin_checkout_activity()
 returns table(source text, ref_id text, happened_at timestamp with time zone, customer_id uuid, full_name text, email text, phone text, items text, items_count integer, total_usd numeric, shipping_zone text, shipping_department text, converted boolean, order_id bigint, payment_method text, order_status text, stage text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    raise exception 'solo admin';
  end if;

  return query
  select 'orden'::text, o.id::text, o.created_at, o.customer_id,
         c.full_name, c.email, c.phone,
         coalesce((
           select string_agg(pr.name || ' x' || oi.quantity, ' · ')
             from order_items oi
             join variants v on v.id = oi.variant_id
             join products pr on pr.id = v.product_id
            where oi.order_id = o.id
         ), '')::text,
         coalesce((select sum(oi.quantity)::int from order_items oi where oi.order_id = o.id), 0),
         o.total_amount, o.shipping_zone, o.shipping_department,
         (o.payment_status = 'paid'), o.id, o.payment_method, o.status, 'orden'::text
    from orders o
    left join customers c on c.id = o.customer_id
   where coalesce(o.channel, 'web') = 'web'
     and coalesce(c.internal, false) = false

  union all

  select 'lead'::text, l.id::text, l.updated_at, l.customer_id,
         coalesce(l.full_name, c.full_name),
         coalesce(l.email, c.email),
         coalesce(l.phone, c.phone),
         coalesce((
           select string_agg(coalesce(x->>'name', 'Producto') || ' x' || coalesce(x->>'quantity', '1'), ' · ')
             from jsonb_array_elements(l.cart) x
         ), '')::text,
         l.items_count, l.total_usd, l.shipping_zone, l.shipping_department,
         (l.status = 'converted'), l.order_id, null::text, l.status, l.stage
    from checkout_leads l
    left join customers c on c.id = l.customer_id
   where l.status <> 'converted'
     and l.items_count > 0
     and coalesce(c.internal, false) = false

   order by 3 desc;
end;
$function$;
revoke all on function public.admin_checkout_activity() from public, anon;
grant execute on function public.admin_checkout_activity() to authenticated, service_role;
