-- CDR / doc v2.0 - Fase 5: los 13 campos nuevos del WS, en columnas propias.
--
-- Contexto
-- --------
-- La doc v1.0 tenia 11 campos; la v2.0 tiene 24. Hasta ahora los unicos que guardabamos
-- eran nombre, copete, descripcion, precio y stock — y `modelo`, `nro_parte` y `gtin` se
-- metian DENTRO del array `features` como texto suelto ("GTIN: 6923520245451"), que despues
-- ml-publish-item vuelve a parsear con expresiones regulares. Fragil y sin poder consultarse.
--
-- Medido contra el catalogo real (1857 productos, 03/09/2026):
--   peso, ancho, alto, profundidad ... 100 %   <- la doc decia ~68 %
--   categoria, descripcion .......... 100 %
--   garantia ........................  96,7 %  <- antes creiamos que CDR no la mandaba
--   marca ...........................  96,6 %
--   webmarca ........................  89,1 %
--   gtin ............................  84,2 %
--   modelo ..........................  78,0 %
--   fabricante ......................  69,5 %
--   nro_parte .......................  62,5 %
--   descripcion_comercial ...........  12,7 %
--   vinculogarantia .................   5,1 %
--   pvp > 0 .........................   8,8 %  (163 productos)
--   pvpml > 0 .......................   4,9 %  (91 productos)
--
-- Por que columnas `cdr_*` separadas y NO dentro del hash de contenido
-- -------------------------------------------------------------------
-- Era tentador sumar estos campos al hash de `cdr_bulk_update_content`. Seria un error:
-- ese hash es md5(nombre + copete + descripcion + modelo) y cambiar la FORMULA marca de
-- golpe los 1857 productos como "cambiados" -> pisa nombre y descripcion de todo lo no
-- bloqueado, prende ml_content_dirty en todo lo publicado en ML y dispara un mail gigante.
--
-- Estas columnas son DATO CRUDO DEL PROVEEDOR, no contenido editable: se guardan aparte y
-- se refrescan siempre, sin tocar `name`, `description` ni `features`. Asi el hash de
-- contenido queda intacto, el candado `content_locked` sigue protegiendo lo que el admin
-- edito a mano, y no hay ninguna tormenta.
--
-- El prefijo `cdr_` deja explicito el origen: es lo que dice CDR, no lo que decidimos
-- nosotros. Los campos de decision propia (precio de venta, categoria publicada, marca
-- asignada) siguen siendo los de siempre.

alter table public.products
  -- Identificacion del fabricante. Ojo: `cdr_gtin` NO identifica al producto — varias
  -- variantes (outlet, refurbished, con SO) comparten GTIN (doc 7.4). El identificador
  -- sigue siendo external_code.
  add column if not exists cdr_gtin                  text,
  add column if not exists cdr_modelo                text,
  add column if not exists cdr_nro_parte             text,
  -- Marca segun CDR (texto). Se usa para SUGERIR el brand_id, no lo pisa.
  add column if not exists cdr_marca                 text,
  add column if not exists cdr_marca_url             text,
  add column if not exists cdr_fabricante_url        text,
  -- Jerarquia de CDR, niveles separados por " >> " (doc 7.8). Ej:
  -- "Audio Imagen >> Auriculares y Microfonos >> Inalambricos". Hasta 4 niveles.
  add column if not exists cdr_categoria             text,
  -- Garantia: texto libre ("1 año"). Viene en el 96,7 %.
  add column if not exists cdr_garantia              text,
  add column if not exists cdr_garantia_url          text,
  add column if not exists cdr_descripcion_comercial text,
  -- Precios SUGERIDOS por CDR. 0 = "sin sugerido cargado", NO "gratis" (doc 7.7).
  -- Se guardan como NULL cuando llegan en 0, para que nadie los publique por error.
  add column if not exists cdr_pvp_usd               numeric,
  add column if not exists cdr_pvpml_usd             numeric,
  -- Logistica. Vienen al 100 %: sirven para ML (atributos obligatorios) y para envios.
  add column if not exists cdr_peso_gramos           numeric,
  add column if not exists cdr_ancho_cm              numeric,
  add column if not exists cdr_alto_cm               numeric,
  add column if not exists cdr_profundidad_cm        numeric,
  -- `habilitado` de CDR. false = CDR lo despublico. NO se desactiva el producto solo:
  -- eso lo decide el admin. Sirve para filtrar en el panel y para no publicarlo en ML.
  add column if not exists cdr_habilitado            boolean,
  add column if not exists cdr_fields_updated_at     timestamptz;

comment on column public.products.cdr_gtin        is 'GTIN segun CDR. NO es identificador: varias variantes comparten el mismo (doc 7.4). Usar external_code.';
comment on column public.products.cdr_categoria   is 'Jerarquia de CDR, niveles separados por " >> " (doc 7.8). Referencia para sugerir category_id, no la pisa.';
comment on column public.products.cdr_marca       is 'Marca en texto segun CDR. Referencia para sugerir brand_id, no lo pisa.';
comment on column public.products.cdr_pvp_usd     is 'Precio sugerido por CDR para web. NULL = sin sugerido (CDR manda 0, que no significa gratis).';
comment on column public.products.cdr_pvpml_usd   is 'Precio sugerido por CDR para MercadoLibre (mas alto: absorbe la comision). NULL = sin sugerido.';
comment on column public.products.cdr_habilitado  is 'false = CDR despublico el producto. No lo desactiva solo; lo decide el admin.';

-- Buscar por marca de CDR (para el asistente de asignacion de marca de la Fase 6).
create index if not exists idx_products_cdr_marca
  on public.products (cdr_marca)
  where source = 'cdr' and cdr_marca is not null;

