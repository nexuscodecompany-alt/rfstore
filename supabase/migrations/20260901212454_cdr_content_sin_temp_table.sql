-- Disk IO: esta funcion hacia `create temp table _cdr_content` en CADA llamada.
-- 55.889 llamadas -> 25 GB escritos en buffers locales (archivos temporales en disco)
-- + churn del catalogo del sistema (pg_class/pg_attribute/pg_type/pg_depend reciben un
-- alta y una baja por cada temp table, y eso genera WAL).
--
-- La temp table existia solo porque el conjunto se usa DOS veces: para el UPDATE y para
-- el resumen. Una CTE `materialized` hace lo mismo en memoria y dentro de una sola
-- sentencia. Postgres garantiza que las CTE que modifican datos se ejecutan siempre y
-- por completo, aunque la query principal no lea su salida.
-- Semantica identica: `c` se materializa del snapshot previo al UPDATE, igual que antes
-- la temp table se llenaba antes de actualizar. Verificado con test real sobre ACC35.

create or replace function public.cdr_bulk_update_content(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  with i as (
    select x->>'code' as code,
           x->>'name' as name,
           coalesce(x->>'description_html','') as description_html,
           coalesce(x->'features','[]'::jsonb) as features,
           md5(
             coalesce(x->>'name','')        || chr(31) ||
             coalesce(x->>'copete','')      || chr(31) ||
             coalesce(x->>'description_html','') || chr(31) ||
             coalesce(x->>'modelo','')
           ) as new_hash
    from jsonb_array_elements(p_rows) x
    where coalesce(x->>'code','') <> ''
  ),
  c as materialized (
    select p.id,
           p.external_code,
           p.content_locked,
           p.cdr_content_hash as old_hash,
           i.name,
           i.description_html,
           i.features,
           i.new_hash,
           exists(select 1 from ml_item_mapping m where m.product_id = p.id and m.status in ('active','paused')) as in_ml,
           (p.cdr_content_hash is not null and p.cdr_content_hash is distinct from i.new_hash) as is_changed
    from i
    join products p on p.external_code = i.code and p.source = 'cdr'
  ),
  upd as (
    update products p set
      cdr_content_hash = c.new_hash,
      cdr_content_changed_at = case when c.is_changed then now() else p.cdr_content_changed_at end,
      name = case when c.is_changed and not c.content_locked then c.name else p.name end,
      description = case when c.is_changed and not c.content_locked
                        then jsonb_build_object('type','doc','content',
                               jsonb_build_array(jsonb_build_object('type','html','html', c.description_html)))
                        else p.description end,
      features = case when c.is_changed and not c.content_locked
                      then (select array_agg(elem order by ord)
                            from jsonb_array_elements_text(c.features) with ordinality t(elem, ord))
                      else p.features end,
      ml_content_dirty = case when c.is_changed and c.in_ml then true else p.ml_content_dirty end
    from c
    where p.id = c.id
      and (p.cdr_content_hash is distinct from c.new_hash or (c.is_changed and c.in_ml))
    returning 1
  )
  select jsonb_build_object(
    'changed', coalesce(jsonb_agg(jsonb_build_object(
                'code', external_code, 'name', name,
                'locked', content_locked, 'in_ml', in_ml
              )) filter (where is_changed), '[]'::jsonb),
    'applied',    count(*) filter (where is_changed and not content_locked),
    'baseline',   count(*) filter (where old_hash is null),
    'ml_flagged', count(*) filter (where is_changed and in_ml)
  )
  into v_result
  from c;

  return v_result;
end
$$;

revoke all on function public.cdr_bulk_update_content(jsonb) from public, anon, authenticated;
grant execute on function public.cdr_bulk_update_content(jsonb) to service_role;
