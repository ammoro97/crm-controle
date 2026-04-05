-- Vinculo de ramal por usuario autenticado do CRM.
-- Regra: cada usuario pode ter no maximo 1 ramal ativo.

CREATE TABLE IF NOT EXISTS user_extensions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL,
  ramal      TEXT        NOT NULL,
  ativo      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_extensions_user_id_fkey'
  ) THEN
    ALTER TABLE user_extensions
      ADD CONSTRAINT user_extensions_user_id_fkey
      FOREIGN KEY (user_id)
      REFERENCES auth.users(id)
      ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE user_extensions ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS user_extensions_user_active_uidx
  ON user_extensions (user_id)
  WHERE ativo = TRUE;

CREATE INDEX IF NOT EXISTS user_extensions_ramal_idx
  ON user_extensions (ramal);
