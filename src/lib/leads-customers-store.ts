import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Lead, Meeting } from "@/types/crm";
import { getSupabaseAdmin } from "./supabase-admin";
import { withTimeout } from "./server/with-timeout";

const LEADS_READ_TIMEOUT_MS = 12_000;

type LeadTableName = "crm_leads" | "crm_customers";

type LeadTableRow = {
  lead_id: string;
  payload: unknown;
};

const LEADS_TABLE: LeadTableName = "crm_leads";
const CUSTOMERS_TABLE: LeadTableName = "crm_customers";
const DELETE_BATCH_SIZE = 500;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function buildFallbackLeadId(seed: unknown, index: number): string {
  const hash = createHash("sha1")
    .update(JSON.stringify(seed) || `empty-${index}`)
    .digest("hex")
    .slice(0, 16);
  return `legacy-${index}-${hash}`;
}

function normalizeLeadId(rawId: unknown, seed: unknown, index: number): string {
  if (typeof rawId === "string") {
    const trimmed = rawId.trim();
    if (trimmed) return trimmed;
  }
  return buildFallbackLeadId(seed, index);
}

function normalizeLead(value: unknown, index: number): Lead | null {
  if (!isObjectRecord(value)) return null;
  const id = normalizeLeadId(value.id, value, index);
  return {
    ...(value as Lead),
    id,
  };
}

function asLeadArray(value: unknown): Lead[] {
  if (!Array.isArray(value)) return [];
  const normalized: Lead[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const parsed = normalizeLead(value[index], index);
    if (parsed) normalized.push(parsed);
  }
  return normalized;
}

function dedupeByLeadId(leads: Lead[]): Lead[] {
  const map = new Map<string, Lead>();
  leads.forEach((lead, index) => {
    const normalizedId = normalizeLeadId(lead.id, lead, index);
    map.set(normalizedId, { ...lead, id: normalizedId });
  });
  return Array.from(map.values());
}

function parseLeadTableRows(value: unknown): LeadTableRow[] {
  if (!Array.isArray(value)) return [];

  const rows: LeadTableRow[] = [];
  for (const entry of value) {
    if (!isObjectRecord(entry)) continue;
    const leadId = entry.lead_id;
    if (typeof leadId !== "string" || !leadId.trim()) continue;
    rows.push({
      lead_id: leadId.trim(),
      payload: entry.payload,
    });
  }
  return rows;
}

function parseLeadIdRows(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!isObjectRecord(entry)) return "";
      const leadId = entry.lead_id;
      return typeof leadId === "string" ? leadId.trim() : "";
    })
    .filter(Boolean);
}

function toLeadsFromRows(rows: LeadTableRow[]): Lead[] {
  const leads = rows
    .map((row, index) => normalizeLead(row.payload, index))
    .filter((lead): lead is Lead => lead !== null)
    .map((lead, index) => ({
      ...lead,
      id: normalizeLeadId(lead.id, lead, index),
    }));

  return dedupeByLeadId(leads);
}

async function listLeadIds(admin: SupabaseClient, tableName: LeadTableName): Promise<string[] | null> {
  const { data, error } = await admin.from(tableName).select("lead_id");
  if (error) {
    console.error(`[LEAD_TABLE] list ids error table=${tableName}`, error.message);
    return null;
  }
  return parseLeadIdRows(data as unknown);
}

async function deleteLeadIds(admin: SupabaseClient, tableName: LeadTableName, ids: string[]) {
  if (ids.length === 0) return;
  for (let index = 0; index < ids.length; index += DELETE_BATCH_SIZE) {
    const chunk = ids.slice(index, index + DELETE_BATCH_SIZE);
    const { error } = await admin.from(tableName).delete().in("lead_id", chunk);
    if (error) {
      console.error(`[LEAD_TABLE] delete stale rows error table=${tableName}`, error.message);
      return;
    }
  }
}

async function upsertLeadsIntoTable(admin: SupabaseClient, tableName: LeadTableName, leads: Lead[]): Promise<boolean> {
  const dedupedLeads = dedupeByLeadId(leads);
  const nowIso = new Date().toISOString();

  if (dedupedLeads.length === 0) return true;

  const rows = dedupedLeads.map((lead) => ({
    lead_id: lead.id,
    payload: lead,
    updated_at: nowIso,
  }));
  const { error } = await admin.from(tableName).upsert(rows, { onConflict: "lead_id" });
  if (error) {
    console.error(`[LEAD_TABLE] upsert error table=${tableName}`, error.message);
    return false;
  }
  return true;
}

async function readFromTable(tableName: LeadTableName): Promise<Lead[] | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;

  const startedAt = Date.now();
  try {
    const { data, error } = await withTimeout(
      Promise.resolve(
        admin
          .from(tableName)
          .select("lead_id,payload")
          .order("updated_at", { ascending: false }),
      ),
      LEADS_READ_TIMEOUT_MS,
      `readFromTable:${tableName}`,
    );

    if (error) {
      console.error(`[LEAD_TABLE] read error table=${tableName} elapsed=${Date.now() - startedAt}ms`, error.message);
      return null;
    }

    console.log(`[LEAD_TABLE] read ok table=${tableName} rows=${(data as unknown[])?.length ?? 0} elapsed=${Date.now() - startedAt}ms`);
    const rows = parseLeadTableRows(data as unknown);
    return toLeadsFromRows(rows);
  } catch (err) {
    const isTimeout = err instanceof Error && err.message.startsWith("TIMEOUT:");
    console.error(`[LEAD_TABLE] ${isTimeout ? "timeout" : "exception"} table=${tableName} elapsed=${Date.now() - startedAt}ms`, isTimeout ? "" : err);
    return null;
  }
}

