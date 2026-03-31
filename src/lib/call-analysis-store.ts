import { promises as fs } from "fs";
import path from "path";
import {
  CallAnalysisObservationRecord,
  CallAnalysisRequestRecord,
  CallAnalysisRequestStatus,
} from "@/types/call-analysis";

const DATA_DIR = path.join(process.cwd(), "data");
const REQUESTS_FILE = path.join(DATA_DIR, "call-analysis-requests.json");
const OBSERVATIONS_FILE = path.join(DATA_DIR, "lead-ai-observations.json");
const ANALISE_IA_DEBUG_PREFIX = "[ANALISE_IA_STORE]";

const volatileRequests = new Map<string, CallAnalysisRequestRecord>();
const volatileObservations = new Map<string, CallAnalysisObservationRecord>();

function nowIso() {
  return new Date().toISOString();
}

function normalizePhoneDigits(value?: string | null) {
  const digits = String(value || "").replace(/\D/g, "");
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    return digits.slice(2);
  }
  return digits;
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readJsonArrayFile<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as T[];
  } catch {
    return [];
  }
}

async function writeJsonArrayFile<T>(filePath: string, rows: T[]) {
  await ensureDataDir();
  await fs.writeFile(filePath, JSON.stringify(rows, null, 2), "utf8");
}

async function safeWriteJsonArrayFile<T>(filePath: string, rows: T[]) {
  try {
    await writeJsonArrayFile(filePath, rows);
    return true;
  } catch (error) {
    console.warn(`${ANALISE_IA_DEBUG_PREFIX} write_failed`, {
      filePath,
      message: error instanceof Error ? error.message : "erro desconhecido",
    });
    return false;
  }
}

function normalizeRequest(input: CallAnalysisRequestRecord): CallAnalysisRequestRecord {
  return {
    ...input,
    requestId: String(input.requestId || "").trim(),
    callId: String(input.callId || "").trim(),
    leadId: String(input.leadId || "").trim(),
    phoneDigits: normalizePhoneDigits(input.phoneDigits),
    externalCallId: String(input.externalCallId || "").trim() || null,
    sessionId: String(input.sessionId || "").trim() || null,
    triggeredAt: String(input.triggeredAt || nowIso()).trim(),
    status: (input.status || "processing") as CallAnalysisRequestStatus,
    observationId: String(input.observationId || "").trim() || null,
    analysisText: String(input.analysisText || "").trim() || null,
    errorMessage: String(input.errorMessage || "").trim() || null,
    completedAt: String(input.completedAt || "").trim() || null,
  };
}

function normalizeObservation(input: CallAnalysisObservationRecord): CallAnalysisObservationRecord {
  const createdAt = String(input.createdAt || nowIso()).trim();
  const date = String(input.date || createdAt.slice(0, 10)).trim();
  const time = String(input.time || "00:00").trim();
  return {
    ...input,
    id: String(input.id || "").trim(),
    leadId: String(input.leadId || "").trim(),
    callId: String(input.callId || "").trim(),
    requestId: String(input.requestId || "").trim(),
    owner: String(input.owner || "Analise da IA").trim() || "Analise da IA",
    type: "analise ia",
    content: String(input.content || "").trim(),
    date,
    time,
    createdAt,
    updatedAt: String(input.updatedAt || createdAt).trim(),
  };
}

export async function getCallAnalysisRequests() {
  const rows = await readJsonArrayFile<CallAnalysisRequestRecord>(REQUESTS_FILE);
  const normalizedDisk = rows
    .map((row) => normalizeRequest(row))
    .filter((row) => row.requestId && row.callId && row.leadId && row.phoneDigits)
    .sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt));
  const merged = new Map<string, CallAnalysisRequestRecord>();
  for (const row of normalizedDisk) {
    merged.set(row.requestId, row);
  }
  for (const row of volatileRequests.values()) {
    merged.set(row.requestId, row);
  }
  return Array.from(merged.values()).sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt));
}

