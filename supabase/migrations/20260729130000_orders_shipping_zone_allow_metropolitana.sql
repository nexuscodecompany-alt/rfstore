-- ---------------------------------------------------------------------------
-- HOTFIX PRODUCCIÓN 2026-07-29 — checkout roto para la zona metropolitana.
--
-- Cuando se agregó la tercera zona de envío (montevideo / metropolitana /
-- interior) se actualizó el front y las edge functions, pero NO esta
-- restricción de la tabla orders, que seguía aceptando sólo dos valores:
--   CHECK (shipping_zone = ANY (ARRAY['montevideo', 'interior']))
--
-- Resultado: todo cliente que elegía "zona metropolitana" (Canelones cercano /
-- agencia) moría al crear la orden con
--   new row for relation "orders" violates check constraint "orders_shipping_zone_check"
-- tanto por Mercado Pago (mp-create-preference) como por transferencia/depósito
-- (place_cdr_order). Venta perdida, sin llegar nunca a la pasarela.
--
-- Aplicado a producción vía MCP el 2026-07-29.
-- ---------------------------------------------------------------------------

alter table public.orders drop constraint if exists orders_shipping_zone_check;

-- NULL sigue siendo válido (órdenes de Mercado Libre y ventas manuales no
-- tienen zona): en un CHECK, NULL evalúa a desconocido y no lo viola.
alter table public.orders
	add constraint orders_shipping_zone_check
	check (shipping_zone = any (array['montevideo'::text, 'metropolitana'::text, 'interior'::text]))
	not valid;

alter table public.orders validate constraint orders_shipping_zone_check;
