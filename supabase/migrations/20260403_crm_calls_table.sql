-- Tabela dedicada para ligacoes.
-- Todas as ligacoes passam a ser persistidas em estrutura propria no Supabase.

CREATE TABLE IF NOT EXISTS crm_calls (
  call_id           TEXT        PRIMARY KEY,
  lead_id           TEXT        NULL,
  external_call_id  TEXT        NULL,
  session_id        TEXT        NULL,
  started_at        TIMESTAMPTZ NULL,
  status            TEXT        NULL,
  payload           JSONB       NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE crm_calls ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS crm_calls_updated_at_idx ON crm_calls (updated_at DESC);
CREATE INDEX IF NOT EXISTS crm_calls_started_at_idx ON crm_calls (started_at DESC);
CREATE INDEX IF NOT EXISTS crm_calls_lead_id_idx ON crm_calls (lead_id);
CREATE INDEX IF NOT EXISTS crm_calls_external_call_id_idx ON crm_calls (external_call_id);
CREATE INDEX IF NOT EXISTS crm_calls_session_id_idx ON crm_calls (session_id);

-- Backfill de ligacoes a partir do snapshot legado em crm_storage (key='call-logs')
WITH source_items AS (
  SELECT item
  FROM crm_storage cs,
  LATERAL jsonb_array_elements(cs.value) AS item
  WHERE cs.key = 'call-logs'
    AND jsonb_typeof(cs.value) = 'array'
    AND jsonb_typeof(item) = 'object'
),
normalized AS (
  SELECT
    COALESCE(
      NULLIF(BTRIM(item ->> 'id'), ''),
      CONCAT('legacy-call-', SUBSTRING(MD5(item::text) FOR 20))
    ) AS call_id,
    NULLIF(BTRIM(item ->> 'leadId'), '') AS lead_id,
    NULLIF(BTRIM(item ->> 'externalCallId'), '') AS external_call_id,
    NULLIF(BTRIM(item ->> 'sessionId'), '') AS session_id,
    CASE
      WHEN COALESCE(item ->> 'startedAt', '') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}'
      THEN (item ->> 'startedAt')::timestamptz
      ELSE NULL
    END AS started_at,
    NULLIF(BTRIM(item ->> 'status'), '') AS status,
    jsonb_set(
      item,
      '{id}',
      to_jsonb(
        COALESCE(
          NULLIF(BTRIM(item ->> 'id'), ''),
          CONCAT('legacy-call-', SUBSTRING(MD5(item::text) FOR 20))
        )
      )
    ) AS payload
  FROM source_items
)
INSERT INTO crm_calls (
  call_id,
  lead_id,
  external_call_id,
  session_id,
  started_at,
  status,
  payload,
  updated_at
)
SELECT
  call_id,
  lead_id,
  external_call_id,
  session_id,
  started_at,
  status,
  payload,
  NOW()
FROM normalized
ON CONFLICT (call_id)
DO UPDATE SET
  lead_id = EXCLUDED.lead_id,
  external_call_id = EXCLUDED.external_call_id,
  session_id = EXCLUDED.session_id,
  started_at = EXCLUDED.started_at,
  status = EXCLUDED.status,
  payload = EXCLUDED.payload,
  updated_at = NOW();
