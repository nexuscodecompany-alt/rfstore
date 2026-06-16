-- products.is_in_ml: flag denormalizado = el producto tiene publicación ML viva
-- (active/paused). Mantenido por trigger sobre ml_item_mapping. Permite filtrar
-- productos publicados en ML sin pasar cientos de IDs por la URL (que rompía el
-- filtro "En Mercado Libre" del panel). Aplicado a prod 2026-06-16 vía MCP.

alter table public.products add column if not exists is_in_ml boolean not null default false;

create or replace function public.recompute_product_in_ml(p_product_id uuid)
returns void language sql security definer set search_path = public as $$
  update products p set is_in_ml = exists(
    select 1 from ml_item_mapping m where m.product_id = p.id and m.status in ('active','paused')
  ) where p.id = p_product_id;
$$;

create or replace function public.trg_ml_mapping_in_ml()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform recompute_product_in_ml(old.product_id);
    return old;
  end if;
  perform recompute_product_in_ml(new.product_id);
  if tg_op = 'UPDATE' and new.product_id is distinct from old.product_id then
    perform recompute_product_in_ml(old.product_id);
  end if;
  return new;
end $$;

drop trigger if exists ml_mapping_in_ml on public.ml_item_mapping;
create trigger ml_mapping_in_ml after insert or update or delete on public.ml_item_mapping
for each row execute function trg_ml_mapping_in_ml();

update products p set is_in_ml = exists(
  select 1 from ml_item_mapping m where m.product_id = p.id and m.status in ('active','paused')
);
