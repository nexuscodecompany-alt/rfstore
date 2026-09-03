-- Disk IO: las dos tablas de "churn" (net._http_response de pg_net y el historial de
-- pg_cron) se inflaban sin control: 221 MB de una base de 295 MB, dejando fuera del
-- cache (shared_buffers = 224 MB) a los datos reales.
--
-- Se recuperaron a mano con:
--   VACUUM (FULL, ANALYZE) net._http_response;      -- 158 MB -> 680 kB
--   delete from cron.job_run_details where start_time < now() - interval '7 days';
--   VACUUM (FULL, ANALYZE) cron.job_run_details;    -- 63 MB -> 4,5 MB
--   REINDEX INDEX public.idx_ml_webhook_pending;    -- leia 445 buffers para 0 filas
-- Base total: 295 MB -> 79 MB.
--
-- OJO: net._http_response es de supabase_admin, asi que NO acepta
-- ALTER TABLE ... SET (autovacuum_*) ("must be owner"), pero SI se puede vacuumear.
-- Por eso el mantenimiento va por cron (jobs 24/25/26) y no por autovacuum tuneado.

create or replace function public.purge_maintenance_tick()
returns text
language plpgsql
security definer
set search_path = public, cron, pg_temp
as $$
declare
  borradas integer;
begin
  delete from cron.job_run_details where start_time < now() - interval '7 days';
  get diagnostics borradas = row_count;
  return format('cron.job_run_details: %s filas purgadas', borradas);
end;
$$;

-- Regla del proyecto: toda funcion nueva define quien la llama.
revoke all on function public.purge_maintenance_tick() from public, anon, authenticated;
grant execute on function public.purge_maintenance_tick() to service_role;

-- select cron.schedule('purge-cron-history',  '10 4 * * *', 'select public.purge_maintenance_tick();');  -- jobid 24
-- select cron.schedule('vacuum-pgnet',        '20 4 * * *', 'VACUUM (ANALYZE) net._http_response;');     -- jobid 25
-- select cron.schedule('vacuum-cron-history', '25 4 * * *', 'VACUUM (ANALYZE) cron.job_run_details;');   -- jobid 26
