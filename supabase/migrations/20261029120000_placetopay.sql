-- Placetopay / Getnet Uruguay: pago con tarjeta (29/10/2026).
--
-- Flujo: el checkout crea la orden con place_cdr_order (misma regla de precio,
-- envío, cupón y factura que transferencia) con payment_method = 'placetopay';
-- después la edge function placetopay-create-session le pide a Placetopay una
-- sesión de pago por el total en pesos (total_original, dólar BROU, igual que
-- MercadoPago) y manda al cliente a pagar.
--
-- El resultado llega por tres caminos, todos idempotentes y todos re-consultando
-- la sesión a Placetopay (nunca se confía en lo que dice el aviso):
--   * placetopay-webhook   (el aviso de Placetopay: se manda UNA sola vez)
--   * placetopay-status    (la página de gracias, cuando vuelve el cliente)
--   * placetopay-reconcile (cron cada 10 min, sólo si hay sesiones pendientes)
--
-- Interruptor app_settings.placetopay_mode: 'off' | 'admins' | 'all'.
-- Con 'admins' sólo un administrador ve y puede usar el medio de pago (pruebas
-- en la tienda real sin que lo vea ningún cliente).

-- 1) Medio de pago nuevo -------------------------------------------------------
alter table public.orders drop constraint orders_payment_method_check;
alter table public.orders add constraint orders_payment_method_check
  check (payment_method is null
         or payment_method = any (array['mercadopago','transfer','deposit','hybrid','placetopay']));

-- 2) Sesiones de pago ----------------------------------------------------------
create table public.placetopay_sessions (
  id                  bigserial primary key,
  order_id            bigint not null references public.orders(id) on delete cascade,
  request_id          bigint not null unique,           -- id de la sesión en Placetopay
  reference           text   not null,                  -- la que mandamos (RF-<orden>)
  process_url         text,
  currency            text   not null,
  amount              numeric(14,2) not null,           -- lo que se pidió cobrar
  expires_at          timestamptz,
  status              text   not null default 'PENDING', -- estado de la SESIÓN
  reason              text,
  message             text,
  status_date         timestamptz,
  -- Datos de la transacción aprobada (o de la última intentada).
  internal_reference  bigint,                            -- hace falta para reembolsar
  authorization_code  text,
  receipt             text,
  franchise           text,
  payment_method_name text,
  issuer_name         text,
  last_digits         text,
  paid_amount         numeric(14,2),
  paid_currency       text,
  amount_mismatch     boolean not null default false,    -- cobró algo distinto a lo pedido
  refunded            boolean not null default false,
  refund_status       text,
  refund_message      text,
  refunded_at         timestamptz,
  raw                 jsonb,                             -- última respuesta de Placetopay
  last_checked_at     timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index placetopay_sessions_order_idx on public.placetopay_sessions(order_id);
create index placetopay_sessions_pending_idx on public.placetopay_sessions(created_at)
  where status = 'PENDING';

-- Sólo el servidor escribe (service_role saltea RLS). El admin la puede LEER
-- para ver el pago en el detalle de la orden. El cliente no la ve: consulta su
-- estado por la edge function placetopay-status.
alter table public.placetopay_sessions enable row level security;
create policy placetopay_sessions_admin_read on public.placetopay_sessions
  for select to authenticated using (public.is_admin());
revoke all on public.placetopay_sessions from anon;
revoke insert, update, delete on public.placetopay_sessions from authenticated;

-- 3) Interruptor (arranca APAGADO) ---------------------------------------------
insert into public.app_settings(key, value)
values ('placetopay_mode', '"off"'::jsonb)
on conflict (key) do nothing;

