-- Vínculo funcional entre Responsável do CRM e usuário autenticado (Supabase Auth).

ALTER TABLE IF EXISTS public.crm_responsaveis
  ADD COLUMN IF NOT EXISTS auth_user_id UUID NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'crm_responsaveis_auth_user_id_fkey'
  ) THEN
    ALTER TABLE public.crm_responsaveis
      ADD CONSTRAINT crm_responsaveis_auth_user_id_fkey
      FOREIGN KEY (auth_user_id)
      REFERENCES auth.users(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS crm_responsaveis_auth_user_uidx
  ON public.crm_responsaveis (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS crm_responsaveis_email_lower_idx
  ON public.crm_responsaveis (LOWER(email));
