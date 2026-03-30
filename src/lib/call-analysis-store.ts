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

function nowIso() {
  return new Date().toISOString();
}

function normalizePhoneDigits(value?: string | null) {
  return String(value || "").replace(/\D/g, "");
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
  return rows
    .map((row) => normalizeRequest(row))
    .filter((row) => row.requestId && row.callId && row.leadId && row.phoneDigits)
    .sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt));
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
  await writeJsonArrayFile(REQUESTS_FILE, next);
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
  await writeJsonArrayFile(REQUESTS_FILE, next);
  return updated;
}

export async function getCallAnalysisObservations() {
  const rows = await readJsonArrayFile<CallAnalysisObservationRecord>(OBSERVATIONS_FILE);
  return rows
    .map((row) => normalizeObservation(row))
    .filter((row) => row.id && row.leadId && row.callId && row.requestId && row.content)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
  await writeJsonArrayFile(OBSERVATIONS_FILE, next);
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
