-- Precios del carrito según el SERVIDOR (27/10/2026).
--
-- El carrito vive en el navegador (localStorage) con el precio del momento en
-- que se agregó cada producto. Si después cambia el costo de CDR o el dólar, el
-- checkout mostraba un total y el servidor cobraba otro; y con envío gratis
-- desde USD 150 eso también podía mostrar "Gratis" y cobrar el envío.
-- El checkout llama a esta función al entrar y actualiza el carrito con el
-- MISMO precio que usan place_cdr_order y mp-create-preference.

create or replace function public.get_cart_prices(p_variant_ids uuid[])
returns table(variant_id uuid, price numeric, stock int)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select v.id,
         public.rf_sale_price(
           case when p.source = 'cdr' then coalesce(p.price_usd, 0)
                else coalesce(v.price, 0) end,
           p.margin_override_percent),
         v.stock
    from variants v
    join products p on p.id = v.product_id
   where v.id = any(p_variant_ids[1:100]);
$function$;

-- Datos públicos del catálogo (precio y stock que ya muestra la tienda):
-- la llama el checkout con o sin sesión. Sólo lectura.
revoke all on function public.get_cart_prices(uuid[]) from public;
grant execute on function public.get_cart_prices(uuid[]) to anon, authenticated, service_role;
