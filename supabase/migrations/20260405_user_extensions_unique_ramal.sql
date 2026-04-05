-- Regra adicional: cada ramal pode ter no maximo 1 vinculo ativo por vez.

CREATE UNIQUE INDEX IF NOT EXISTS user_extensions_ramal_active_uidx
  ON user_extensions (ramal)
  WHERE ativo = TRUE;
