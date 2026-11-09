-- Aviso al cliente cuando se cancela su pedido (29/10/2026).
-- Lo manda la edge function send-order-cancelled; esta marca evita mandarlo
-- dos veces (cancelar, reactivar y volver a cancelar no repite el mail).
alter table public.orders add column if not exists cancel_notified_at timestamptz;
