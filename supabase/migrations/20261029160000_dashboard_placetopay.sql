-- Dashboard: las ventas con tarjeta por Getnet (payment_method 'placetopay') van
-- en su propia fila del desglose por medio de pago (antes caían en 'otro').
-- Se cambia SÓLO esa línea del CASE; si no se encuentra, la migración falla.
do $mig$
declare
  v_def text;
  v_old text := $o$when payment_method='deposit' then 'deposit' else 'otro' end$o$;
  v_new text := $n$when payment_method='deposit' then 'deposit' when payment_method='placetopay' then 'placetopay' else 'otro' end$n$;
begin
  select pg_get_functiondef('public.dashboard_overview(timestamptz,timestamptz)'::regprocedure) into v_def;
  if position(v_old in v_def) = 0 then
    raise exception 'dashboard_overview cambió: no se encontró el CASE de medios de pago';
  end if;
  execute replace(v_def, v_old, v_new);
end
$mig$;