export async function getCallAnalysisRequestById(requestId: string) {
  const normalized = String(requestId || "").trim();
  if (!normalized) return null;
  const rows = await getCallAnalysisRequests();
  return rows.find((row) => row.requestId === normalized) || null;
}

export async function saveCallAnalysisRequest(record: CallAnalysisRequestRecord) {
  const normalized = normalizeRequest(record);
  if (!normalized.requestId || !normalized.callId || !normalized.leadId || !normalized.phoneDigits) {
    throw new Error("CALL_ANALYSIS_REQUEST_INVALID");
  }

  const rows = await getCallAnalysisRequests();
  const index = rows.findIndex((row) => row.requestId === normalized.requestId);
  const next = [...rows];
  if (index >= 0) {
    next[index] = normalized;
  } else {
    next.unshift(normalized);
  }
  volatileRequests.set(normalized.requestId, normalized);
  const persisted = await safeWriteJsonArrayFile(REQUESTS_FILE, next);
  if (persisted) {
    volatileRequests.delete(normalized.requestId);
  }
  return normalized;
}

export async function updateCallAnalysisRequest(
  requestId: string,
  patch: Partial<Omit<CallAnalysisRequestRecord, "requestId">>,
) {
  const normalizedRequestId = String(requestId || "").trim();
  if (!normalizedRequestId) return null;
  const rows = await getCallAnalysisRequests();
  const index = rows.findIndex((row) => row.requestId === normalizedRequestId);
  if (index < 0) return null;
  const updated = normalizeRequest({
    ...rows[index],
    ...patch,
    requestId: normalizedRequestId,
  });
  const next = [...rows];
  next[index] = updated;
  volatileRequests.set(updated.requestId, updated);
  const persisted = await safeWriteJsonArrayFile(REQUESTS_FILE, next);
  if (persisted) {
    volatileRequests.delete(updated.requestId);
  }
  return updated;
}

export async function getCallAnalysisObservations() {
  const rows = await readJsonArrayFile<CallAnalysisObservationRecord>(OBSERVATIONS_FILE);
  const normalizedDisk = rows
    .map((row) => normalizeObservation(row))
    .filter((row) => row.id && row.leadId && row.callId && row.requestId && row.content)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const merged = new Map<string, CallAnalysisObservationRecord>();
  for (const row of normalizedDisk) {
    merged.set(row.id, row);
  }
  for (const row of volatileObservations.values()) {
    merged.set(row.id, row);
  }
  return Array.from(merged.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveCallAnalysisObservation(observation: CallAnalysisObservationRecord) {
  const normalized = normalizeObservation(observation);
  if (!normalized.id || !normalized.leadId || !normalized.callId || !normalized.requestId || !normalized.content) {
    throw new Error("CALL_ANALYSIS_OBSERVATION_INVALID");
  }

  const rows = await getCallAnalysisObservations();
  const index = rows.findIndex((row) => row.id === normalized.id || row.requestId === normalized.requestId);
  const next = [...rows];
  if (index >= 0) {
    next[index] = normalized;
  } else {
    next.unshift(normalized);
  }
  volatileObservations.set(normalized.id, normalized);
  const persisted = await safeWriteJsonArrayFile(OBSERVATIONS_FILE, next);
  if (persisted) {
    volatileObservations.delete(normalized.id);
  }
  return normalized;
}

export async function getCallAnalysisObservationByRequestId(requestId: string) {
  const normalized = String(requestId || "").trim();
  if (!normalized) return null;
  const rows = await getCallAnalysisObservations();
  return rows.find((row) => row.requestId === normalized) || null;
}

export async function listCallAnalysisObservationsByLead(leadId: string) {
  const normalizedLeadId = String(leadId || "").trim();
  if (!normalizedLeadId) return [];
  const rows = await getCallAnalysisObservations();
  return rows.filter((row) => row.leadId === normalizedLeadId);
}
