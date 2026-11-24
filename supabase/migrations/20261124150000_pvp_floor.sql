-- =============================================================================
-- Piso PVP de la marca (24/11/2026)
-- -----------------------------------------------------------------------------
-- Bambu Lab exige un precio mínimo: CDR lo manda como `pvp` (web) y `pvpml`
-- (Mercado Libre) y ya lo guardamos en products.cdr_pvp_usd / cdr_pvpml_usd.
-- Decisión del dueño: aplicarlo SÓLO a impresoras y AMS de Bambu Lab.
--
--   precio final = max(precio por margen, PVP)       (si el producto tiene el piso)
--
-- * products.pvp_floor: interruptor por producto (checkbox en el form).
--   Se prende solo para impresoras/AMS de Bambu Lab al crear o al cambiarles
--   marca/nombre; el admin lo puede apagar/prender a mano.
-- * web_price_floor_usd / ml_price_floor_usd: columnas generadas con el piso
--   vigente (NULL = sin piso). Son lo único que leen los precios.
--   ML sin pvpml usa el pvp web (nunca más barato que la web).
-- * rf_sale_price(cost, override, floor): el piso entra DESPUÉS del margen.
--   El margen manual sigue funcionando, pero nunca baja del PVP.
-- =============================================================================

alter table public.products
  add column if not exists pvp_floor boolean not null default false;

comment on column public.products.pvp_floor is
  'Respetar el PVP mínimo de la marca (cdr_pvp_usd web / cdr_pvpml_usd ML). Auto para impresoras y AMS Bambu Lab.';

alter table public.products
  add column if not exists web_price_floor_usd numeric
    generated always as (case when pvp_floor then cdr_pvp_usd end) stored,
  add column if not exists ml_price_floor_usd numeric
    generated always as (case when pvp_floor then coalesce(cdr_pvpml_usd, cdr_pvp_usd) end) stored;

-- ---------------------------------------------------------------------------
-- Regla automática: impresoras y AMS de Bambu Lab
-- ---------------------------------------------------------------------------
create or replace function public.rf_pvp_floor_rule(p_name text, p_brand_id uuid)
returns boolean
language sql stable
set search_path to 'public'
as $$
  select (
           coalesce((select lower(b.name) = 'bambu lab' from brands b where b.id = p_brand_id), false)
           or coalesce(p_name, '') ~* '\mbambu\s*lab\M'
         )
     -- La impresora o el AMS en sí: el nombre EMPIEZA así. "Cable ... para AMS
     -- Lite" o "Tubo PTFE ... para AMS" son accesorios y quedan afuera.
     and (
           coalesce(p_name, '') ~* '^\s*impresora'
           or coalesce(p_name, '') ~* '^\s*bambu\s*lab\s+ams\M'
         );
$$;

create or replace function public.trg_products_pvp_floor_auto()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if tg_op = 'INSERT' then
    if public.rf_pvp_floor_rule(new.name, new.brand_id) then
      new.pvp_floor := true;
    end if;
  elsif (new.name is distinct from old.name or new.brand_id is distinct from old.brand_id)
        and new.pvp_floor is not distinct from old.pvp_floor then
    -- Sólo cuando cambian marca/nombre y el admin no tocó el checkbox en el mismo guardado.
    if public.rf_pvp_floor_rule(new.name, new.brand_id) then
      new.pvp_floor := true;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists products_pvp_floor_auto on public.products;
create trigger products_pvp_floor_auto
  before insert or update of name, brand_id on public.products
  for each row execute function public.trg_products_pvp_floor_auto();

update public.products set pvp_floor = true
 where public.rf_pvp_floor_rule(name, brand_id) and not pvp_floor;

-- ---------------------------------------------------------------------------
-- Precio web con piso
-- ---------------------------------------------------------------------------
create or replace function public.rf_sale_price(cost numeric, p_override numeric, p_floor numeric)
returns numeric
language sql stable
set search_path to 'public'
as $$
  select case
           when cost is null then null
           when coalesce(p_floor, 0) > 0 then greatest(public.rf_sale_price(cost, p_override), ceil(p_floor))
           else public.rf_sale_price(cost, p_override)
         end;
$$;