-- Los despublicados por CDR, que el admin tiene que revisar.
create index if not exists idx_products_cdr_deshabilitados
  on public.products (cdr_habilitado)
  where source = 'cdr' and cdr_habilitado = false;


-- ---------------------------------------------------------------------------------
-- RPC: refresco en lote de los campos crudos de CDR.
--
-- Deliberadamente NO toca name / description / features / price_usd / stock: de eso se
-- ocupan cdr_bulk_update_content y cdr_bulk_update_stock_price, cada uno con su candado.
-- Esta funcion solo copia lo que dice CDR a las columnas cdr_*, asi que es idempotente
-- y no puede pisar nada que el admin haya editado.
--
-- Los numeros se castean con una expresion tolerante porque el WS mezcla tipos (doc 7.6):
-- `precio` y `peso` llegan como string ("92.00", "700") y `pvp` como number.
-- ---------------------------------------------------------------------------------
create or replace function public.cdr_bulk_update_fields(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_updated int;
begin
  with i as (
    select
      x->>'code'                             as code,
      nullif(trim(x->>'gtin'), '')           as gtin,
      nullif(trim(x->>'modelo'), '')         as modelo,
      nullif(trim(x->>'nro_parte'), '')      as nro_parte,
      nullif(trim(x->>'marca'), '')          as marca,
      nullif(trim(x->>'webmarca'), '')       as marca_url,
      nullif(trim(x->>'fabricante'), '')     as fabricante_url,
      nullif(trim(x->>'categoria'), '')      as categoria,
      nullif(trim(x->>'garantia'), '')       as garantia,
      nullif(trim(x->>'vinculogarantia'),'') as garantia_url,
      nullif(trim(x->>'descripcion_comercial'), '') as desc_comercial,
      -- 0 = "sin sugerido cargado", no "gratis" (doc 7.7) -> se guarda NULL.
      nullif(coalesce((x->>'pvp')::numeric, 0), 0)          as pvp,
      nullif(coalesce((x->>'pvpml')::numeric, 0), 0)        as pvpml,
      nullif(coalesce((x->>'peso')::numeric, 0), 0)         as peso,
      nullif(coalesce((x->>'ancho')::numeric, 0), 0)        as ancho,
      nullif(coalesce((x->>'alto')::numeric, 0), 0)         as alto,
      nullif(coalesce((x->>'profundidad')::numeric, 0), 0)  as profundidad,
      coalesce((x->>'habilitado')::numeric, 0) > 0          as habilitado
    from jsonb_array_elements(p_rows) x
    where coalesce(x->>'code', '') <> ''
  ),
  upd as (
    update products p set
      cdr_gtin                  = i.gtin,
      cdr_modelo                = i.modelo,
      cdr_nro_parte             = i.nro_parte,
      cdr_marca                 = i.marca,
      cdr_marca_url             = i.marca_url,
      cdr_fabricante_url        = i.fabricante_url,
      cdr_categoria             = i.categoria,
      cdr_garantia              = i.garantia,
      cdr_garantia_url          = i.garantia_url,
      cdr_descripcion_comercial = i.desc_comercial,
      cdr_pvp_usd               = i.pvp,
      cdr_pvpml_usd             = i.pvpml,
      cdr_peso_gramos           = i.peso,
      cdr_ancho_cm              = i.ancho,
      cdr_alto_cm               = i.alto,
      cdr_profundidad_cm        = i.profundidad,
      cdr_habilitado            = i.habilitado,
      cdr_fields_updated_at     = now()
    from i
    where p.external_code = i.code
      and p.source = 'cdr'
      -- Solo si cambio algo de verdad: evita escrituras inutiles en cada corrida
      -- (288 por dia) y el disk IO que eso genera.
      and (p.cdr_gtin                  is distinct from i.gtin
        or p.cdr_modelo                is distinct from i.modelo
        or p.cdr_nro_parte             is distinct from i.nro_parte
        or p.cdr_marca                 is distinct from i.marca
        or p.cdr_marca_url             is distinct from i.marca_url
        or p.cdr_fabricante_url        is distinct from i.fabricante_url
        or p.cdr_categoria             is distinct from i.categoria
        or p.cdr_garantia              is distinct from i.garantia
        or p.cdr_garantia_url          is distinct from i.garantia_url
        or p.cdr_descripcion_comercial is distinct from i.desc_comercial
        or p.cdr_pvp_usd               is distinct from i.pvp
        or p.cdr_pvpml_usd             is distinct from i.pvpml
        or p.cdr_peso_gramos           is distinct from i.peso
        or p.cdr_ancho_cm              is distinct from i.ancho
        or p.cdr_alto_cm               is distinct from i.alto
        or p.cdr_profundidad_cm        is distinct from i.profundidad
        or p.cdr_habilitado            is distinct from i.habilitado)
    returning 1
  )
  select count(*) into v_updated from upd;

  return jsonb_build_object('fields_updated', v_updated);
end
$function$;

-- Quien la llama: SOLO el service_role (las edge functions). Regla del proyecto: toda
-- RPC nueva declara explicitamente quien puede ejecutarla, si no queda llamable con la
-- anon key desde el navegador.
revoke all on function public.cdr_bulk_update_fields(jsonb) from public;
revoke all on function public.cdr_bulk_update_fields(jsonb) from anon;
revoke all on function public.cdr_bulk_update_fields(jsonb) from authenticated;
grant execute on function public.cdr_bulk_update_fields(jsonb) to service_role;

comment on function public.cdr_bulk_update_fields(jsonb) is
  'Refresca las columnas cdr_* (datos crudos del WS de CDR v2.0). NO toca name/description/features/precio/stock: de eso se ocupan cdr_bulk_update_content y cdr_bulk_update_stock_price. Ver docs/cdr/README.md.';
