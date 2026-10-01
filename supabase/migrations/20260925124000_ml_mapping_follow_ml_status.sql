-- 25/09/2026: el espejo (ml_item_mapping.status) se quedaba viejo cuando el DUEÑO pausaba o
-- reactivaba a mano desde ML (ACC50/ACC60: "activas" para RF, pausadas en ML desde agosto).
-- Y el flag auto_paused_stock se prendia sobre publicaciones que YA estaban pausadas por otro
-- (el dueño), que es la "bomba" del freeze de vacaciones: al volver el stock, el sync las
-- reactivaba por arriba de la pausa manual.
create or replace function public.ml_mapping_follow_ml_status()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  -- 1) Lo que ML reporta manda (lo escribe ml-stock-reconcile cada hora). Solo pausada<->activa;
  --    las moderadas/cerradas no se tocan: esas las maneja cada flujo aparte.
  if new.ml_verified_status is distinct from old.ml_verified_status
     and new.status in ('active', 'paused') then
    if new.ml_verified_status = 'paused' and new.status = 'active' then
      -- Pausada fuera de nuestro sistema (el dueño desde ML). NO es una pausa nuestra por
      -- stock: el flag queda como venia (false), asi el sync no la reactiva solo.
      new.status := 'paused';
    elsif new.ml_verified_status = 'active' and new.status = 'paused' then
      new.status := 'active';
      new.auto_paused_stock := false;
    end if;
  end if;

  -- 2) auto_paused_stock = "la pausamos NOSOTROS por stock". Si la publicacion ya estaba
  --    pausada antes de que la pusieramos en 0, la pausa es de otro y no se adueña.
  if new.auto_paused_stock and not coalesce(old.auto_paused_stock, false)
     and old.status = 'paused' then
    new.auto_paused_stock := false;
  end if;

  return new;
end;
$$;

revoke all on function public.ml_mapping_follow_ml_status() from public, anon, authenticated;

drop trigger if exists trg_ml_mapping_follow_ml_status on public.ml_item_mapping;
create trigger trg_ml_mapping_follow_ml_status
before update on public.ml_item_mapping
for each row execute function public.ml_mapping_follow_ml_status();

-- One-off: lo que ya estaba desalineado (el trigger solo actua cuando ML reporta un cambio).
update public.ml_item_mapping
   set status = 'paused'
 where status = 'active' and ml_verified_status = 'paused';

-- FIL98 (MLU694345253): pausada con 10 unidades en ML y el flag viejo prendido. Nosotros
-- pausamos siempre dejando la cantidad en 0 (o <= umbral): con 4-10 unidades la pausa no fue
-- nuestra. Sin el flag, el sync ya no la reactiva por arriba del dueño.
update public.ml_item_mapping
   set auto_paused_stock = false
 where auto_paused_stock and status = 'paused' and ml_verified_status = 'paused'
   and ml_verified_qty > 2;
