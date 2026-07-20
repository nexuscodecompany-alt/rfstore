-- Stock total denormalizado en products.
-- El stock real vive en variants, así que el listado admin sólo podía ordenar por stock
-- en memoria (los 25 de la página visible). Con esta columna el ORDER BY y los filtros
-- por stock corren en la base => ordenan/filtran TODO el catálogo, no la página actual.
-- Mismo patrón que products.is_in_ml (denormalizado + trigger).

alter table public.products
  add column if not exists total_stock integer not null default 0;

create or replace function public.recalc_product_total_stock(p_product_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.products p
     set total_stock = coalesce((
           select sum(greatest(v.stock, 0))
             from public.variants v
            where v.product_id = p_product_id
         ), 0)
   where p.id = p_product_id;
$$;

create or replace function public.trg_variants_sync_total_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recalc_product_total_stock(old.product_id);
    return old;
  end if;

  perform public.recalc_product_total_stock(new.product_id);
  -- Si la variante cambió de producto hay que recalcular también el anterior.
  if tg_op = 'UPDATE' and old.product_id is distinct from new.product_id then
    perform public.recalc_product_total_stock(old.product_id);
  end if;
  return new;
end;
$$;

drop trigger if exists variants_sync_total_stock on public.variants;
create trigger variants_sync_total_stock
  after insert or update of stock, product_id or delete on public.variants
  for each row execute function public.trg_variants_sync_total_stock();

-- Backfill inicial.
update public.products p
   set total_stock = coalesce(s.total, 0)
  from (
    select product_id, sum(greatest(stock, 0)) as total
      from public.variants
     group by product_id
  ) s
 where s.product_id = p.id
   and p.total_stock is distinct from coalesce(s.total, 0);

create index if not exists products_total_stock_idx on public.products (total_stock);
