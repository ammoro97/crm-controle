/**
 * Aplica a migration de batch upsert no Supabase via Management API.
 *
 * Como gerar o SUPABASE_ACCESS_TOKEN (PAT):
 *   1. Acesse https://supabase.com/dashboard/account/tokens
 *   2. Clique em "Generate new token"
 *   3. Dê um nome (ex: "migration-script") e copie o token
 *   4. Passe como variável de ambiente ou argumento:
 *        SUPABASE_ACCESS_TOKEN=sbp_xxxx node scripts/apply-migration.mjs
 *
 * O token só precisa de acesso ao projeto woykhgdnfjolshbzrkri.
 * Pode revogar após rodar o script.
 */

const PROJECT_REF = "woykhgdnfjolshbzrkri";
const MANAGEMENT_API = "https://api.supabase.com/v1";

const pat = process.env.SUPABASE_ACCESS_TOKEN?.trim();

if (!pat) {
  console.error(
    "ERRO: SUPABASE_ACCESS_TOKEN não definido.\n\n" +
    "Gere em: https://supabase.com/dashboard/account/tokens\n\n" +
    "Uso:\n  SUPABASE_ACCESS_TOKEN=sbp_xxxx node scripts/apply-migration.mjs\n",
  );
  process.exit(1);
}

const MIGRATION_SQL = `
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
`;

async function runQuery(sql) {
  const res = await fetch(`${MANAGEMENT_API}/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${pat}`,
    },
    body: JSON.stringify({ query: sql }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(sem corpo)");
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  return res.json().catch(() => null);
}

async function enablePooler() {
  const res = await fetch(`${MANAGEMENT_API}/projects/${PROJECT_REF}/config/database`, {
    method: "GET",
    headers: { Authorization: `Bearer ${pat}` },
  });

  if (!res.ok) {
    console.warn(`⚠ Não foi possível verificar config do pooler (HTTP ${res.status}) — ative manualmente em Project Settings → Database → Connection pooling`);
    return;
  }

  const config = await res.json().catch(() => null);
  if (config?.pool_mode) {
    console.log(`  Pooler já configurado (mode=${config.pool_mode})`);
    return;
  }

  const patchRes = await fetch(`${MANAGEMENT_API}/projects/${PROJECT_REF}/config/database`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${pat}`,
    },
    body: JSON.stringify({ pool_mode: "transaction" }),
  });

  if (!patchRes.ok) {
    console.warn(`⚠ Não foi possível habilitar pooler via API (HTTP ${patchRes.status}) — ative manualmente em Project Settings → Database → Connection pooling`);
  } else {
    console.log("  Pooler habilitado (transaction mode)");
  }
}

async function main() {
  console.log(`Aplicando migration no projeto ${PROJECT_REF}...\n`);

  // 1. SQL functions
  console.log("1. Criando funções upsert_leads_batch + upsert_customers_batch...");
  await runQuery(MIGRATION_SQL);
  console.log("   ✓ Funções criadas com sucesso\n");

  // 2. Connection pooler
  console.log("2. Verificando/habilitando connection pooler (Supavisor)...");
  await enablePooler();
  console.log("   ✓ Concluído\n");

  console.log("Migration aplicada. O CRM está pronto para usar as novas funções.");
}

main().catch((err) => {
  console.error("\nFalha:", err.message ?? err);
  process.exit(1);
});
