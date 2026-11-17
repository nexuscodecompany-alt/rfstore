-- ML: el precio de Mercado Libre es ESPEJO del sistema (17/11/2026).
--
-- Problema: el precio solo se empujaba a ML cuando cambiaba el costo, el dolar o el margen,
-- y se comparaba contra nuestro propio espejo (ml_item_mapping.last_known_price_uyu), nunca
-- contra ML. Dos agujeros:
--   1. Si alguien cambiaba el precio DESDE ML (ej. aceptar "PRECIO ALTO" / competir en
--      catalogo), quedaba asi para siempre. Caso real: Suunto Race 2 vendido a USD 478 en vez
--      de 511 (06/11).
--   2. Si el reprecio por costo caia mientras la publicacion estaba under_review, el
--      procesador la salteaba (skipped_moderated) y NUNCA se reintentaba: al volver a activa
--      quedaba con el precio viejo (DVR62 vendiendo a 96 cuando corresponde 117, a perdida).
--
-- Solucion: edge function ml-price-reconcile, que compara el precio REAL de ML contra el que
-- corresponde (misma formula que ml-reprice-active) y encola la correccion.
--   * Tiempo real: ML ya nos manda el aviso `items_prices` cada vez que cambia un precio. Un
--     trigger sobre ml_webhook_events anota la publicacion en ml_price_check y el cron de
--     cada minuto la revisa (sin tocar ml-webhook).
--   * Red de seguridad: barrido completo cada 15 min (cubre las que estaban en revision,
--     cambios de tramos, avisos perdidos).

create table if not exists public.ml_price_check (
  ml_item_id   text primary key,
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  source       text
);
alter table public.ml_price_check enable row level security;
revoke all on public.ml_price_check from anon, authenticated;

create table if not exists public.ml_price_reconcile_runs (
  id          bigserial primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  mode        text,
  checked     int,
  in_sync     int,
  drift       int,
  enqueued    int,
  blocked     int,
  capped      int,
  errors      int,
  details     jsonb
);
alter table public.ml_price_reconcile_runs enable row level security;
revoke all on public.ml_price_reconcile_runs from anon, authenticated;
create index if not exists ml_price_reconcile_runs_started_idx on public.ml_price_reconcile_runs (started_at desc);

-- Aviso de ML de cambio de precio -> anotar para revisar.
create or replace function public.trg_ml_webhook_price_check()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_item text;
begin
  if new.topic is distinct from 'items_prices' or new.resource is null then
    return null;
  end if;
  v_item := substring(new.resource from '/items/(MLU[0-9]+)');
  if v_item is null then
    return null;
  end if;
  insert into public.ml_price_check (ml_item_id, requested_at, processed_at, source)
  values (v_item, now(), null, 'webhook')
  on conflict (ml_item_id) do update
    set requested_at = now(), processed_at = null, source = 'webhook';
  return null;
end;
$$;

drop trigger if exists ml_webhook_price_check on public.ml_webhook_events;
create trigger ml_webhook_price_check
  after insert on public.ml_webhook_events
  for each row execute function public.trg_ml_webhook_price_check();

-- Cada minuto: si hay avisos sin revisar, despierta la funcion (si no, no hace nada).
create or replace function public.ml_price_check_tick()
returns void
language plpgsql
security definer
set search_path to 'public', 'vault', 'net'
as $$
declare
  v_token text;
begin
  if not exists (select 1 from public.ml_price_check where processed_at is null) then
    return;
  end if;
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'cdr_sync_jwt' limit 1;
  if v_token is null or v_token = '' then
    raise notice 'cdr_sync_jwt no esta en Vault - ml-price-reconcile no se invoca';
    return;
  end if;
  perform net.http_post(
    url := 'https://bwjptocnkqedakdibosu.supabase.co/functions/v1/ml-price-reconcile',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_token),
    body := jsonb_build_object('mode', 'pending'),
    timeout_milliseconds := 60000
  );
end;
$$;

-- Cada 15 min: barrido completo contra ML.
create or replace function public.ml_price_reconcile_tick()
returns void
language plpgsql
security definer
set search_path to 'public', 'vault', 'net'
as $$
declare
  v_token text;
begin
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'cdr_sync_jwt' limit 1;
  if v_token is null or v_token = '' then
    raise notice 'cdr_sync_jwt no esta en Vault - ml-price-reconcile no se invoca';
    return;
  end if;
  perform net.http_post(
    url := 'https://bwjptocnkqedakdibosu.supabase.co/functions/v1/ml-price-reconcile',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_token),
    body := jsonb_build_object('mode', 'full'),
    timeout_milliseconds := 120000
  );
end;
$$;

revoke all on function public.trg_ml_webhook_price_check() from public, anon, authenticated;
revoke all on function public.ml_price_check_tick() from public, anon, authenticated;
revoke all on function public.ml_price_reconcile_tick() from public, anon, authenticated;
grant execute on function public.ml_price_check_tick() to service_role;
grant execute on function public.ml_price_reconcile_tick() to service_role;

-- Los crons se crean DESPUES de deployar la edge function:
-- select cron.schedule('ml-price-check', '* * * * *', 'select public.ml_price_check_tick();');
-- select cron.schedule('ml-price-reconcile', '*/15 * * * *', 'select public.ml_price_reconcile_tick();');
