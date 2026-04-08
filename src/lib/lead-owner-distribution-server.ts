import type { Lead } from "@/types/crm";
import { getSupabaseAdmin } from "./supabase-admin";
import { distributeLeadOwners } from "./lead-owner-distribution";

type ResponsavelRow = {
  nome?: string | null;
  tipo?: string | null;
};

function normalizeResponsavelName(value?: string | null) {
  return String(value || "").trim();
}

function parseResponsavelRows(raw: unknown): ResponsavelRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((row) => typeof row === "object" && row !== null) as ResponsavelRow[];
}

async function loadEligibleOwnersFromDatabase() {
  const admin = getSupabaseAdmin();
  if (!admin) return [];

  const RESPONSAVEIS_LIMIT = 1_000;
  const { data, error } = await admin
    .from("crm_responsaveis")
    .select("nome,tipo")
    .order("nome", { ascending: true })
    .limit(RESPONSAVEIS_LIMIT);

  if (error) {
    console.error("[LEAD_OWNER_DISTRIBUTION] erro ao carregar responsaveis", error.message);
    return [];
  }

  const rows = parseResponsavelRows(data as unknown);
  const vendedores = rows
    .filter((row) => String(row.tipo || "").trim().toLowerCase() === "vendedor")
    .map((row) => normalizeResponsavelName(row.nome))
    .filter(Boolean);

  if (vendedores.length > 0) return vendedores;

  return rows.map((row) => normalizeResponsavelName(row.nome)).filter(Boolean);
}

type DistributeFromDatabaseParams = {
  incomingLeads: Lead[];
  existingLeads: Lead[];
};

export async function distributeLeadOwnersFromDatabase(params: DistributeFromDatabaseParams) {
  const eligibleOwners = await loadEligibleOwnersFromDatabase();
  return distributeLeadOwners({
    incomingLeads: params.incomingLeads,
    existingLeads: params.existingLeads,
    eligibleOwners,
  });
}
