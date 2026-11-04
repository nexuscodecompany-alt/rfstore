-- Facturas de ventas de Mercado Libre: el PDF de Fixed se sube a la venta en ML
-- (POST /packs/{pack_id}/fiscal_documents) para que el comprador la vea y ML le
-- avise. Sólo en producción: un comprobante de prueba nunca se sube a una venta real.
alter table public.invoices
  add column if not exists ml_fiscal_document_id text,
  add column if not exists ml_uploaded_at timestamptz,
  add column if not exists ml_upload_error text;
