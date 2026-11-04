-- Facturación electrónica con Fixed (04/11/2026). Guía: docs/fixed-integracion.md
--
-- La emisión es MANUAL: el admin toca "Facturar" en la orden (web, Mercado Libre
-- o manual) y la edge function fixed-invoice arma la venta y la manda a Fixed.
-- Acá sólo vive el registro de cada comprobante; la lógica está en
-- supabase/functions/_shared/fixed.ts.

-- 1) Comprobantes ---------------------------------------------------------------
-- Una fila por CFE: la venta (e-Ticket 101 / e-Factura 111) o su nota de crédito
-- (102 / 112). Cada intento de emisión tiene su idempotency_key y el JSON exacto
-- que se mandó: si la red se corta, el reintento reenvía ESE JSON con ESA clave
-- y Fixed devuelve el resultado original en vez de facturar dos veces.
create table if not exists public.invoices (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id),
  -- Órdenes que cubre el comprobante: una sola, salvo un carrito de Mercado
  -- Libre (pack), que se factura junto.
  order_ids bigint[] not null,
  kind text not null default 'venta' check (kind in ('venta', 'nota_credito')),
  parent_invoice_id bigint references public.invoices(id),
  environment text not null check (environment in ('testing', 'produccion')),
  -- enviando: se mandó y todavía no hay respuesta (o se cortó la red)
  -- emitida: Fixed la emitió, DGI todavía no respondió
  -- aceptada / rechazada: respuesta de DGI
  -- error: Fixed la rechazó, NO se emitió (se puede volver a intentar)
  -- anulada: venta con nota de crédito emitida
  status text not null check (status in ('enviando', 'emitida', 'aceptada', 'rechazada', 'error', 'anulada')),
  idempotency_key uuid not null unique,
  request_json jsonb not null,
  attempts int not null default 0,
  last_error_code text,
  last_error_desc text,
  -- Respuesta de Fixed
  id_cfe text,
  id_venta text,
  tipo_cfe int,
  serie text,
  numero int,
  comprobante text,
  moneda text not null,
  total numeric not null,
  cotizacion numeric,
  url_a4 text,
  url_ticket text,
  url_verificar text,
  estado_dgi text,
  motivo_rechazo_dgi text,
  dgi_checked_at timestamptz,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists invoices_order_id_idx on public.invoices(order_id);
create index if not exists invoices_order_ids_gin on public.invoices using gin(order_ids);
create index if not exists invoices_pending_idx on public.invoices(status) where status in ('enviando', 'emitida');

-- Una sola venta viva por orden: no se puede facturar dos veces lo mismo. Una
-- venta con error, rechazada por DGI o anulada no cuenta (se puede refacturar).
create unique index if not exists invoices_one_live_sale_per_order
  on public.invoices(order_id)
  where kind = 'venta' and status in ('enviando', 'emitida', 'aceptada');

alter table public.invoices enable row level security;
drop policy if exists invoices_admin_read on public.invoices;
create policy invoices_admin_read on public.invoices for select to authenticated using (public.is_admin());
-- Sin políticas de escritura: sólo escribe la edge function (service_role).
revoke all on public.invoices from anon;
grant select on public.invoices to authenticated;

-- 2) Cédula del comprador --------------------------------------------------------
-- DGI exige documento y domicilio en ventas de más de 5000 UI. El checkout la
-- pide en esas compras y la guarda en la ficha del cliente (la ficha es del
-- propio cliente por RLS, igual que nombre/teléfono).
alter table public.customers add column if not exists document_ci text;

-- 3) Configuración (lectura pública: NADA secreto acá; las claves de Fixed son
-- secrets de las edge functions) ------------------------------------------------
insert into public.app_settings(key, value)
values ('invoice_config', jsonb_build_object(
  'enabled', false,             -- interruptor general del botón "Facturar"
  'local_id', '',               -- id del local en Fixed (vacío = el único que haya)
  'rubro_mode', 'category',     -- 'category' = la categoría del producto; 'fixed' = default_rubro
  'default_rubro', 'Varios',
  'shipping_rubro', 'Envíos',
  'ui_value_uyu', 6.3,          -- valor de la Unidad Indexada (actualizar cada tanto)
  'id_required_above_ui', 5000  -- desde cuántas UI DGI exige documento y domicilio
))
on conflict (key) do nothing;

-- 4) Cron: seguir el estado en DGI ----------------------------------------------
-- DGI responde en diferido. Cada 10 min se consultan los comprobantes emitidos
-- sin respuesta y se reintentan los que quedaron "enviando" por un corte. Sólo
-- despierta la edge function si hay algo pendiente.
create or replace function public.fixed_invoice_sync_tick()
returns void
language plpgsql
security definer
set search_path to 'public', 'vault', 'net'
as $function$
declare
  v_token text;
begin
  if not exists (
    select 1 from invoices
     where status in ('enviando', 'emitida')
       and created_at > now() - interval '15 days'
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
    url := 'https://bwjptocnkqedakdibosu.supabase.co/functions/v1/fixed-invoice-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_token,
      'apikey', v_token),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
end;
$function$;
revoke all on function public.fixed_invoice_sync_tick() from public, anon, authenticated;

select cron.schedule('fixed-invoice-sync', '*/10 * * * *', $$ select public.fixed_invoice_sync_tick(); $$);
