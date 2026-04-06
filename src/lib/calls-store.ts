import { CallAnalysisStatus, CallLog } from "@/types/crm";
import { getLeadPhones } from "./lead-contact-utils";
import { readLeadsCollection } from "./leads-customers-store";
import { readCallLogsCollection, writeCallLogsCollection } from "./calls-collection-store";
import { readDataFile, writeDataFile } from "./storage-paths";

type LeadLastContactOverrides = Record<string, string>;

const LEADS_CONTACT_FILE = "lead-last-contact-overrides.json";

let callLogsCache: CallLog[] | null = null;
let callLogsLoadPromise: Promise<CallLog[]> | null = null;

function sortCallLogsInPlace(logs: CallLog[]) {
  logs.sort((a, b) => {
    const first = a.startedAt || a.createdAt;
    const second = b.startedAt || b.createdAt;
    return second.localeCompare(first);
  });
}

function safeDateValue(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizePhone(input?: string | null) {
  if (!input) return "";
  return input.replace(/\D/g, "");
}

function normalizeLegacyProcessingStatus(value?: string | null) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "processing") return "processing";
  if (normalized === "done") return "done";
  if (normalized === "error") return "error";
  return "pending";
}

function normalizeAnalysisStatus(input?: string | null, legacyProcessingStatus?: string | null): CallAnalysisStatus {
  const normalized = String(input || "").trim().toLowerCase();
  if (normalized === "processing") return "processing";
  if (normalized === "done") return "done";
  if (normalized === "error") return "error";

  const legacy = normalizeLegacyProcessingStatus(legacyProcessingStatus);
  if (legacy === "processing") return "processing";
  if (legacy === "done") return "done";
  if (legacy === "error") return "error";
  return "idle";
}

function normalizeCallLog(input: Partial<CallLog> & Pick<CallLog, "id">): CallLog {
  const now = new Date().toISOString();
  const analysisStatus = normalizeAnalysisStatus(input.analysisStatus, input.processingStatus);
  const legacyProcessingStatus = normalizeLegacyProcessingStatus(
    input.processingStatus || (analysisStatus === "idle" ? "pending" : analysisStatus),
  );
  const aiAnalysis = String(input.aiAnalysis || "").trim();
  const explicitAnalysisPreview = String(input.analysisPreview || "").trim();
  return {
    id: input.id,
    externalCallId: input.externalCallId || null,
    sessionId: input.sessionId || null,
    leadId: input.leadId ?? null,
    userId: input.userId ?? null,
    responsavelId: input.responsavelId ?? null,
    atendenteNome: input.atendenteNome ?? null,
    nome: input.nome || "",
    empresa: input.empresa || "",
    telefone: input.telefone || "",
    caller: input.caller || "",
    called: input.called || "",
    direction: input.direction || "",
    startedAt: safeDateValue(input.startedAt) || null,
    answeredAt: safeDateValue(input.answeredAt) || null,
    endedAt: safeDateValue(input.endedAt) || null,
    durationSeconds: Number.isFinite(input.durationSeconds as number) ? Number(input.durationSeconds) : 0,
    hangupCause: input.hangupCause || null,
    hangupCauseCode: input.hangupCauseCode || null,
    recordUrl: input.recordUrl || null,
    gateway: input.gateway || null,
    ramal: input.ramal || null,
    eventType: input.eventType || "",
    status: input.status || "Nao atendida",
    transcript: input.transcript || null,
    aiAnalysis: aiAnalysis || null,
    analysisStatus,
    processingStatus: legacyProcessingStatus,
    analysisRequestId: input.analysisRequestId || null,
    analysisObservationId: input.analysisObservationId || null,
    analysisLeadId: input.analysisLeadId || input.leadId || null,
    analysisUpdatedAt: safeDateValue(input.analysisUpdatedAt) || now,
    analysisPreview: explicitAnalysisPreview || (aiAnalysis ? aiAnalysis.slice(0, 280) : null),
    analysisError: input.analysisError || null,
    createdAt: safeDateValue(input.createdAt) || now,
    updatedAt: safeDateValue(input.updatedAt) || now,
  };
}

/**
 * Regra centralizada: se causaDesligamento === "Atendida" (exato, API4) → atendida.
 * Não depende de outros campos. Um único ponto de verdade.
 */
export function isLigacaoAtendida(causaDesligamento?: string | null): boolean {
  return String(causaDesligamento || "").trim() === "Atendida";
}

export function mapWebhookStatus(input: {
  eventType?: string;
  durationSeconds?: number;
  hangupCause?: string | null;
  hangupCauseCode?: string | null;
}) {
  const eventType = (input.eventType || "").toLowerCase();
  const duration = Number(input.durationSeconds || 0);
  const cause = String(input.hangupCause || "").trim();
  const causeLower = cause.toLowerCase();
  const causeCode = (input.hangupCauseCode || "").toLowerCase();

  // API4 retorna "Atendida" explicitamente no campo hangupCause — prioridade máxima.
  if (isLigacaoAtendida(cause)) return "Atendida";

  // SIP cause 16: NORMAL_CLEARING = chamada atendida e encerrada normalmente.
  if (cause === "NORMAL_CLEARING" || causeCode === "16") return "Atendida";

  if (eventType.includes("hangup") || duration > 0) {
    if (duration > 0) return "Atendida";
    if (causeLower.includes("busy") || causeCode.includes("busy") || causeCode === "17") return "Ocupado";
    if (causeLower.includes("cancel") || causeLower.includes("cancelada")) return "Cancelada";
    // NUMBER_CHANGED (SIP 22): numero redirecionado, provavelmente atendida.
    if (cause === "NUMBER_CHANGED" || causeCode === "22") return "Atendida";
    return "Nao atendida";
  }

  return "Nao atendida";
}

