-- ML: repreciar por DOLAR las publicaciones en pesos (07/10/2026).
--
-- Las publicaciones con costo <= usd_threshold se venden en UYU = costo x margen x IVA x
-- dolar BROU. ml_reprice_cost_tick solo reacciona a cambios de costo, asi que si el dolar
-- subia quedaban baratas. Este cron llama a ml-reprice-active con only_currency='UYU' y
-- min_change_pct=1: solo encola las que se movieron 1% o mas contra el ultimo precio
-- empujado (sin tolerancia, cada centesimo re-editaria ~140 publicaciones en ML).
-- Dias habiles 10:30 a 18:30 UY cada 2 h (el BROU mueve la cotizacion en horario bancario).

create or replace function public.ml_reprice_fx_tick()
returns void
language plpgsql
security definer
set search_path to 'public', 'vault', 'net'
as $$
declare
  v_token text;
begin
  select decrypted_secret into v_token
  from vault.decrypted_secrets where name = 'cdr_sync_jwt' limit 1;
  if v_token is null or v_token = '' then
    raise notice 'cdr_sync_jwt no esta en Vault - ml-reprice-active no se invoca';
    return;
  end if;

  perform net.http_post(
    url := 'https://bwjptocnkqedakdibosu.supabase.co/functions/v1/ml-reprice-active',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_token),
    body := jsonb_build_object('only_currency', 'UYU', 'min_change_pct', 1, 'source', 'fx_change'),
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function public.ml_reprice_fx_tick() from public, anon, authenticated;
grant execute on function public.ml_reprice_fx_tick() to service_role;

select cron.schedule('ml-reprice-fx', '30 13-21/2 * * 1-5', 'select public.ml_reprice_fx_tick();');
