-- Costos/comisiones de Mercado Libre cargables a mano por orden (USD), para
-- calcular la ganancia real en el detalle de la orden. Aplicado a prod
-- 2026-06-16 vía MCP. Ganancia real = total - costo CDR - comisión - envío - otros.
alter table public.orders
  add column if not exists ml_commission_usd numeric not null default 0,
  add column if not exists ml_shipping_cost_usd numeric not null default 0,
  add column if not exists ml_other_costs_usd numeric not null default 0;
