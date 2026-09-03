-- CDR / marcas nuevas: avisar cuales faltan y auto-asociar al crearlas.
--
-- Ya teniamos la mitad: cuando CDR manda un producto cuya marca EXISTE en la tienda, el
-- trigger cdr_assign_brand_on_insert se la pone solo. Lo que faltaba es el caso inverso,
-- que es el que genera trabajo manual: CDR empieza a traer una marca que todavia no
-- tenemos dada de alta, esos productos entran sin marca y nadie se entera hasta que
-- alguien los mira uno por uno.
--
-- Dos piezas:
--   1. cdr_pending_brands(): que marcas de CDR NO existen en la tienda y cuantos productos
--      estan esperando cada una. Es la lista accionable para el panel.
--   2. trigger sobre brands: al CREAR (o corregir el nombre de) una marca, se lleva de una
--      todos los productos de CDR que la estaban esperando. Va en la base y no en el front
--      para que valga por cualquier via: el panel, una carga masiva o un fix a mano.

-- ---------------------------------------------------------------------------------
-- 1. Las marcas que CDR manda y no tenemos
-- ---------------------------------------------------------------------------------
create or replace function public.cdr_pending_brands()
returns table (
  marca             text,
  productos         bigint,
  productos_activos bigint,
  ejemplos          text[]
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Lo consulta el admin desde el panel. Sin este control quedaria expuesta con la anon key.
  if not public.is_admin() then
    raise exception 'no_autorizado';
  end if;

  return query
  select
    p.cdr_marca as marca,
    count(*)                                as productos,
    count(*) filter (where p.active)        as productos_activos,
    -- Un par de nombres reales para que se entienda de que marca estamos hablando
    -- sin tener que ir a buscarla.
    (array_agg(p.name order by p.created_at desc))[1:3] as ejemplos
  from products p
  where p.source = 'cdr'
    and p.brand_id is null
    and coalesce(trim(p.cdr_marca), '') <> ''
    and not exists (
      select 1 from brands b
      where lower(trim(b.name)) = lower(trim(p.cdr_marca))
    )
  group by p.cdr_marca
  order by count(*) desc, p.cdr_marca;
end
$function$;

revoke all on function public.cdr_pending_brands() from public;
revoke all on function public.cdr_pending_brands() from anon;
grant execute on function public.cdr_pending_brands() to authenticated;

comment on function public.cdr_pending_brands() is
  'Marcas que CDR manda en cdr_marca y NO existen en brands, con cuantos productos esperan cada una. Solo admin. Ver docs/cdr/README.md.';


-- ---------------------------------------------------------------------------------
-- 2. Al crear la marca, los productos que la esperaban se acomodan solos
-- ---------------------------------------------------------------------------------
create or replace function public.trg_brand_claim_cdr_products()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_claimed int;
begin
  if coalesce(trim(new.name), '') = '' then
    return new;
  end if;

  -- Solo productos de CDR SIN marca: jamas se pisa una asignacion hecha a mano.
  -- El match es exacto sobre el nombre normalizado, igual que cdr_autoassign_brands:
  -- equivocarse de marca en una ficha es peor que dejarla vacia.
  update products p
     set brand_id = new.id
   where p.source = 'cdr'
     and p.brand_id is null
     and lower(trim(p.cdr_marca)) = lower(trim(new.name));

  get diagnostics v_claimed = row_count;
  if v_claimed > 0 then
    raise notice 'marca % (%): % producto(s) de CDR asociados', new.name, new.id, v_claimed;
  end if;

  return new;
end
$function$;

-- INSERT y tambien UPDATE del nombre: si la marca se creo con un typo y despues se corrige
-- para que coincida con la de CDR, los productos se acomodan igual sin tener que tocarlos.
drop trigger if exists brand_claim_cdr_products on public.brands;
create trigger brand_claim_cdr_products
  after insert or update of name on public.brands
  for each row execute function public.trg_brand_claim_cdr_products();

comment on function public.trg_brand_claim_cdr_products() is
  'Al crear o renombrar una marca, le asigna los productos de CDR que la esperaban (cdr_marca coincide y brand_id esta vacio). Nunca pisa una marca puesta a mano.';
