-- Las ventas manuales pueden tener order_items (para descontar stock) pero su
-- costo/margen se cuenta vía manual_cost_usd/manual_extra_costs_usd. Para no
-- duplicar, se excluye channel='manual' de los subqueries genéricos basados en
-- order_items, y se cuenta el costo/margen manual aparte.
CREATE OR REPLACE FUNCTION public.dashboard_overview(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_prev_from timestamptz := p_from - (p_to - p_from);
  result jsonb;
begin
  select jsonb_build_object(
    'orders_in_period', (select count(*) from orders where created_at >= p_from and created_at <= p_to),
    'revenue_period', (select coalesce(sum(total_amount),0) from orders where created_at >= p_from and created_at <= p_to),
    'avg_order_value', (select coalesce(avg(total_amount),0) from orders where created_at >= p_from and created_at <= p_to),
    'paid_revenue_period', (select coalesce(sum(total_amount),0) from orders where payment_status = 'paid' and created_at >= p_from and created_at <= p_to),
    'paid_orders_in_period', (select count(*) from orders where payment_status = 'paid' and created_at >= p_from and created_at <= p_to),
    'prev_paid_revenue_period', (select coalesce(sum(total_amount),0) from orders where payment_status = 'paid' and created_at >= v_prev_from and created_at < p_from),
    'paid_cost_period', (
      select coalesce(sum(coalesce(oi.cost_usd, pr.price_usd, 0) * 1.22 * oi.quantity),0)
      from orders o join order_items oi on oi.order_id = o.id
      left join variants v on v.id = oi.variant_id left join products pr on pr.id = v.product_id
      where o.payment_status = 'paid' and coalesce(o.channel,'web') <> 'manual' and o.created_at >= p_from and o.created_at <= p_to
    ) + (
      select coalesce(sum(coalesce(manual_cost_usd,0) + coalesce(manual_extra_costs_usd,0)),0)
      from orders where channel='manual' and payment_status='paid' and created_at >= p_from and created_at <= p_to
    ),
    'paid_margin_period', (
      select coalesce(sum((oi.price - coalesce(oi.cost_usd, pr.price_usd, 0) * 1.22) * oi.quantity),0)
      from orders o join order_items oi on oi.order_id = o.id
      left join variants v on v.id = oi.variant_id left join products pr on pr.id = v.product_id
      where o.payment_status = 'paid' and coalesce(o.channel,'web') <> 'manual' and o.created_at >= p_from and o.created_at <= p_to
    ) + (
      select coalesce(sum(coalesce(total_amount,0) - coalesce(manual_cost_usd,0) - coalesce(manual_extra_costs_usd,0)),0)
      from orders where channel='manual' and payment_status='paid' and created_at >= p_from and created_at <= p_to
    ),
    'prev_paid_margin_period', (
      select coalesce(sum((oi.price - coalesce(oi.cost_usd, pr.price_usd, 0) * 1.22) * oi.quantity),0)
      from orders o join order_items oi on oi.order_id = o.id
      left join variants v on v.id = oi.variant_id left join products pr on pr.id = v.product_id
      where o.payment_status = 'paid' and coalesce(o.channel,'web') <> 'manual' and o.created_at >= v_prev_from and o.created_at < p_from
    ) + (
      select coalesce(sum(coalesce(total_amount,0) - coalesce(manual_cost_usd,0) - coalesce(manual_extra_costs_usd,0)),0)
      from orders where channel='manual' and payment_status='paid' and created_at >= v_prev_from and created_at < p_from
    ),
    'uyu_orders', (select count(*) from orders where payment_status='paid' and ml_currency='UYU' and created_at>=p_from and created_at<=p_to),
    'uyu_revenue', (select coalesce(sum(total_original),0) from orders where payment_status='paid' and ml_currency='UYU' and created_at>=p_from and created_at<=p_to),
    'uyu_cost', (
      select coalesce(sum(coalesce(oi.cost_usd, pr.price_usd, 0) * 1.22 * oi.quantity * coalesce(o.fx_rate,1)),0)
      from orders o join order_items oi on oi.order_id = o.id
      left join variants v on v.id = oi.variant_id left join products pr on pr.id = v.product_id
      where o.payment_status='paid' and coalesce(o.channel,'web') <> 'manual' and o.ml_currency='UYU' and o.created_at>=p_from and o.created_at<=p_to
    ) + (
      select coalesce(sum((coalesce(manual_cost_usd,0) + coalesce(manual_extra_costs_usd,0)) * coalesce(fx_rate,1)),0)
      from orders where channel='manual' and payment_status='paid' and ml_currency='UYU' and created_at>=p_from and created_at<=p_to
    ),
    'usd_orders', (select count(*) from orders where payment_status='paid' and coalesce(ml_currency,'USD')='USD' and created_at>=p_from and created_at<=p_to),
    'usd_revenue', (select coalesce(sum(total_amount),0) from orders where payment_status='paid' and coalesce(ml_currency,'USD')='USD' and created_at>=p_from and created_at<=p_to),
    'usd_cost', (
      select coalesce(sum(coalesce(oi.cost_usd, pr.price_usd, 0) * 1.22 * oi.quantity),0)
      from orders o join order_items oi on oi.order_id = o.id
      left join variants v on v.id = oi.variant_id left join products pr on pr.id = v.product_id
      where o.payment_status='paid' and coalesce(o.channel,'web') <> 'manual' and coalesce(o.ml_currency,'USD')='USD' and o.created_at>=p_from and o.created_at<=p_to
    ) + (
      select coalesce(sum(coalesce(manual_cost_usd,0) + coalesce(manual_extra_costs_usd,0)),0)
      from orders where channel='manual' and payment_status='paid' and coalesce(ml_currency,'USD')='USD' and created_at>=p_from and created_at<=p_to
    ),
    'orders_total', (select count(*) from orders),
    'status_breakdown', (
      select coalesce(jsonb_agg(jsonb_build_object('status', status, 'count', cnt, 'amount', amt) order by cnt desc), '[]'::jsonb)
      from (
        select status, count(*) cnt, coalesce(sum(total_amount),0) amt
        from orders where created_at >= p_from and created_at <= p_to group by status
      ) s
    ),
    'concretado_count', (select count(*) from orders where status = 'Concretado' and created_at >= p_from and created_at <= p_to),
    'customers_new_period', (select count(*) from customers where created_at >= p_from and created_at <= p_to),
    'customers_total', (select count(*) from customers),
    'products_total', (select count(*) from products),
    'products_local', (select count(*) from products where source = 'local'),
    'products_cdr', (select count(*) from products where source = 'cdr'),
    'stock_units', (select coalesce(sum(stock),0) from variants),
    'variants_out_of_stock', (select count(*) from variants where stock = 0),
    'variants_low_stock', (select count(*) from variants where stock > 0 and stock < 5),
    'brands_total', (select count(*) from brands),
    'categories_total', (select count(*) from categories),
    'prev_revenue_period', (select coalesce(sum(total_amount),0) from orders where created_at >= v_prev_from and created_at < p_from),
    'prev_orders_in_period', (select count(*) from orders where created_at >= v_prev_from and created_at < p_from)
  ) into result;
  return result;
end;
$function$
