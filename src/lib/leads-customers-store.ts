import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Lead } from "@/types/crm";
import { initialLeads } from "@/lib/mock-data";
import { readDataFile, writeDataFile } from "./storage-paths";
import { getSupabaseAdmin } from "./supabase-admin";

type LeadTableName = "crm_leads" | "crm_customers";

type LeadTableRow = {
  lead_id: string;
  payload: unknown;
};

const LEADS_TABLE: LeadTableName = "crm_leads";
const CUSTOMERS_TABLE: LeadTableName = "crm_customers";
const LEADS_LEGACY_FILE = "crm.leads.v1.json";
const CUSTOMERS_LEGACY_FILE = "crm.customers.v1.json";
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

  if (dedupedLeads.length > 0) {
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
  }

  const existingIds = await listLeadIds(admin, tableName);
  if (!existingIds) return dedupedLeads.length > 0;

  const keepIds = new Set(dedupedLeads.map((lead) => lead.id));
  const staleIds = existingIds.filter((leadId) => !keepIds.has(leadId));
  await deleteLeadIds(admin, tableName, staleIds);
  return true;
}

async function readFromTable(tableName: LeadTableName): Promise<Lead[] | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;

  const { data, error } = await admin
    .from(tableName)
    .select("lead_id,payload")
    .order("updated_at", { ascending: false });

  if (error) {
    console.error(`[LEAD_TABLE] read error table=${tableName}`, error.message);
    return null;
  }

  const rows = parseLeadTableRows(data as unknown);
  return toLeadsFromRows(rows);
}

async function writeToTable(tableName: LeadTableName, leads: Lead[]): Promise<boolean> {
  const admin = getSupabaseAdmin();
  if (!admin) return false;
  return upsertLeadsIntoTable(admin, tableName, leads);
}

async function readCollectionWithFallback(tableName: LeadTableName, legacyFile: string): Promise<Lead[]> {
  const tableLeads = await readFromTable(tableName);
  if (tableLeads && tableLeads.length > 0) {
    return tableLeads;
  }

  const legacyLeads = dedupeByLeadId(asLeadArray(await readDataFile<Lead[]>(legacyFile, [])));
  if (legacyLeads.length > 0) {
    if (tableLeads !== null) {
      const migrated = await writeToTable(tableName, legacyLeads);
      if (migrated) {
        console.log(`[LEAD_TABLE] legacy migration completed table=${tableName} count=${legacyLeads.length}`);
      }
    }
    return legacyLeads;
  }

  if (tableName === LEADS_TABLE) {
    const bootstrapLeads = dedupeByLeadId(asLeadArray(initialLeads));
    if (bootstrapLeads.length > 0) {
      if (tableLeads !== null) {
        const seeded = await writeToTable(tableName, bootstrapLeads);
        if (seeded) {
          console.log(`[LEAD_TABLE] bootstrap seed completed table=${tableName} count=${bootstrapLeads.length}`);
        }
      }
      try {
        await writeDataFile(legacyFile, bootstrapLeads);
      } catch (error) {
        console.error(
          `[LEAD_TABLE] bootstrap legacy snapshot write error file=${legacyFile}`,
          error instanceof Error ? error.message : error,
        );
      }
      return bootstrapLeads;
    }
  }

  return tableLeads ?? [];
}

async function writeCollection(tableName: LeadTableName, legacyFile: string, leads: Lead[]) {
  const normalized = dedupeByLeadId(asLeadArray(leads));
  const tableWriteOk = await writeToTable(tableName, normalized);

  try {
    await writeDataFile(legacyFile, normalized);
  } catch (error) {
    console.error(
      `[LEAD_TABLE] legacy snapshot write error file=${legacyFile}`,
      error instanceof Error ? error.message : error,
    );
  }

  if (!tableWriteOk) {
    console.warn(`[LEAD_TABLE] write fallback-only table=${tableName}`);
  }
}

export async function readLeadsCollection() {
  return readCollectionWithFallback(LEADS_TABLE, LEADS_LEGACY_FILE);
}

export async function writeLeadsCollection(leads: Lead[]) {
  return writeCollection(LEADS_TABLE, LEADS_LEGACY_FILE, leads);
}

export async function readCustomersCollection() {
  return readCollectionWithFallback(CUSTOMERS_TABLE, CUSTOMERS_LEGACY_FILE);
}

export async function writeCustomersCollection(customers: Lead[]) {
  return writeCollection(CUSTOMERS_TABLE, CUSTOMERS_LEGACY_FILE, customers);
}