-- 4) place_cdr_order acepta 'placetopay' --------------------------------------
-- Se cambia SÓLO la validación del método: el resto de la función queda
-- idéntico (precio, envío, cupón, factura). Si el texto no está, la migración
-- falla en vez de dejar la función a medias.
do $mig$
declare
  v_def text;
  v_old text := $o$  if p_payment_method not in ('mercadopago', 'transfer', 'deposit', 'hybrid') then
    raise exception 'Método de pago inválido'; end if;$o$;
  v_new text := $n$  if p_payment_method not in ('mercadopago', 'transfer', 'deposit', 'hybrid', 'placetopay') then
    raise exception 'Método de pago inválido'; end if;
  -- Tarjeta por Placetopay: sólo si el interruptor lo permite (y con 'admins',
  -- sólo para administradores). Lo mismo se vuelve a chequear al crear la sesión.
  if p_payment_method = 'placetopay' then
    if coalesce((select value #>> '{}' from app_settings where key = 'placetopay_mode'), 'off') = 'all' then
      null;
    elsif coalesce((select value #>> '{}' from app_settings where key = 'placetopay_mode'), 'off') = 'admins'
          and public.is_admin() then
      null;
    else
      raise exception 'El pago con tarjeta no está disponible por el momento';
    end if;
  end if;$n$;
begin
  select pg_get_functiondef('public.place_cdr_order(jsonb,numeric,jsonb,text,text,text,text,numeric,text,jsonb,jsonb)'::regprocedure)
    into v_def;
  if position(v_old in v_def) = 0 then
    raise exception 'place_cdr_order cambió: no se encontró la validación del método de pago';
  end if;
  execute replace(v_def, v_old, v_new);
end
$mig$;

-- 5) Marcar pagada (atómico e idempotente) -------------------------------------
-- Devuelve si la orden CAMBIÓ a pagada en esta llamada (para mandar el mail una
-- sola vez), si llegó tarde (la orden ya había vencido o se había rechazado) y
-- los faltantes de stock.
create or replace function public.ptp_mark_order_paid(p_order_id bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_prev_status text;
  v_method      text;
  v_pstatus     text;
  v_late        boolean;
  v_stock       jsonb;
begin
  select status, payment_method, payment_status
    into v_prev_status, v_method, v_pstatus
    from orders where id = p_order_id for update;
  if not found then raise exception 'Orden no encontrada'; end if;
  if v_method is distinct from 'placetopay' then
    raise exception 'La orden % no es de Placetopay', p_order_id;
  end if;
  -- Ya paga, o pagada y después reembolsada: no se vuelve a tocar.
  if v_pstatus in ('paid', 'refunded') then
    return jsonb_build_object('changed', false, 'late', false, 'faltantes', '[]'::jsonb);
  end if;

  -- Si la orden ya había vencido/rechazado (pago en revisión que se aprobó tarde),
  -- la plata igual entró: se concreta y se avisa al admin. (El cupón, si tenía,
  -- ya se había devuelto al vencer y no se vuelve a contar.)
  v_late := v_prev_status in ('expirado', 'rechazado', 'cancelado');

  update orders
     set payment_status = 'paid',
         status         = 'Concretado',
         paid_at        = now(),
         stock_returned = false
   where id = p_order_id;

  v_stock := public.take_order_stock(p_order_id);

  return jsonb_build_object(
    'changed', true,
    'late', v_late,
    'previous_status', v_prev_status,
    'faltantes', coalesce(v_stock->'faltantes', '[]'::jsonb));
end;
$function$;
revoke all on function public.ptp_mark_order_paid(bigint) from public, anon, authenticated;
grant execute on function public.ptp_mark_order_paid(bigint) to service_role;

-- 6) Cron: revisar sesiones pendientes ------------------------------------------
-- El aviso de Placetopay NO se reintenta; si se pierde, esto lo rescata. Sólo
-- despierta la edge function si hay algo pendiente (no gastar pg_net en vacío).
create or replace function public.placetopay_reconcile_tick()
returns void
language plpgsql
security definer
set search_path to 'public', 'vault', 'net'
as $function$
declare
  v_token text;
begin
  if not exists (
    select 1 from placetopay_sessions
     where status = 'PENDING'
       and created_at > now() - interval '3 days'
  ) then
    return;
  end if;

  select decrypted_secret into v_token
    from vault.decrypted_secrets where name = 'cdr_sync_jwt' limit 1;
  if v_token is null or v_token = '' then
    raise notice 'cdr_sync_jwt no está en Vault — skip';
    return;
  end if;

  perform net.http_post(
    url := 'https://bwjptocnkqedakdibosu.supabase.co/functions/v1/placetopay-reconcile',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_token,
      'apikey', v_token),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000);
end;
$function$;
revoke all on function public.placetopay_reconcile_tick() from public, anon, authenticated;

select cron.schedule('placetopay-reconcile', '*/10 * * * *', $$ select public.placetopay_reconcile_tick(); $$);
