-- GO-LIVE del esquema de envíos por departamento (correr DESPUÉS de que el
-- frontend nuevo esté en producción y mp-create-preference v31 desplegada).
--
-- 1. Política de Envíos nueva (sin PQuick ni zonas).
-- 2. place_cdr_order deja de aceptar el costo de envío del cliente: se borra la
--    rama de transición del frontend viejo (ver 20261027160000_shipping_fixed_rates).

update public.app_settings
   set value = jsonb_set(value, '{envios,content}', to_jsonb($txt$En RF Store trabajamos para que tus compras lleguen a destino de forma segura, rápida y eficiente. A continuación, te detallamos nuestra logística de envíos.

⏱️ Procesamiento de Pedidos
Procesamos pedidos de lunes a viernes, en días hábiles.
Las compras realizadas durante fines de semana o feriados serán procesadas a partir del siguiente día hábil.

📦 Métodos de Envío y Costos

Montevideo y Canelones: envío express en el día
- Montevideo: USD 6
- Canelones: USD 8
- Envío gratis en compras desde USD 150.
Comprando antes de las 15:00 h (días hábiles), tu pedido llega el mismo día. Las compras realizadas después de esa hora se entregan el siguiente día hábil.

Al Interior del país vía DAC
Los envíos al resto del país se realizan a través de DAC.
El pedido será despachado dentro de un plazo estimado de 24 a 48 horas hábiles luego de confirmada la compra.
El costo del envío se abona directamente a la agencia al momento de recibir o retirar el paquete, bajo modalidad cobro en destino.
Una vez despachado, el tiempo de entrega dependerá de DAC y de la localidad de destino.

📍 Información Importante
Una vez despachado el pedido, recibirás la información necesaria para realizar el seguimiento del envío.
Es responsabilidad del cliente ingresar correctamente los datos de entrega. Si el pedido es devuelto por datos incorrectos, ausencia en el domicilio o imposibilidad de entrega, el costo de un nuevo envío quedará a cargo del cliente.
Los plazos mencionados son estimados y pueden verse afectados por la disponibilidad del producto, coordinación logística, días feriados o factores externos al servicio de entrega.

💬 ¿Necesitás ayuda o cometiste un error en tu compra?
Si ingresaste mal tus datos, seleccionaste un producto incorrecto o necesitás modificar tu pedido, contactanos lo antes posible.
Solo podremos realizar cambios si el pedido aún no fue despachado.

WhatsApp: 098732327$txt$::text)),
       updated_at = now()
 where key = 'legal_pages';

-- 2. Cierre de la transición: correr 20261027_go_live_place_cdr_order.sql y
--    desplegar mp-create-preference sin el else de "TRANSICIÓN".
