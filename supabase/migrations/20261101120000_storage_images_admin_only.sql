-- Fotos de productos y del blog: sólo los admins suben, reemplazan o borran
-- (01/11/2026).
--
-- product-images tenía las políticas de ejemplo de Supabase ("Give access to all
-- users") para INSERT/UPDATE/DELETE con roles anon + authenticated: cualquier
-- visitante, sin login, podía subir, pisar o borrar las fotos de la tienda.
-- blog dejaba subir a cualquier usuario logueado (hoy cualquiera puede crearse
-- una cuenta, y con la compra como invitado también tiene sesión).
--
-- La lectura no cambia: los dos buckets son públicos y se sirven por URL
-- pública. Todo lo que sube imágenes desde el sitio es del panel de admin
-- (productos, home, blog); las edge functions usan service_role y no pasan por
-- estas políticas.

drop policy if exists "Give access to all users 16wiy3a_0" on storage.objects; -- INSERT
drop policy if exists "Give access to all users 16wiy3a_2" on storage.objects; -- UPDATE
drop policy if exists "Give access to all users 16wiy3a_3" on storage.objects; -- DELETE
drop policy if exists "Authenticated upload to blog" on storage.objects;

create policy product_images_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-images' and public.is_admin());
create policy product_images_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'product-images' and public.is_admin())
  with check (bucket_id = 'product-images' and public.is_admin());
create policy product_images_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-images' and public.is_admin());

-- El panel del blog también borra la imagen al eliminar un post: antes no había
-- política de DELETE y fallaba en silencio.
create policy blog_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'blog' and public.is_admin());
create policy blog_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'blog' and public.is_admin())
  with check (bucket_id = 'blog' and public.is_admin());
create policy blog_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'blog' and public.is_admin());
