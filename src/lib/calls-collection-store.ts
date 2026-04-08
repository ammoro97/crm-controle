import { createHash } from "crypto";
import type { CallLog } from "@/types/crm";
import { getSupabaseAdmin } from "./supabase-admin";
import { withTimeout } from "./server/with-timeout";

// Limite de registros carregados em memória por instância.
// Calls são ordenados por updated_at DESC — os 1000 mais recentes cobrem
// qualquer sessão ativa. Calls históricos permanecem no Supabase e não
// precisam estar em memória para leitura/escrita correntes.
const CALLS_READ_LIMIT = 1_000;
const CALLS_READ_TIMEOUT_MS = 10_000;

const CALLS_TABLE = "crm_calls";
const UPSERT_BATCH_SIZE = 500;

type CallTableRow = {
  call_id: string;
  payload: unknown;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function buildFallbackCallId(seed: unknown, index: number): string {
  const hash = createHash("sha1")
    .update(JSON.stringify(seed) || `empty-${index}`)
    .digest("hex")
    .slice(0, 16);
  return `legacy-call-${index}-${hash}`;
}

function normalizeCallId(rawId: unknown, seed: unknown, index: number): string {
  if (typeof rawId === "string") {
    const trimmed = rawId.trim();
    if (trimmed) return trimmed;
  }
  return buildFallbackCallId(seed, index);
}

function normalizeCallLog(value: unknown, index: number): CallLog | null {
  if (!isObjectRecord(value)) return null;
  const id = normalizeCallId(value.id, value, index);
  return {
    ...(value as CallLog),
    id,
  };
}

function asCallLogArray(value: unknown): CallLog[] {
  if (!Array.isArray(value)) return [];
  const normalized: CallLog[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const parsed = normalizeCallLog(value[index], index);
    if (parsed) normalized.push(parsed);
  }
  return normalized;
}

function dedupeByCallId(calls: CallLog[]): CallLog[] {
  const map = new Map<string, CallLog>();
  calls.forEach((call, index) => {
    const normalizedId = normalizeCallId(call.id, call, index);
    map.set(normalizedId, { ...call, id: normalizedId });
  });
  return Array.from(map.values());
}

function parseCallRows(value: unknown): CallTableRow[] {
  if (!Array.isArray(value)) return [];

  const rows: CallTableRow[] = [];
  for (const entry of value) {
    if (!isObjectRecord(entry)) continue;
    const callId = entry.call_id;
    if (typeof callId !== "string" || !callId.trim()) continue;
    rows.push({
      call_id: callId.trim(),
      payload: entry.payload,
    });
  }
  return rows;
}

function toCallsFromRows(rows: CallTableRow[]): CallLog[] {
  const calls = rows
    .map((row, index) => normalizeCallLog(row.payload, index))
    .filter((call): call is CallLog => call !== null)
    .map((call, index) => ({
      ...call,
      id: normalizeCallId(call.id, call, index),
    }));

  return dedupeByCallId(calls);
}


export async function readCallLogsCollection(): Promise<CallLog[]> {
  const admin = getSupabaseAdmin();
  if (!admin) return [];

  const startedAt = Date.now();
  try {
    const { data, error } = await withTimeout(
      Promise.resolve(
        admin
          .from(CALLS_TABLE)
          .select("call_id,payload")
          .order("updated_at", { ascending: false })
          .limit(CALLS_READ_LIMIT),
      ),
      CALLS_READ_TIMEOUT_MS,
      "readCallLogsCollection",
    );

    if (error) {
      console.error(`[CALLS_TABLE] read error elapsed=${Date.now() - startedAt}ms`, error.message);
      return [];
    }

    console.log(`[CALLS_TABLE] read ok rows=${(data as unknown[])?.length ?? 0} elapsed=${Date.now() - startedAt}ms`);
    const rows = parseCallRows(data as unknown);
    return toCallsFromRows(rows);
  } catch (err) {
    const isTimeout = err instanceof Error && err.message.startsWith("TIMEOUT:");
    console.error(`[CALLS_TABLE] ${isTimeout ? "timeout" : "exception"} elapsed=${Date.now() - startedAt}ms`, isTimeout ? "" : err);
    return [];
  }
}

/**
 * Lê uma página de call logs, ordenados por updated_at DESC.
 * Retorna `calls` (até `limit` itens) e `hasMore` (detectado via +1 trick).
 */
export async function readCallLogsPage(options: {
  limit: number;
  offset: number;
}): Promise<{ calls: CallLog[]; hasMore: boolean }> {
  const admin = getSupabaseAdmin();
  if (!admin) return { calls: [], hasMore: false };

  const fetchLimit = options.limit + 1;
  const startedAt = Date.now();

  try {
    const { data, error } = await withTimeout(
      Promise.resolve(
        admin
          .from(CALLS_TABLE)
          .select("call_id,payload")
          .order("updated_at", { ascending: false })
          .range(options.offset, options.offset + fetchLimit - 1),
      ),
      CALLS_READ_TIMEOUT_MS,
      `readCallLogsPage:offset=${options.offset}`,
    );

    if (error) {
      console.error(`[CALLS_TABLE] page error offset=${options.offset} elapsed=${Date.now() - startedAt}ms`, error.message);
      return { calls: [], hasMore: false };
    }

    const rows = parseCallRows(data as unknown);
    const hasMore = rows.length > options.limit;
    const pageRows = hasMore ? rows.slice(0, options.limit) : rows;

    console.log(`[CALLS_TABLE] page ok offset=${options.offset} rows=${pageRows.length} hasMore=${hasMore} elapsed=${Date.now() - startedAt}ms`);
    return { calls: toCallsFromRows(pageRows), hasMore };
  } catch (err) {
    const isTimeout = err instanceof Error && err.message.startsWith("TIMEOUT:");
    console.error(`[CALLS_TABLE] page ${isTimeout ? "timeout" : "exception"} offset=${options.offset} elapsed=${Date.now() - startedAt}ms`, isTimeout ? "" : err);
    return { calls: [], hasMore: false };
  }
}

export async function writeCallLogsCollection(calls: CallLog[]) {
  const normalized = dedupeByCallId(asCallLogArray(calls));
  await upsertCallLogsRows(normalized);
}

export async function upsertCallLogsRows(calls: CallLog[]) {
  const normalized = dedupeByCallId(asCallLogArray(calls));
  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new Error("SUPABASE_REQUIRED_FOR_CALLS_PERSISTENCE");
  }

  if (normalized.length > 0) {
    const nowIso = new Date().toISOString();
    const rows = normalized.map((call) => ({
      call_id: call.id,
      lead_id: call.leadId || null,
      external_call_id: call.externalCallId || null,
      session_id: call.sessionId || null,
      started_at: call.startedAt || null,
      status: call.status || null,
      payload: call,
      updated_at: nowIso,
    }));

    for (let index = 0; index < rows.length; index += UPSERT_BATCH_SIZE) {
      const chunk = rows.slice(index, index + UPSERT_BATCH_SIZE);
      const { error } = await admin.from(CALLS_TABLE).upsert(chunk, { onConflict: "call_id" });
      if (error) {
        console.error("[CALLS_TABLE] upsert error", error.message);
        throw new Error("CALLS_TABLE_UPSERT_FAILED");
      }
    }
  }
}