revoke all on function public.rf_sale_price(numeric, numeric, numeric) from public;
grant execute on function public.rf_sale_price(numeric, numeric, numeric) to anon, authenticated, service_role;
revoke all on function public.rf_pvp_floor_rule(text, uuid) from public, anon, authenticated;
revoke all on function public.trg_products_pvp_floor_auto() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Callers: pasan el piso. Se reescribe la definición VIVA (los mirrors del repo
-- no siempre coinciden con prod) y se exige que el reemplazo haya ocurrido.
-- ---------------------------------------------------------------------------
do $mig$
declare
  r record;
  d text;
  d2 text;
begin
  for r in
    select * from (values
      ('public.get_cart_prices(uuid[])',                 'p.margin_override_percent)',  'p.margin_override_percent, p.web_price_floor_usd)'),
      ('public.get_checkout_extras(uuid[],integer)',     'pr.margin_override_percent',  'pr.margin_override_percent, pr.web_price_floor_usd'),
      ('public.restore_abandoned_cart(uuid)',            'p.margin_override_percent)',  'p.margin_override_percent, p.web_price_floor_usd)'),
      ('public.place_cdr_order(jsonb,numeric,jsonb,text,text,text,text,numeric,text,jsonb,jsonb)',
                                                         'p.margin_override_percent)',  'p.margin_override_percent, p.web_price_floor_usd)')
    ) as t(sig, old_txt, new_txt)
  loop
    d := pg_get_functiondef(r.sig::regprocedure);
    if position('web_price_floor_usd' in d) > 0 then
      continue; -- ya migrada
    end if;
    d2 := replace(d, r.old_txt, r.new_txt);
    if d2 = d then
      raise exception 'pvp_floor: no encontré "%" en %', r.old_txt, r.sig;
    end if;
    execute d2;
  end loop;
end
$mig$;

-- Vista de la tienda: el precio (orden y filtro por precio) respeta el piso y
-- se expone web_price_floor_usd para que el front muestre lo mismo.
do $mig$
declare
  d text;
  d2 text;
begin
  d := pg_get_viewdef('public.products_with_price'::regclass);
  if position('web_price_floor_usd' in d) > 0 then
    return;
  end if;
  d2 := replace(d, 'rf_sale_price(v.price, p.margin_override_percent)',
                   'rf_sale_price(v.price, p.margin_override_percent, p.web_price_floor_usd)');
  d2 := replace(d2, E'p.margin_override_percent\n           FROM', E'p.margin_override_percent,\n            p.web_price_floor_usd\n           FROM');
  d2 := replace(d2, E'base.margin_override_percent,\n', E'base.margin_override_percent,\n            base.web_price_floor_usd,\n');
  d2 := regexp_replace(d2, E'search_blob,\n    margin_override_percent\n   FROM ranked',
                           E'search_blob,\n    margin_override_percent,\n    web_price_floor_usd\n   FROM ranked');
  if (length(d2) - length(replace(d2, 'web_price_floor_usd', ''))) / length('web_price_floor_usd') <> 4 then
    raise exception 'pvp_floor: la vista products_with_price no quedó con las 4 referencias esperadas';
  end if;
  execute 'create or replace view public.products_with_price as ' || d2;
end
$mig$;

-- ---------------------------------------------------------------------------
-- ML: cambiar el piso (o el PVP que manda CDR) también reprecia en ML.
-- ---------------------------------------------------------------------------
create or replace function public.trg_products_ml_reprice_on_cost()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.price_usd is not distinct from old.price_usd
     and new.category_id is not distinct from old.category_id
     and new.subcategory_id is not distinct from old.subcategory_id
     and new.ml_price_floor_usd is not distinct from old.ml_price_floor_usd then
    return null;
  end if;
  if coalesce(new.price_usd, 0) <= 0 then
    return null;
  end if;
  if not exists (select 1 from public.ml_item_mapping m
                  where m.product_id = new.id and m.status in ('active','paused')) then
    return null;
  end if;

  insert into public.ml_reprice_pending (product_id, old_cost, new_cost)
  values (new.id, old.price_usd, new.price_usd)
  on conflict (product_id) do update
    set new_cost = excluded.new_cost, queued_at = now(), dispatched_at = null;
  return null;
end;
$function$;

drop trigger if exists products_ml_reprice_on_cost on public.products;
create trigger products_ml_reprice_on_cost
  after update of price_usd, category_id, subcategory_id, pvp_floor, cdr_pvp_usd, cdr_pvpml_usd
  on public.products
  for each row execute function public.trg_products_ml_reprice_on_cost();
