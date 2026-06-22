-- ── Ventas manuales / externas con "conceptos" ──────────────────────────────
-- El admin registra ventas que hace por fuera de la web/ML (ej: le vende a la
-- empresa "Sunfer"). Crea un CONCEPTO y registra ventas manuales bajo él, con
-- precio de venta, costo y costos extra (envío). Se centralizan junto al resto.

create table if not exists public.sale_concepts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text,
  created_at timestamptz not null default now()
);

alter table public.sale_concepts enable row level security;

drop policy if exists sale_concepts_admin_all on public.sale_concepts;
create policy sale_concepts_admin_all on public.sale_concepts
  for all using (is_admin()) with check (is_admin());

-- Columnas para ventas manuales en orders (channel='manual').
alter table public.orders
  add column if not exists concept_id uuid references public.sale_concepts(id) on delete set null,
  add column if not exists manual_description text,
  add column if not exists manual_cost_usd numeric default 0,
  add column if not exists manual_extra_costs_usd numeric default 0;

create index if not exists orders_concept_id_idx on public.orders(concept_id);
create index if not exists orders_channel_idx on public.orders(channel);

-- Permitir el canal 'manual' (antes solo 'web' / 'ml').
alter table public.orders drop constraint if exists orders_channel_check;
alter table public.orders add constraint orders_channel_check
  check (channel = any (array['web'::text, 'ml'::text, 'manual'::text]));
