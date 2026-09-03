-- El cron de reproceso (job 15) pregunta por `processing_status <> 'done'`, que el
-- indice parcial existente (solo 'pending') no cubre -> seq scan de 11.377 filas con
-- payload jsonb cada 5 minutos. Este indice parcial cubre exactamente esa condicion
-- y pesa nada: hoy son 126 filas. Chequeo resultante: Index Only Scan, 0,08 ms.
create index if not exists idx_ml_webhook_no_done
  on public.ml_webhook_events (received_at)
  where processing_status <> 'done';
