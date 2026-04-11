-- Funções de batch upsert com IS DISTINCT FROM para ignorar linhas sem mudança.
-- Substitui o padrão read-before-write (fingerprinting) feito na aplicação,
-- eliminando 2 SELECT queries + ~4MB de transferência por operação de save.
-- Chamadas via supabase.rpc('upsert_leads_batch', { rows: [...] })

CREATE OR REPLACE FUNCTION upsert_leads_batch(rows jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO crm_leads (lead_id, payload, updated_at)
  SELECT
    TRIM(item->>'lead_id'),
    item->'payload',
    COALESCE((item->>'updated_at')::timestamptz, NOW())
  FROM jsonb_array_elements(rows) AS item
  WHERE TRIM(item->>'lead_id') IS NOT NULL
    AND TRIM(item->>'lead_id') <> ''
  ON CONFLICT (lead_id) DO UPDATE
    SET
      payload    = EXCLUDED.payload,
      updated_at = EXCLUDED.updated_at
    WHERE crm_leads.payload IS DISTINCT FROM EXCLUDED.payload;
END;
$$;

CREATE OR REPLACE FUNCTION upsert_customers_batch(rows jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO crm_customers (lead_id, payload, updated_at)
  SELECT
    TRIM(item->>'lead_id'),
    item->'payload',
    COALESCE((item->>'updated_at')::timestamptz, NOW())
  FROM jsonb_array_elements(rows) AS item
  WHERE TRIM(item->>'lead_id') IS NOT NULL
    AND TRIM(item->>'lead_id') <> ''
  ON CONFLICT (lead_id) DO UPDATE
    SET
      payload    = EXCLUDED.payload,
      updated_at = EXCLUDED.updated_at
    WHERE crm_customers.payload IS DISTINCT FROM EXCLUDED.payload;
END;
$$;