async function writeToTable(tableName: LeadTableName, leads: Lead[]): Promise<boolean> {
  const admin = getSupabaseAdmin();
  if (!admin) return false;
  return upsertLeadsIntoTable(admin, tableName, leads);
}

async function readCollection(tableName: LeadTableName): Promise<Lead[]> {
  const tableLeads = await readFromTable(tableName);
  return tableLeads ?? [];
}

async function writeCollection(tableName: LeadTableName, leads: Lead[]) {
  const normalized = dedupeByLeadId(asLeadArray(leads));

  if (tableName === LEADS_TABLE && normalized.length === 0) {
    const current = await readFromTable(tableName);
    if (current && current.length > 0) {
      console.error("[LEAD_TABLE] bloqueado snapshot vazio para crm_leads (protecao anti-wipe)");
      throw new Error("LEADS_EMPTY_SNAPSHOT_BLOCKED");
    }
  }

  const tableWriteOk = await writeToTable(tableName, normalized);

  if (!tableWriteOk) {
    throw new Error(`SUPABASE_REQUIRED_FOR_${tableName.toUpperCase()}_PERSISTENCE`);
  }
}

export async function readLeadsCollection() {
  return readCollection(LEADS_TABLE);
}

/**
 * Lê uma página de leads da tabela, ordenados por updated_at DESC.
 * Retorna `leads` (até `limit` itens) e `hasMore` (se existem mais páginas).
 *
 * Internamente busca `limit + 1` registros: se o DB retornar `limit + 1`,
 * há mais páginas sem precisar de uma query COUNT separada.
 */
export async function readLeadsPage(options: {
  limit: number;
  offset: number;
}): Promise<{ leads: Lead[]; hasMore: boolean }> {
  const admin = getSupabaseAdmin();
  if (!admin) return { leads: [], hasMore: false };

  const fetchLimit = options.limit + 1; // +1 para detectar hasMore sem COUNT
  const startedAt = Date.now();

  try {
    const { data, error } = await withTimeout(
      Promise.resolve(
        admin
          .from(LEADS_TABLE)
          .select("lead_id,payload")
          .order("updated_at", { ascending: false })
          .range(options.offset, options.offset + fetchLimit - 1),
      ),
      LEADS_READ_TIMEOUT_MS,
      `readLeadsPage:offset=${options.offset}`,
    );

    if (error) {
      console.error(`[LEAD_TABLE] page error offset=${options.offset} elapsed=${Date.now() - startedAt}ms`, error.message);
      return { leads: [], hasMore: false };
    }

    const rows = parseLeadTableRows(data as unknown);
    const hasMore = rows.length > options.limit;
    const pageRows = hasMore ? rows.slice(0, options.limit) : rows;

    console.log(`[LEAD_TABLE] page ok offset=${options.offset} rows=${pageRows.length} hasMore=${hasMore} elapsed=${Date.now() - startedAt}ms`);
    return { leads: toLeadsFromRows(pageRows), hasMore };
  } catch (err) {
    const isTimeout = err instanceof Error && err.message.startsWith("TIMEOUT:");
    console.error(`[LEAD_TABLE] page ${isTimeout ? "timeout" : "exception"} offset=${options.offset} elapsed=${Date.now() - startedAt}ms`, isTimeout ? "" : err);
    return { leads: [], hasMore: false };
  }
}

export async function writeLeadsCollection(leads: Lead[]) {
  return writeCollection(LEADS_TABLE, leads);
}

export async function readCustomersCollection() {
  return readCollection(CUSTOMERS_TABLE);
}

export async function writeCustomersCollection(customers: Lead[]) {
  return writeCollection(CUSTOMERS_TABLE, customers);
}

export async function deleteLeadsFromCollection(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const admin = getSupabaseAdmin();
  if (!admin) return;
  await deleteLeadIds(admin, LEADS_TABLE, ids);
}

export async function deleteCustomersFromCollection(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const admin = getSupabaseAdmin();
  if (!admin) return;
  await deleteLeadIds(admin, CUSTOMERS_TABLE, ids);
}

export type LeadArchiveEntry = {
  lead: Lead;
  meetings?: Meeting[];
  finalizadoEm: string;
  motivo: string;
};

/**
 * Arquiva leads na tabela `leads_finalizados` antes de removê-los da base ativa.
 * A operação é insert-first: se o insert falhar, lança erro e o delete não ocorre.
 *
 * SQL necessário (rodar uma vez no Supabase):
 *
 *   CREATE TABLE leads_finalizados (
 *     id            BIGSERIAL PRIMARY KEY,
 *     lead_id       TEXT NOT NULL,
 *     payload       JSONB NOT NULL,
 *     finalizado_em TIMESTAMPTZ NOT NULL,
 *     motivo        TEXT NOT NULL DEFAULT 'finalizado_apagar',
 *     created_at    TIMESTAMPTZ DEFAULT NOW()
 *   );
 *   CREATE INDEX idx_leads_finalizados_lead_id ON leads_finalizados(lead_id);
 *   CREATE INDEX idx_leads_finalizados_finalizado_em ON leads_finalizados(finalizado_em);
 */
export async function archiveLeadsToHistory(entries: LeadArchiveEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error("SUPABASE_REQUIRED_FOR_ARCHIVE");

  const rows = entries.map(({ lead, meetings, finalizadoEm, motivo }) => ({
    lead_id: lead.id,
    payload: { ...lead, _meetings: meetings ?? [] },
    finalizado_em: finalizadoEm,
    motivo,
  }));

  const { error } = await admin.from("leads_finalizados").insert(rows);
  if (error) throw new Error(`ARCHIVE_INSERT_FAILED: ${error.message}`);

  // Só deleta da tabela ativa após confirmar o insert
  await deleteLeadIds(admin, LEADS_TABLE, entries.map((e) => e.lead.id));
}
