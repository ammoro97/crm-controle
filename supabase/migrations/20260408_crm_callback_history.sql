-- Historico de leads enviados para callback (somente novos eventos).
-- Mantem registro por wrapup para auditoria e analise operacional.

CREATE TABLE IF NOT EXISTS crm_callback_history (
  id               BIGSERIAL PRIMARY KEY,
  wrapup_id        TEXT        NOT NULL,
  lead_id          TEXT        NOT NULL,
  session_id       TEXT        NOT NULL,
  call_id          TEXT        NULL,
  external_call_id TEXT        NULL,
  callback_at      TIMESTAMPTZ NOT NULL,
  callback_by      TEXT        NOT NULL,
  finalizacao      TEXT        NOT NULL,
  subfinalizacao   TEXT        NULL,
  lead_payload     JSONB       NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE crm_callback_history ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS crm_callback_history_wrapup_id_uidx
  ON crm_callback_history (wrapup_id);

CREATE INDEX IF NOT EXISTS crm_callback_history_lead_id_idx
  ON crm_callback_history (lead_id);

CREATE INDEX IF NOT EXISTS crm_callback_history_callback_at_idx
  ON crm_callback_history (callback_at DESC);

