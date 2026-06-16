-- Sistema de cupones de descuento.
-- Aplicado a producción 2026-06-16 vía MCP (este archivo es el reflejo en el repo).

-- 1) Tabla de cupones
create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  type text not null check (type in ('percent','fixed','free_shipping')),
  value numeric not null default 0,         -- percent: %, fixed: monto en UYU, free_shipping: ignorado
  scope text not null default 'all' check (scope in ('all','category','product')),
  category_id uuid references public.categories(id) on delete set null,
  product_id  uuid references public.products(id)  on delete set null,
  min_order_usd numeric,                     -- mínimo de subtotal de productos (USD); null = sin mínimo
  max_uses int,                              -- null = ilimitado
  used_count int not null default 0,
  expires_at timestamptz,                    -- null = sin vencimiento
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists coupons_code_uidx on public.coupons (upper(code));

alter table public.coupons enable row level security;
drop policy if exists coupons_admin_all on public.coupons;
create policy coupons_admin_all on public.coupons for all
  using (is_admin()) with check (is_admin());

-- 2) Registrar el cupón usado en la orden
alter table public.orders
  add column if not exists coupon_id uuid references public.coupons(id),
  add column if not exists coupon_code text,
  add column if not exists discount_usd numeric not null default 0;

-- 3) Validar + calcular descuento (server-side, a prueba de manipulación)
create or replace function public.apply_coupon(
  p_code text, p_items jsonb, p_subtotal numeric, p_shipping numeric default 0
) returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.coupons; v_elig numeric := 0; v_disc numeric := 0; v_free boolean := false; v_fx numeric;
begin
  select * into c from public.coupons where upper(code)=upper(trim(p_code)) limit 1;
  if not found then return jsonb_build_object('valid',false,'reason','Código inválido'); end if;
  if not c.active then return jsonb_build_object('valid',false,'reason','Cupón inactivo'); end if;
  if c.expires_at is not null and c.expires_at < now() then return jsonb_build_object('valid',false,'reason','Cupón vencido'); end if;
  if c.max_uses is not null and c.used_count >= c.max_uses then return jsonb_build_object('valid',false,'reason','Cupón agotado'); end if;
  if c.min_order_usd is not null and coalesce(p_subtotal,0) < c.min_order_usd then
    return jsonb_build_object('valid',false,'reason','Mínimo de compra USD '||c.min_order_usd); end if;

  if c.scope = 'all' then v_elig := coalesce(p_subtotal,0);
  else
    select coalesce(sum((e->>'price')::numeric*(e->>'quantity')::int),0) into v_elig
    from jsonb_array_elements(p_items) e
    join variants v on v.id=(e->>'variant_id')::uuid
    join products p on p.id=v.product_id
    where (c.scope='category' and p.category_id=c.category_id)
       or (c.scope='product'  and p.id=c.product_id);
  end if;

  if c.type='free_shipping' then v_free := true;
  elsif c.type='percent' then v_disc := round(v_elig*c.value/100,2);
  elsif c.type='fixed' then
    select (value->>'rate')::numeric into v_fx from app_settings where key='usd_uyu_rate_cache';
    if v_fx is null or v_fx<=0 then return jsonb_build_object('valid',false,'reason','Sin cotización para convertir'); end if;
    v_disc := round(c.value/v_fx,2);
    if v_disc > v_elig then v_disc := v_elig; end if;
  end if;

  if c.scope<>'all' and v_elig<=0 and not v_free then
    return jsonb_build_object('valid',false,'reason','No aplica a los productos del carrito'); end if;

  return jsonb_build_object('valid',true,'coupon_id',c.id,'code',c.code,'type',c.type,
    'discount_usd',v_disc,'free_shipping',v_free);
end $$;
grant execute on function public.apply_coupon(text,jsonb,numeric,numeric) to anon, authenticated;
