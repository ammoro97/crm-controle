import { promises as fs } from "fs";
import path from "path";
import { Lead } from "@/types/crm";
import { getSupabaseAdmin } from "./supabase-admin";

const STORAGE_TABLE = "crm_storage";
const PENDING_KEY_PREFIX = "leads-auto-pending-";
const RUNTIME_DATA_DIR = "/tmp/crm-data";

export type PendingAutomatedLeadEntry = {
  requestId: string;
  tipoAutomacao: "api" | "cnpj";
  leads: Lead[];
  savedAt: string;
};

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
      const { data, error } = await admin
        .from(STORAGE_TABLE)
        .select("key, value")
        .like("key", `${PENDING_KEY_PREFIX}%`);

      if (error) {
        console.error("[LEADS_AUTO] consume supabase select error", error.message);
      } else if (data && data.length > 0) {
        const keys = data.map((r) => r.key as string);
        await admin.from(STORAGE_TABLE).delete().in("key", keys);
        const entries = data.map((r) => r.value as PendingAutomatedLeadEntry);
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
      } catch {
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
