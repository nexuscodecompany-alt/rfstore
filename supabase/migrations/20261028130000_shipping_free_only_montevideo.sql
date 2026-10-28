-- Envío gratis desde USD 150 SÓLO en Montevideo (28/10/2026).
-- Canelones paga siempre su tarifa (USD 8). rf_shipping_quote ya lee la casilla
-- free_includes_canelones (panel /dashboard/envios); se apaga y se ajusta la política.

update app_settings
   set value = jsonb_set(value, '{free_includes_canelones}', 'false'::jsonb)
 where key = 'shipping_rates';

update app_settings
   set value = jsonb_set(
         value,
         '{envios,content}',
         to_jsonb(replace(value->'envios'->>'content',
           '- Envío gratis en compras desde USD 150.',
           '- Envío gratis en Montevideo en compras desde USD 150.')))
 where key = 'legal_pages';
