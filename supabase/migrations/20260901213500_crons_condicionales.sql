-- Los jobs 13 (cada minuto), 15 (*/5) y 17 (*/10) hacian net.http_post SIEMPRE, aunque
-- no hubiera trabajo: ~1.870 invocaciones diarias de edge functions en vacio, cada una
-- con su insert en la cola de pg_net + fila de respuesta + el borrado posterior.
--
-- Ahora chequean primero. NO se cambio la frecuencia de ningun job: si hay trabajo,
-- disparan con la misma latencia de antes. Las condiciones son las que usa cada edge
-- function, o mas amplias, para no perder trabajo nunca.
-- pg_net: 91 -> ~13 requests/hora. Los tres chequeos son Index Only Scan (0,08-0,16 ms).

-- Job 13 -> ml-process-sync-queue. Condicion de ml-process-sync-queue/index.ts:292,
-- sin el filtro de `operation` (mas amplia).
select cron.alter_job(13, command := $cmd$
select case when exists (
         select 1 from public.ml_sync_queue
          where status = 'pending' and scheduled_for <= now()
       )
       then net.http_post(
         url := 'https://bwjptocnkqedakdibosu.supabase.co/functions/v1/ml-process-sync-queue',
         headers := jsonb_build_object('Content-Type','application/json')
       )
       end;
$cmd$);

-- Job 15 -> ml-webhook { reprocess }. Condicion de reprocessErrors() (ml-webhook/index.ts:330),
-- sin el filtro de `topic`. OJO: es `<> 'done'`, o sea incluye los 'error', no solo 'pending'.
-- Se apoya en idx_ml_webhook_no_done.
select cron.alter_job(15, command := $cmd$
select case when exists (
         select 1 from public.ml_webhook_events
          where processing_status <> 'done'
            and received_at >= now() - interval '72 hours'
       )
       then net.http_post(
         url := 'https://bwjptocnkqedakdibosu.supabase.co/functions/v1/ml-webhook',
         headers := jsonb_build_object('Content-Type','application/json'),
         body := jsonb_build_object('reprocess', true)
       )
       end;
$cmd$);

-- Job 17 -> ml-webhook { backfill_fees }. Condicion exacta de backfillFees()
-- (ml-webhook/index.ts:277-279).
select cron.alter_job(17, command := $cmd$
select case when exists (
         select 1 from public.orders
          where channel = 'ml' and ml_order_id is not null
            and (ml_commission_usd is null or ml_commission_usd = 0)
       )
       then net.http_post(
         url := 'https://bwjptocnkqedakdibosu.supabase.co/functions/v1/ml-webhook',
         headers := jsonb_build_object('Content-Type','application/json'),
         body := jsonb_build_object('backfill_fees', true, 'max', 20)
       )
       end;
$cmd$);
