-- CDR / doc v2.0 - Fase 2 (crons).
--
-- Hasta ahora: update-prices cada 10 min + new-only cada hora, y CADA corrida pedia
-- el catalogo completo => 168 catalogos de 4 MB por dia (~672 MB). El 03/09/2026,
-- probando, el WS respondio "MAXIMOS DE ACCESOS POR HORA SOBREPASADOS": CDR tiene un
-- limite horario REAL, no solo la advertencia de la doc. Es casi seguro la causa de
-- las corridas con fetched=0 y de los 1-2 fallos diarios que se leian como
-- "mantenimiento de medianoche de CDR".
--
-- Nueva cadencia:
--   - update-prices INCREMENTAL cada 15 min  -> 4 llamadas/hora (antes 6)
--   - new-only      INCREMENTAL cada hora    -> 1 llamada/hora
--   - full feed (reconciliacion) 2 veces/dia -> 06:40 y 18:40 UTC = 03:40 y 15:40 UY
-- Total ~5 llamadas/hora livianas contra 7 pesadas. El stock no pierde frescura: CDR
-- manda cada cambio y solo cambian ~71 productos por dia.
--
-- El horario del full feed evita el bache de medianoche de Uruguay (03:00 UTC).

create or replace function public.cdr_sync_fullfeed_tick()
returns void
language plpgsql
security definer
set search_path to 'public', 'vault', 'net'
as $function$
declare
  v_enabled boolean;
  v_token   text;
  v_url     text := 'https://bwjptocnkqedakdibosu.supabase.co/functions/v1/cdr-sync-products';
begin
  select coalesce((value)::boolean, false) into v_enabled
  from app_settings where key = 'cdr_cron_enabled';

  if not coalesce(v_enabled, false) then
    raise notice 'cdr fullfeed tick skipped: disabled';
    return;
  end if;

  select decrypted_secret into v_token
  from vault.decrypted_secrets where name = 'cdr_sync_jwt' limit 1;

  if v_token is null or v_token = '' then
    raise notice 'cdr_sync_jwt no esta en Vault';
    return;
  end if;

  -- full_feed=true: pide el catalogo COMPLETO y habilita la reconciliacion por
  -- ausencia (p_reconcile). Es la unica corrida del dia que puede apagar stock de
  -- productos que CDR dejo de mandar.
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_token
    ),
    body := jsonb_build_object('mode', 'update-prices', 'full_feed', true, 'background', true),
    timeout_milliseconds := 30000
  );
end;
$function$;

revoke all on function public.cdr_sync_fullfeed_tick() from public;
revoke all on function public.cdr_sync_fullfeed_tick() from anon;
revoke all on function public.cdr_sync_fullfeed_tick() from authenticated;

comment on function public.cdr_sync_fullfeed_tick() is
  'Dispara el sync de CDR pidiendo el catalogo COMPLETO (full_feed=true), unica corrida que reconcilia por ausencia. 2 veces por dia. Ver docs/cdr/README.md.';

-- Cadencia (aplicado con cron.alter_job / cron.schedule):
--   select cron.alter_job(8, schedule := '*/15 * * * *');
--   select cron.schedule('cdr-sync-fullfeed', '40 6,18 * * *', 'select public.cdr_sync_fullfeed_tick();');
