-- subcategories.sort_order: orden manual de las subcategorías dentro de cada categoría.
-- Define el orden del mega-menú del navbar (CategoryBar) y se edita desde
-- /dashboard/taxonomias y desde /dashboard/home (bloque "Barra de categorías destacadas").
--
-- NOTA: la columna ya existía en producción, creada a mano desde el panel de Supabase y
-- nunca versionada. Esta migración la deja registrada en el repo de forma idempotente,
-- para que un entorno nuevo o un reset de la base la reproduzcan igual. Sin ella,
-- getSubcategories() rompe entero (PostgREST rechaza el select de una columna inexistente)
-- y el navbar se queda sin subcategorías.

alter table public.subcategories
  add column if not exists sort_order integer not null default 0;

-- Normaliza a 1..N por categoría. Las creadas antes de este fix quedaban en 0 (el default)
-- y por eso aparecían PRIMERAS en el menú en vez de al final.
with ordenado as (
  select id,
         row_number() over (partition by category_id order by sort_order, name) as rn
    from public.subcategories
)
update public.subcategories s
   set sort_order = o.rn
  from ordenado o
 where o.id = s.id
   and s.sort_order is distinct from o.rn;

create index if not exists subcategories_category_sort_idx
  on public.subcategories (category_id, sort_order);
