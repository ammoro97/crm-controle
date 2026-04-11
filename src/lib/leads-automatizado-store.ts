import { promises as fs } from "fs";
import path from "path";
import { Lead } from "@/types/crm";
import { getSupabaseAdmin } from "./supabase-admin";

const STORAGE_TABLE = "crm_storage";
const PENDING_KEY_PREFIX = "leads-auto-pending-";
const ACTIVE_IMPORT_KEY = "leads-auto-active-import";
const RUNTIME_DATA_DIR = "/tmp/crm-data";
const ACTIVE_IMPORT_FILE = "leads-auto-active-import.json";
const PENDING_READ_PAGE_SIZE = 200;
const PENDING_READ_MAX_PAGES = 25;
const ACTIVE_IMPORT_STALE_MS = 12 * 60 * 60 * 1000;

export type PendingAutomatedLeadEntry = {
  requestId: string;
  tipoAutomacao: "api" | "cnpj";
  leads: Lead[];
  savedAt: string;
};

export type ActiveAutomatedImport = {
  requestId: string;
  tipoAutomacao: "api" | "cnpj";
  status: "running";
  createdAt: string;
  updatedAt: string;
};

function buildAutomatedRequestId(): string {
  return `REQ-AUTO-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isActiveImportStale(entry: ActiveAutomatedImport): boolean {
  const updatedAt = Date.parse(String(entry.updatedAt || entry.createdAt || ""));
  if (!Number.isFinite(updatedAt)) return true;
  return Date.now() - updatedAt > ACTIVE_IMPORT_STALE_MS;
}

function normalizeActiveAutomatedImport(value: unknown): ActiveAutomatedImport | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const requestId = String(row.requestId || "").trim();
  const tipoAutomacao = row.tipoAutomacao === "cnpj" ? "cnpj" : row.tipoAutomacao === "api" ? "api" : null;
  const createdAt = String(row.createdAt || "").trim();
  const updatedAt = String(row.updatedAt || "").trim() || createdAt;
  if (!requestId || !tipoAutomacao || !createdAt) return null;
  return {
    requestId,
    tipoAutomacao,
    status: "running",
    createdAt,
    updatedAt,
  };
}

async function deleteActiveImportFromStorage(): Promise<void> {
  try {
    const admin = getSupabaseAdmin();
    if (admin) {
      await admin.from(STORAGE_TABLE).delete().eq("key", ACTIVE_IMPORT_KEY);
    }
  } catch (err) {
    console.error("[LEADS_AUTO] delete active import supabase exception", err instanceof Error ? err.message : err);
  }

  try {
    const filePath = path.join(RUNTIME_DATA_DIR, ACTIVE_IMPORT_FILE);
    await fs.unlink(filePath).catch(() => undefined);
  } catch (err) {
    console.error("[LEADS_AUTO] delete active import tmp exception", err instanceof Error ? err.message : err);
  }
}

export async function getActiveAutomatedImport(): Promise<ActiveAutomatedImport | null> {
  // 1. Supabase (fonte primaria)
  try {
    const admin = getSupabaseAdmin();
    if (admin) {
      const { data, error } = await admin
        .from(STORAGE_TABLE)
        .select("value")
        .eq("key", ACTIVE_IMPORT_KEY)
        .maybeSingle();

      if (!error) {
        const entry = normalizeActiveAutomatedImport(data?.value);
        if (entry && !isActiveImportStale(entry)) return entry;
        if (entry && isActiveImportStale(entry)) {
          await deleteActiveImportFromStorage();
          return null;
        }
      } else {
        console.error("[LEADS_AUTO] active import supabase read error", error.message);
      }
    }
  } catch (err) {
    console.error("[LEADS_AUTO] active import supabase read exception", err instanceof Error ? err.message : err);
  }

  // 2. /tmp fallback
  try {
    const filePath = path.join(RUNTIME_DATA_DIR, ACTIVE_IMPORT_FILE);
    const raw = await fs.readFile(filePath, "utf8").catch(() => "");
    if (!raw) return null;
    const entry = normalizeActiveAutomatedImport(JSON.parse(raw));
    if (!entry) return null;
    if (isActiveImportStale(entry)) {
      await deleteActiveImportFromStorage();
      return null;
    }
    return entry;
  } catch (err) {
    console.error("[LEADS_AUTO] active import tmp read exception", err instanceof Error ? err.message : err);
  }

  return null;
}

export async function acquireAutomatedImportLock(
  tipoAutomacao: "api" | "cnpj",
): Promise<{ acquired: true; entry: ActiveAutomatedImport } | { acquired: false; active: ActiveAutomatedImport }> {
  const active = await getActiveAutomatedImport();
  if (active) {
    return { acquired: false, active };
  }

  const nowIso = new Date().toISOString();
  const entry: ActiveAutomatedImport = {
    requestId: buildAutomatedRequestId(),
    tipoAutomacao,
    status: "running",
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  let saved = false;

  // 1. Supabase (fonte primaria)
  try {
    const admin = getSupabaseAdmin();
    if (admin) {
      const { error } = await admin.from(STORAGE_TABLE).upsert(
        { key: ACTIVE_IMPORT_KEY, value: entry, updated_at: nowIso },
        { onConflict: "key" },
      );
      if (!error) {
        saved = true;
      } else {
        console.error("[LEADS_AUTO] acquire lock supabase error", error.message);
      }
    }
  } catch (err) {
    console.error("[LEADS_AUTO] acquire lock supabase exception", err instanceof Error ? err.message : err);
  }

  // 2. /tmp fallback
  if (!saved) {
    try {
      await fs.mkdir(RUNTIME_DATA_DIR, { recursive: true });
      const filePath = path.join(RUNTIME_DATA_DIR, ACTIVE_IMPORT_FILE);
      await fs.writeFile(filePath, JSON.stringify(entry, null, 2), "utf8");
      saved = true;
    } catch (err) {
      console.error("[LEADS_AUTO] acquire lock tmp error", err instanceof Error ? err.message : err);
    }
  }

  if (!saved) {
    throw new Error("Nao foi possivel registrar o lock de importacao automatizada.");
  }

  return { acquired: true, entry };
}

export async function releaseAutomatedImportLock(): Promise<void> {
  await deleteActiveImportFromStorage();
}

// Cada chamada ao /retorno grava em sua propria chave unica no Supabase,
// eliminando a race condition de read-modify-write do array compartilhado.
export async function savePendingAutomatedLeads(entry: PendingAutomatedLeadEntry): Promise<void> {
  const key = `${PENDING_KEY_PREFIX}${entry.requestId}`;

  // 1. Supabase (fonte primaria)
  try {
    const admin = getSupabaseAdmin();
    if (admin) {
      const { error } = await admin.from(STORAGE_TABLE).upsert(
        { key, value: entry, updated_at: new Date().toISOString() },
        { onConflict: "key" },
      );
      if (!error) {
        console.log(`[LEADS_AUTO] save ok — supabase key=${key}`);
        return;
      }
      console.error(`[LEADS_AUTO] save supabase error key=${key}`, error.message);
    }
  } catch (err) {
    console.error(`[LEADS_AUTO] save supabase exception key=${key}`, err instanceof Error ? err.message : err);
  }

  // 2. /tmp fallback (instancia local / dev)
  try {
    await fs.mkdir(RUNTIME_DATA_DIR, { recursive: true });
    const filePath = path.join(RUNTIME_DATA_DIR, `${key}.json`);
    await fs.writeFile(filePath, JSON.stringify(entry, null, 2), "utf8");
    console.log(`[LEADS_AUTO] save ok — tmp key=${key}`);
  } catch (err) {
    console.error(`[LEADS_AUTO] save tmp failed key=${key}`, err instanceof Error ? err.message : err);
  }
}

// Le todas as entradas pendentes e as apaga atomicamente.
export async function consumePendingAutomatedLeads(): Promise<PendingAutomatedLeadEntry[]> {
  // 1. Supabase
  try {
    const admin = getSupabaseAdmin();
    if (admin) {
      const aggregatedRows: Array<{ key: string; value: PendingAutomatedLeadEntry }> = [];
      for (let page = 0; page < PENDING_READ_MAX_PAGES; page += 1) {
        const from = page * PENDING_READ_PAGE_SIZE;
        const to = from + PENDING_READ_PAGE_SIZE - 1;
        const { data, error } = await admin
          .from(STORAGE_TABLE)
          .select("key, value")
          .like("key", `${PENDING_KEY_PREFIX}%`)
          .order("key", { ascending: true })
          .range(from, to);

        if (error) {
          console.error("[LEADS_AUTO] consume supabase select error", error.message);
          return [];
        }
        if (!Array.isArray(data) || data.length === 0) break;
        aggregatedRows.push(
          ...data.map((row) => ({
            key: String(row.key || ""),
            value: row.value as PendingAutomatedLeadEntry,
          })),
        );
        if (data.length < PENDING_READ_PAGE_SIZE) break;
      }

      if (aggregatedRows.length > 0) {
        const keys = aggregatedRows.map((r) => r.key);
        await admin.from(STORAGE_TABLE).delete().in("key", keys);
        const entries = aggregatedRows.map((r) => r.value);
        console.log(`[LEADS_AUTO] consume ok — supabase entries=${entries.length} keys=${keys.join(",")}`);
        return entries;
      } else {
        console.log("[LEADS_AUTO] consume supabase — nenhuma entrada pendente");
        return [];
      }
    }
  } catch (err) {
    console.error("[LEADS_AUTO] consume supabase exception", err instanceof Error ? err.message : err);
  }

  // 2. /tmp fallback
  try {
    const files = await fs.readdir(RUNTIME_DATA_DIR).catch(() => [] as string[]);
    const pendingFiles = files.filter((f) => f.startsWith(PENDING_KEY_PREFIX) && f.endsWith(".json"));
    if (pendingFiles.length === 0) return [];

    const entries: PendingAutomatedLeadEntry[] = [];
    for (const file of pendingFiles) {
      const filePath = path.join(RUNTIME_DATA_DIR, file);
      try {
        const raw = await fs.readFile(filePath, "utf8");
        entries.push(JSON.parse(raw) as PendingAutomatedLeadEntry);
        await fs.unlink(filePath);
      } catch (_fileError) {
        // ignora arquivo corrompido
      }
    }
    console.log(`[LEADS_AUTO] consume ok — tmp entries=${entries.length}`);
    return entries;
  } catch (err) {
    console.error("[LEADS_AUTO] consume tmp exception", err instanceof Error ? err.message : err);
  }

  return [];
}
