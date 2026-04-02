import { createHash } from "crypto";
import type { CallLog } from "@/types/crm";
import { readDataFile, writeDataFile } from "./storage-paths";
import { getSupabaseAdmin } from "./supabase-admin";

const CALLS_TABLE = "crm_calls";
const CALLS_LEGACY_FILE = "call-logs.json";
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

  if (admin) {
    const { data, error } = await admin
      .from(CALLS_TABLE)
      .select("call_id,payload")
      .order("updated_at", { ascending: false });

    if (!error) {
      const rows = parseCallRows(data as unknown);
      if (rows.length > 0) {
        return toCallsFromRows(rows);
      }
    } else {
      console.error("[CALLS_TABLE] read error", error.message);
    }
  }

  const legacy = dedupeByCallId(asCallLogArray(await readDataFile<CallLog[]>(CALLS_LEGACY_FILE, [])));
  if (legacy.length > 0 && admin) {
    await writeCallLogsCollection(legacy);
    console.log(`[CALLS_TABLE] legacy migration completed count=${legacy.length}`);
  }
  return legacy;
}

export async function writeCallLogsCollection(calls: CallLog[]) {
  const normalized = dedupeByCallId(asCallLogArray(calls));
  const admin = getSupabaseAdmin();

  if (admin && normalized.length > 0) {
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
        break;
      }
    }
  }

  try {
    await writeDataFile(CALLS_LEGACY_FILE, normalized);
  } catch (error) {
    console.error("[CALLS_TABLE] legacy snapshot write error", error instanceof Error ? error.message : error);
  }
}
