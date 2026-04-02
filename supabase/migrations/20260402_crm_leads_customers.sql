-- Tabelas dedicadas para Leads e Clientes.
-- Mantemos crm_storage como fallback, mas Leads/Clientes passam a ter tabelas proprias.

CREATE TABLE IF NOT EXISTS crm_leads (
  lead_id    TEXT        PRIMARY KEY,
  payload    JSONB       NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS crm_customers (
  lead_id    TEXT        PRIMARY KEY,
  payload    JSONB       NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE crm_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_customers ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS crm_leads_updated_at_idx ON crm_leads (updated_at DESC);
CREATE INDEX IF NOT EXISTS crm_customers_updated_at_idx ON crm_customers (updated_at DESC);

-- Backfill de Leads a partir do snapshot legado (crm_storage.key = 'crm.leads.v1')
WITH source_items AS (
  SELECT item
  FROM crm_storage cs,
  LATERAL jsonb_array_elements(cs.value) AS item
  WHERE cs.key = 'crm.leads.v1'
    AND jsonb_typeof(cs.value) = 'array'
    AND jsonb_typeof(item) = 'object'
),
normalized AS (
  SELECT
    COALESCE(
      NULLIF(BTRIM(item ->> 'id'), ''),
      CONCAT('legacy-', SUBSTRING(MD5(item::text) FOR 20))
    ) AS lead_id,
    jsonb_set(
      item,
      '{id}',
      to_jsonb(
        COALESCE(
          NULLIF(BTRIM(item ->> 'id'), ''),
          CONCAT('legacy-', SUBSTRING(MD5(item::text) FOR 20))
        )
      )
    ) AS payload
  FROM source_items
)
INSERT INTO crm_leads (lead_id, payload, updated_at)
SELECT lead_id, payload, NOW()
FROM normalized
ON CONFLICT (lead_id)
DO UPDATE SET
  payload = EXCLUDED.payload,
  updated_at = NOW();

-- Backfill de Clientes a partir do snapshot legado (crm_storage.key = 'crm.customers.v1')
WITH source_items AS (
  SELECT item
  FROM crm_storage cs,
  LATERAL jsonb_array_elements(cs.value) AS item
  WHERE cs.key = 'crm.customers.v1'
    AND jsonb_typeof(cs.value) = 'array'
    AND jsonb_typeof(item) = 'object'
),
normalized AS (
  SELECT
    COALESCE(
      NULLIF(BTRIM(item ->> 'id'), ''),
      CONCAT('legacy-', SUBSTRING(MD5(item::text) FOR 20))
    ) AS lead_id,
    jsonb_set(
      item,
      '{id}',
      to_jsonb(
        COALESCE(
          NULLIF(BTRIM(item ->> 'id'), ''),
          CONCAT('legacy-', SUBSTRING(MD5(item::text) FOR 20))
        )
      )
    ) AS payload
  FROM source_items
)
INSERT INTO crm_customers (lead_id, payload, updated_at)
SELECT lead_id, payload, NOW()
FROM normalized
ON CONFLICT (lead_id)
DO UPDATE SET
  payload = EXCLUDED.payload,
  updated_at = NOW();
