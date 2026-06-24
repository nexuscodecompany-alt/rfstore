-- Columna computada (PostgREST) que indica qué tan listo está un producto para
-- publicarse en Mercado Libre, como % (0-100). Misma lógica que getMlReadiness en
-- el front: 6 chequeos (activo, costo, stock>umbral, ≥1 imagen, marca, categoría).
-- Permite filtrar el listado del admin por "% listo" (ej: ml_ready_percent=gte.70)
-- con paginación correcta a nivel base (no solo la página visible).
create or replace function public.ml_ready_percent(p public.products)
returns integer
language sql
stable
set search_path = public
as $$
  select round(
    (
        (case when p.active then 1 else 0 end)
      + (case when coalesce(p.price_usd, 0) > 0 then 1 else 0 end)
      + (case when coalesce((select sum(v.stock) from public.variants v where v.product_id = p.id), 0)
               > coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'ml_stock_threshold'), 3)
              then 1 else 0 end)
      + (case when coalesce(array_length(p.images, 1), 0) >= 1 then 1 else 0 end)
      + (case when p.brand_id is not null then 1 else 0 end)
      + (case when p.category_id is not null then 1 else 0 end)
    )::numeric * 100 / 6
  )::int
$$;
