-- Recuperar contraseña con un código por mail (29/10/2026).
--
-- No usa el mail de Supabase Auth: el código lo genera y lo manda la edge
-- function password-reset por Resend (el mismo proveedor de los mails de
-- pedidos), y la contraseña se cambia con la API admin de Auth.
--
-- Seguridad: el código se guarda HASHEADO (nunca en claro), vence a los 15
-- minutos, admite 5 intentos, es de un solo uso, y pedir uno nuevo anula los
-- anteriores. Límites de pedidos por mail y por IP en la edge function.

create table public.password_reset_codes (
  id          bigserial primary key,
  email       text not null,                 -- normalizado (minúsculas, sin espacios)
  user_id     uuid,                          -- null si el mail no existe (igual se registra el pedido para el límite)
  code_hash   text,                          -- null si el mail no existe
  ip          text,
  attempts    int  not null default 0,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index password_reset_codes_email_idx on public.password_reset_codes(email, created_at desc);
create index password_reset_codes_ip_idx on public.password_reset_codes(ip, created_at desc);

-- Sólo el servidor (service_role) la toca.
alter table public.password_reset_codes enable row level security;
revoke all on public.password_reset_codes from anon, authenticated;

-- Buscar el usuario de Auth por mail (la API admin no tiene búsqueda directa).
create or replace function public.auth_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path to 'public', 'auth'
as $function$
  select id from auth.users
   where lower(email) = lower(trim(p_email))
     and deleted_at is null
   limit 1;
$function$;
revoke all on function public.auth_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.auth_user_id_by_email(text) to service_role;

-- Limpieza: los pedidos de más de 7 días no sirven ni para el límite.
select cron.schedule('password-reset-codes-cleanup', '17 4 * * *',
  $$ delete from public.password_reset_codes where created_at < now() - interval '7 days'; $$);
