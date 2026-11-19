-- 19/11/2026 — restore_abandoned_cart: los productos que ya no se venden se contaban en
-- "descartados" pero TAMBIÉN entraban como null en items (jsonb_agg no saltea nulls), y
-- la página de recuperación hacía addItem(null). Ahora items sólo trae los válidos.
do $$
declare v_def text := pg_get_functiondef('public.restore_abandoned_cart'::regproc);
begin
  v_def := replace(v_def,
    'coalesce(jsonb_agg(x), ''[]''::jsonb), count(*) filter (where x is null)',
    'coalesce(jsonb_agg(x) filter (where x is not null), ''[]''::jsonb), count(*) filter (where x is null)');
  if position('filter (where x is not null)' in v_def) = 0 then
    raise exception 'patrón no encontrado en restore_abandoned_cart';
  end if;
  execute v_def;
end $$;
