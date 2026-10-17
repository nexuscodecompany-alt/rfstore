-- Marcar un producto como STOCK PROPIO (Origen del stock = Propio, o el candado de stock
-- del modal "Pausar sync de CDR") cambia el umbral de pausa en ML: con candado se vende
-- hasta la ultima unidad (umbral 0), sin candado rige ml_stock_threshold (2).
--
-- Problema: el aviso a ML (trg_variant_stock_to_ml) solo sale cuando cambia el NUMERO de
-- stock. Si el admin marcaba "Propio" sin tocar la cantidad -- p.ej. tenia 2 unidades y la
-- publicacion estaba pausada por el colchon -- ML no se enteraba y la publicacion seguia
-- pausada hasta el proximo movimiento de stock. Lo mismo al revés: sacar el candado con
-- stock <= 2 no la pausaba.
--
-- Fix: cuando cambia products.stock_locked se encola un update_stock para cada variante
-- publicada (mismo patron idempotente que trg_variant_stock_to_ml). El procesador relee el
-- stock y el candado al ejecutar, asi que decide con el umbral nuevo.

create or replace function public.trg_products_stock_lock_to_ml()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.stock_locked is not distinct from old.stock_locked then
    return null;
  end if;

  insert into ml_sync_queue (operation, product_id, variant_id, status, scheduled_for, payload)
  select 'update_stock', v.product_id, v.id, 'pending', now(),
         jsonb_build_object('new_stock', v.stock, 'source', 'stock_lock_change',
                            'stock_locked', new.stock_locked)
    from variants v
   where v.product_id = new.id
     and exists (select 1 from ml_item_mapping m
                  where m.variant_id = v.id and m.status in ('active', 'paused'))
     and not exists (select 1 from ml_sync_queue q
                      where q.variant_id = v.id and q.operation = 'update_stock'
                        and q.status = 'pending');

  update ml_sync_queue q
     set scheduled_for = now(),
         payload = q.payload || jsonb_build_object('source', 'stock_lock_change',
                                                   'stock_locked', new.stock_locked)
    from variants v
   where v.product_id = new.id
     and q.variant_id = v.id and q.operation = 'update_stock' and q.status = 'pending';

  return null;
end;
$$;

-- Solo la usa el trigger: nadie tiene por que poder llamarla por la API.
revoke all on function public.trg_products_stock_lock_to_ml() from public, anon, authenticated;

-- OJO: NO usar "after update OF stock_locked". Ese tipo de trigger solo salta si la columna
-- figura en el SET del UPDATE, y al elegir "Propio" en el form el candado no lo pone el
-- UPDATE sino el trigger BEFORE products_fulfillment_locks -> no saltaba nunca (probado).
-- Con WHEN sobre old/new se compara el valor final de la fila, venga de donde venga.
drop trigger if exists products_stock_lock_to_ml on public.products;
create trigger products_stock_lock_to_ml
  after update on public.products
  for each row
  when (new.stock_locked is distinct from old.stock_locked)
  execute function public.trg_products_stock_lock_to_ml();
