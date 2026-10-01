-- El bucket payment-proofs nunca tuvo políticas: todo upload del cliente
-- rebotaba con "new row violates row-level security policy".
-- La carpeta del archivo es el id de la orden ({orderId}/{ts}-{nombre}).

create or replace function public.can_attach_payment_proof(p_folder text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select auth.uid() is not null
     and p_folder ~ '^[0-9]+$'
     and exists (
       select 1 from orders o
         join customers c on c.id = o.customer_id
        where o.id = p_folder::bigint
          and c.user_id = auth.uid()
          and coalesce(o.payment_status, '') <> 'paid'
          and lower(coalesce(o.status, '')) not in ('cancelado','rechazado','expirado','cancelled')
     );
$$;

create or replace function public.owns_order_folder(p_folder text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select auth.uid() is not null
     and p_folder ~ '^[0-9]+$'
     and exists (
       select 1 from orders o
         join customers c on c.id = o.customer_id
        where o.id = p_folder::bigint
          and c.user_id = auth.uid()
     );
$$;

revoke all on function public.can_attach_payment_proof(text) from public, anon;
revoke all on function public.owns_order_folder(text) from public, anon;
grant execute on function public.can_attach_payment_proof(text) to authenticated, service_role;
grant execute on function public.owns_order_folder(text) to authenticated, service_role;

-- Subir: sólo a SU orden y mientras espera el pago.
create policy "payment_proofs_insert_own_pending"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'payment-proofs'
  and public.can_attach_payment_proof((storage.foldername(name))[1])
);

-- upsert:true también necesita UPDATE (y SELECT) sobre la fila.
create policy "payment_proofs_update_own_pending"
on storage.objects for update to authenticated
using (
  bucket_id = 'payment-proofs'
  and public.can_attach_payment_proof((storage.foldername(name))[1])
)
with check (
  bucket_id = 'payment-proofs'
  and public.can_attach_payment_proof((storage.foldername(name))[1])
);

-- Leer (signed URL): el dueño de la orden o el admin.
create policy "payment_proofs_select_own_or_admin"
on storage.objects for select to authenticated
using (
  bucket_id = 'payment-proofs'
  and (public.is_admin() or public.owns_order_folder((storage.foldername(name))[1]))
);
