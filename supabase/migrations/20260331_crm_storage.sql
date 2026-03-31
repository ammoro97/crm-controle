-- Tabela de armazenamento persistente do CRM
-- Substitui arquivos /tmp (efemeros no Vercel) por storage duravel no Supabase.
-- Acessada exclusivamente via service role key (server-side).

CREATE TABLE IF NOT EXISTS crm_storage (
  key        TEXT        PRIMARY KEY,
  value      JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS habilitado por seguranca. Service role bypassa automaticamente.
ALTER TABLE crm_storage ENABLE ROW LEVEL SECURITY;
