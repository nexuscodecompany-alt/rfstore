-- "% listo para publicar en Mercado Libre" REAL (ML-aware) por producto.
-- Se calcula en la edge function ml-readiness (predice la categoría en ML + consulta
-- los atributos obligatorios de esa categoría) y se GUARDA acá. Permite mostrar y
-- filtrar el listado del admin por % real (ml_ready_percent), con paginación correcta.
-- El recálculo es MANUAL (botón en el panel) — no hay cron ni triggers.
alter table public.products
  add column if not exists ml_ready_percent integer,
  add column if not exists ml_ready_missing jsonb not null default '[]'::jsonb,
  add column if not exists ml_ready_checked_at timestamptz;

-- Cache de atributos obligatorios por categoría ML (evita pegarle a ML por cada producto).
create table if not exists public.ml_category_attrs_cache (
  category_id text primary key,
  required jsonb not null default '[]'::jsonb,
  all_ids   jsonb not null default '[]'::jsonb,
  cached_at timestamptz not null default now()
);
alter table public.ml_category_attrs_cache enable row level security;
