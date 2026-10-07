-- ML: repreciar solo cuando CDR cambia el costo (07/10/2026).
--
-- Antes el precio de ML solo se recalculaba con el boton "Repreciar" del panel: si CDR
-- subia products.price_usd, la publicacion seguia con el precio viejo (CAM584 vendida a
-- USD 20 cuando con el costo nuevo correspondia 23). Ahora:
--   1. trigger en products: si cambia price_usd (o categoria/subcategoria, que pueden
--      tener override de margen) y el producto tiene publicacion viva, lo anota en
--      ml_reprice_pending.
--   2. cron cada 5 min: ml_reprice_cost_tick() toma hasta 200 anotados y llama a
--      ml-reprice-active con esos product_ids (source='cost_change'), que encola los
--      update_price; ml-process-sync-queue los empuja a ML como siempre.
-- Si no hay nada anotado no despierta ninguna edge function (ver rfstore-disk-io-bloat).

create table if not exists public.ml_reprice_pending (
  product_id uuid primary key references public.products(id) on delete cascade,
  old_cost   numeric,
  new_cost   numeric,
  queued_at  timestamptz not null default now(),
  dispatched_at timestamptz
);
alter table public.ml_reprice_pending enable row level security;
revoke all on public.ml_reprice_pending from anon, authenticated;

create or replace function public.trg_products_ml_reprice_on_cost()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.price_usd is not distinct from old.price_usd
     and new.category_id is not distinct from old.category_id
     and new.subcategory_id is not distinct from old.subcategory_id then
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
$$;

drop trigger if exists products_ml_reprice_on_cost on public.products;
create trigger products_ml_reprice_on_cost
  after update of price_usd, category_id, subcategory_id on public.products
  for each row execute function public.trg_products_ml_reprice_on_cost();

create or replace function public.ml_reprice_cost_tick()
returns void
language plpgsql
security definer
set search_path to 'public', 'vault', 'net'
as $$
declare
  v_token text;
  v_ids   uuid[];
begin
  if not exists (select 1 from public.ml_reprice_pending) then
    return;
  end if;

  select decrypted_secret into v_token
  from vault.decrypted_secrets where name = 'cdr_sync_jwt' limit 1;
  if v_token is null or v_token = '' then
    raise notice 'cdr_sync_jwt no esta en Vault - ml-reprice-active no se invoca';
    return;
  end if;

  -- Toma los no despachados, o los despachados hace >30 min que siguen aca (la llamada
  -- fallo: ml-reprice-active borra la fila recien cuando encolo el precio).
  with picked as (
    select product_id from public.ml_reprice_pending
     where dispatched_at is null or dispatched_at < now() - interval '30 minutes'
     order by queued_at
     limit 200
     for update skip locked
  ), upd as (
    update public.ml_reprice_pending p
       set dispatched_at = now()
      from picked
     where p.product_id = picked.product_id
    returning p.product_id
  )
  select array_agg(product_id) into v_ids from upd;

  if v_ids is null then
    return;
  end if;

  perform net.http_post(
    url := 'https://bwjptocnkqedakdibosu.supabase.co/functions/v1/ml-reprice-active',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_token),
    body := jsonb_build_object('product_ids', to_jsonb(v_ids), 'source', 'cost_change'),
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function public.ml_reprice_cost_tick() from public, anon, authenticated;
revoke all on function public.trg_products_ml_reprice_on_cost() from public, anon, authenticated;
grant execute on function public.ml_reprice_cost_tick() to service_role;

select cron.schedule('ml-reprice-cost-change', '*/5 * * * *', 'select public.ml_reprice_cost_tick();');