async function readCallLogsFromDisk(): Promise<CallLog[]> {
  const parsed = await readCallLogsCollection();
  return parsed
    .map((item) => normalizeCallLog(item as Partial<CallLog> & Pick<CallLog, "id">))
    .sort((a, b) => {
      const first = a.startedAt || a.createdAt;
      const second = b.startedAt || b.createdAt;
      return second.localeCompare(first);
    });
}

async function flushCallLogsToDisk() {
  if (!callLogsCache) return;
  await writeCallLogsCollection(callLogsCache);
}

async function ensureCallLogsCache(forceRefresh = false): Promise<CallLog[]> {
  if (!forceRefresh && callLogsCache) return callLogsCache;
  if (!callLogsLoadPromise) {
    callLogsLoadPromise = readCallLogsFromDisk().then((logs) => {
      callLogsCache = logs;
      callLogsLoadPromise = null;
      return logs;
    });
  }
  return callLogsLoadPromise;
}

export async function getCallLogs(): Promise<CallLog[]> {
  // Sempre busca snapshot mais recente do Supabase para evitar divergencia entre instancias.
  const logs = await ensureCallLogsCache(true);
  return [...logs];
}

export async function upsertCallLog(
  input: Partial<CallLog> & Pick<CallLog, "id">,
): Promise<{ record: CallLog; isNew: boolean }> {
  const result = await upsertCallLogs([input]);
  if (result.records.length === 0) {
    throw new Error("CALL_LOG_UPSERT_EMPTY");
  }
  return { record: result.records[0], isNew: result.createdCount > 0 };
}

export async function upsertCallLogs(
  inputs: Array<Partial<CallLog> & Pick<CallLog, "id">>,
): Promise<{ records: CallLog[]; createdCount: number; updatedCount: number }> {
  const logs = await ensureCallLogsCache(true);
  if (inputs.length === 0) {
    return { records: [], createdCount: 0, updatedCount: 0 };
  }

  const records: CallLog[] = [];
  let createdCount = 0;
  let updatedCount = 0;
  let changed = false;

  for (const input of inputs) {
    const now = new Date().toISOString();
    const index = logs.findIndex((entry) => entry.id === input.id);

    if (index === -1) {
      const created = normalizeCallLog({
        ...input,
        createdAt: now,
        updatedAt: now,
      });
      logs.unshift(created);
      records.push(created);
      createdCount += 1;
      changed = true;
      continue;
    }

    const current = logs[index];
    const merged = normalizeCallLog({
      ...current,
      ...input,
      id: current.id,
      externalCallId: input.externalCallId ?? current.externalCallId ?? null,
      sessionId: input.sessionId ?? current.sessionId ?? null,
      createdAt: current.createdAt,
      updatedAt: now,
    });
    logs[index] = merged;
    records.push(merged);
    updatedCount += 1;
    changed = true;
  }

  if (changed) {
    sortCallLogsInPlace(logs);
    await flushCallLogsToDisk();
  }

  return { records, createdCount, updatedCount };
}

export async function updateCall(
  id: string,
  patch: Partial<Omit<CallLog, "id" | "createdAt" | "updatedAt">>,
): Promise<CallLog> {
  const normalizedId = String(id || "").trim();
  if (!normalizedId) {
    throw new Error("CALL_LOG_ID_REQUIRED");
  }

  const logs = await ensureCallLogsCache(true);
  const index = logs.findIndex((entry) => entry.id === normalizedId);
  if (index < 0) {
    throw new Error("CALL_LOG_NOT_FOUND");
  }

  const current = logs[index];
  const now = new Date().toISOString();
  const merged = normalizeCallLog({
    ...current,
    ...patch,
    id: current.id,
    externalCallId: patch.externalCallId ?? current.externalCallId ?? null,
    sessionId: patch.sessionId ?? current.sessionId ?? null,
    createdAt: current.createdAt,
    updatedAt: now,
  });

  logs[index] = merged;
  sortCallLogsInPlace(logs);
  await flushCallLogsToDisk();
  return merged;
}

export async function findLeadByPhone(phone?: string | null) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const leads = await readLeadsCollection();
  const match = leads.find((lead) =>
    getLeadPhones(lead)
      .map((value) => normalizePhone(value))
      .filter(Boolean)
      .some((digits) => digits.endsWith(normalized) || normalized.endsWith(digits)),
  );
  if (!match) return null;

  return {
    id: match.id,
    nome: match.name,
    empresa: match.company,
    telefone: match.phone,
  };
}

export async function getLeadLastContactOverrides(): Promise<LeadLastContactOverrides> {
  const parsed = await readDataFile<LeadLastContactOverrides>(LEADS_CONTACT_FILE, {});
  if (!parsed || typeof parsed !== "object") return {};
  return parsed;
}

export async function setLeadLastContactOverride(leadId: string, value: string) {
  if (!leadId) return;
  const current = await getLeadLastContactOverrides();
  const next: LeadLastContactOverrides = { ...current, [leadId]: value };
  await writeDataFile(LEADS_CONTACT_FILE, next);
}
