import { createHash } from "crypto";
import { unstable_cache, revalidateTag } from "next/cache";
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
const READ_PAGE_SIZE = 1_000;
const MAX_READ_PAGES = 200;

const LEADS_CACHE_TAG = "crm-leads";
const CUSTOMERS_CACHE_TAG = "crm-customers";
const CACHE_REVALIDATE_SECONDS = 60;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function reportLeadTableError(context: string, details?: unknown) {
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.error(`[LEAD_TABLE] ${context}`, details);
  }
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

function cloneLeadArray(leads: Lead[]): Lead[] {
  return leads.map((lead) => ({ ...lead }));
}

function invalidateCollectionCache(tableName: LeadTableName) {
  revalidateTag(tableName === LEADS_TABLE ? LEADS_CACHE_TAG : CUSTOMERS_CACHE_TAG);
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


async function deleteLeadIds(admin: SupabaseClient, tableName: LeadTableName, ids: string[]) {
  if (ids.length === 0) return;
  for (let index = 0; index < ids.length; index += DELETE_BATCH_SIZE) {
    const chunk = ids.slice(index, index + DELETE_BATCH_SIZE);
    const { error } = await admin.from(tableName).delete().in("lead_id", chunk);
    if (error) {
      reportLeadTableError(`delete stale rows error table=${tableName}`, error.message);
      return;
    }
  }
}

async function upsertLeadsIntoTable(admin: SupabaseClient, tableName: LeadTableName, leads: Lead[]): Promise<boolean> {
  const dedupedLeads = dedupeByLeadId(leads);
  if (dedupedLeads.length === 0) return true;

  const rpcName = tableName === LEADS_TABLE ? "upsert_leads_batch" : "upsert_customers_batch";
  const nowIso = new Date().toISOString();
  const rows = dedupedLeads.map((lead) => ({
    lead_id: lead.id,
    payload: lead,
    updated_at: nowIso,
  }));

  for (let index = 0; index < rows.length; index += DELETE_BATCH_SIZE) {
    const chunk = rows.slice(index, index + DELETE_BATCH_SIZE);
    const { error } = await admin.rpc(rpcName, { rows: chunk });
    if (error) {
      reportLeadTableError(`upsert rpc error table=${tableName}`, error.message);
      return false;
    }
  }
  return true;
}

async function readFromTable(tableName: LeadTableName): Promise<Lead[] | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;

  const startedAt = Date.now();
  try {
    const rows: LeadTableRow[] = [];
    for (let page = 0; page < MAX_READ_PAGES; page += 1) {
      const from = page * READ_PAGE_SIZE;
      const to = from + READ_PAGE_SIZE - 1;
      const { data, error } = await withTimeout(
        Promise.resolve(
          admin
            .from(tableName)
            .select("lead_id,payload")
            .order("updated_at", { ascending: false })
            .order("lead_id", { ascending: true })
            .range(from, to),
        ),
        LEADS_READ_TIMEOUT_MS,
        `readFromTable:${tableName}:page=${page}`,
      );

      if (error) {
        reportLeadTableError(
          `read error table=${tableName} page=${page} elapsed=${Date.now() - startedAt}ms`,
          error.message,
        );
        return null;
      }

      const pageRows = parseLeadTableRows(data as unknown);
      if (pageRows.length === 0) break;
      rows.push(...pageRows);
      if (pageRows.length < READ_PAGE_SIZE) break;
    }

    return toLeadsFromRows(rows);
  } catch (err) {
    const isTimeout = err instanceof Error && err.message.startsWith("TIMEOUT:");
    reportLeadTableError(
      `${isTimeout ? "timeout" : "exception"} table=${tableName} elapsed=${Date.now() - startedAt}ms`,
      isTimeout ? "" : err,
    );
    return null;
  }
}

async function writeToTable(tableName: LeadTableName, leads: Lead[]): Promise<boolean> {
  const admin = getSupabaseAdmin();
  if (!admin) return false;
  return upsertLeadsIntoTable(admin, tableName, leads);
}

const readLeadsFromTableCached = unstable_cache(
  () => readFromTable(LEADS_TABLE),
  ["crm-leads-collection"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: [LEADS_CACHE_TAG] },
);

const readCustomersFromTableCached = unstable_cache(
  () => readFromTable(CUSTOMERS_TABLE),
  ["crm-customers-collection"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: [CUSTOMERS_CACHE_TAG] },
);

async function readCollection(tableName: LeadTableName): Promise<Lead[]> {
  const leads =
    tableName === LEADS_TABLE
      ? await readLeadsFromTableCached()
      : await readCustomersFromTableCached();
  return cloneLeadArray(leads ?? []);
}

async function writeCollection(tableName: LeadTableName, leads: Lead[]) {
  const normalized = dedupeByLeadId(asLeadArray(leads));

  if (tableName === LEADS_TABLE && normalized.length === 0) {
    const current = await readFromTable(tableName);
    if (current && current.length > 0) {
      reportLeadTableError("bloqueado snapshot vazio para crm_leads (protecao anti-wipe)");
      throw new Error("LEADS_EMPTY_SNAPSHOT_BLOCKED");
    }
  }

  const tableWriteOk = await writeToTable(tableName, normalized);

  if (!tableWriteOk) {
    throw new Error(`SUPABASE_REQUIRED_FOR_${tableName.toUpperCase()}_PERSISTENCE`);
  }

  revalidateTag(tableName === LEADS_TABLE ? LEADS_CACHE_TAG : CUSTOMERS_CACHE_TAG);
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
}): Promise<{ leads: Lead[]; hasMore: boolean; sourceHealthy: boolean }> {
  const admin = getSupabaseAdmin();
  if (!admin) return { leads: [], hasMore: false, sourceHealthy: false };

  const fetchLimit = options.limit + 1; // +1 para detectar hasMore sem COUNT
  const startedAt = Date.now();

  try {
    const { data, error } = await withTimeout(
      Promise.resolve(
        admin
          .from(LEADS_TABLE)
          .select("lead_id,payload")
          .order("updated_at", { ascending: false })
          .order("lead_id", { ascending: true })
          .range(options.offset, options.offset + fetchLimit - 1),
      ),
      LEADS_READ_TIMEOUT_MS,
      `readLeadsPage:offset=${options.offset}`,
    );

    if (error) {
      reportLeadTableError(`page error offset=${options.offset} elapsed=${Date.now() - startedAt}ms`, error.message);
      return { leads: [], hasMore: false, sourceHealthy: false };
    }

    const rows = parseLeadTableRows(data as unknown);
    const hasMore = rows.length > options.limit;
    const pageRows = hasMore ? rows.slice(0, options.limit) : rows;

    return { leads: toLeadsFromRows(pageRows), hasMore, sourceHealthy: true };
  } catch (err) {
    const isTimeout = err instanceof Error && err.message.startsWith("TIMEOUT:");
    reportLeadTableError(
      `page ${isTimeout ? "timeout" : "exception"} offset=${options.offset} elapsed=${Date.now() - startedAt}ms`,
      isTimeout ? "" : err,
    );
    return { leads: [], hasMore: false, sourceHealthy: false };
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
  invalidateCollectionCache(LEADS_TABLE);
}

export async function deleteCustomersFromCollection(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const admin = getSupabaseAdmin();
  if (!admin) return;
  await deleteLeadIds(admin, CUSTOMERS_TABLE, ids);
  invalidateCollectionCache(CUSTOMERS_TABLE);
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
  invalidateCollectionCache(LEADS_TABLE);
}
