import { promises as fs } from "fs";
import path from "path";
import { initialLeads } from "@/lib/mock-data";
import { CallLog } from "@/types/crm";

type LeadLastContactOverrides = Record<string, string>;

const DATA_DIR = path.join(process.cwd(), "data");
const CALLS_FILE = path.join(DATA_DIR, "call-logs.json");
const LEADS_CONTACT_FILE = path.join(DATA_DIR, "lead-last-contact-overrides.json");

let callLogsCache: CallLog[] | null = null;
let callLogsLoadPromise: Promise<CallLog[]> | null = null;
let callLogsFlushTimer: ReturnType<typeof setTimeout> | null = null;

function sortCallLogsInPlace(logs: CallLog[]) {
  logs.sort((a, b) => {
    const first = a.startedAt || a.createdAt;
    const second = b.startedAt || b.createdAt;
    return second.localeCompare(first);
  });
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
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

function normalizeCallLog(input: Partial<CallLog> & Pick<CallLog, "id">): CallLog {
  const now = new Date().toISOString();
  return {
    id: input.id,
    leadId: input.leadId ?? null,
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
    eventType: input.eventType || "",
    status: input.status || "Nao atendida",
    transcript: input.transcript || null,
    aiAnalysis: input.aiAnalysis || null,
    processingStatus: input.processingStatus || "pending",
    createdAt: safeDateValue(input.createdAt) || now,
    updatedAt: safeDateValue(input.updatedAt) || now,
  };
}

export function mapWebhookStatus(input: {
  eventType?: string;
  durationSeconds?: number;
  hangupCause?: string | null;
  hangupCauseCode?: string | null;
}) {
  const eventType = (input.eventType || "").toLowerCase();
  const duration = Number(input.durationSeconds || 0);
  const cause = (input.hangupCause || "").toLowerCase();
  const causeCode = (input.hangupCauseCode || "").toLowerCase();

  if (eventType.includes("hangup") || duration >= 0) {
    if (duration > 0) return "Atendida";
    if (cause.includes("busy") || causeCode.includes("busy") || causeCode === "17") return "Ocupado";
    if (cause.includes("cancel") || cause.includes("cancelada")) return "Cancelada";
    return "Nao atendida";
  }

  return "Nao atendida";
}

async function readCallLogsFromDisk(): Promise<CallLog[]> {
  try {
    const raw = await fs.readFile(CALLS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizeCallLog(item as Partial<CallLog> & Pick<CallLog, "id">))
      .sort((a, b) => {
        const first = a.startedAt || a.createdAt;
        const second = b.startedAt || b.createdAt;
        return second.localeCompare(first);
      });
  } catch {
    return [];
  }
}

async function flushCallLogsToDisk() {
  if (!callLogsCache) return;
  await ensureDataDir();
  await fs.writeFile(CALLS_FILE, JSON.stringify(callLogsCache, null, 2), "utf8");
}

function scheduleCallLogsFlush() {
  if (callLogsFlushTimer) return;
  callLogsFlushTimer = setTimeout(async () => {
    callLogsFlushTimer = null;
    await flushCallLogsToDisk();
  }, 180);
}

async function ensureCallLogsCache(): Promise<CallLog[]> {
  if (callLogsCache) return callLogsCache;
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
  const logs = await ensureCallLogsCache();
  return [...logs];
}

export async function upsertCallLog(
  input: Partial<CallLog> & Pick<CallLog, "id">,
): Promise<{ record: CallLog; isNew: boolean }> {
  const logs = await ensureCallLogsCache();
  const now = new Date().toISOString();
  const index = logs.findIndex((entry) => entry.id === input.id);

  if (index === -1) {
    const created = normalizeCallLog({
      ...input,
      createdAt: now,
      updatedAt: now,
    });
    logs.unshift(created);
    sortCallLogsInPlace(logs);
    scheduleCallLogsFlush();
    return { record: created, isNew: true };
  }

  const current = logs[index];
  const merged = normalizeCallLog({
    ...current,
      ...input,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: now,
    });
  logs[index] = merged;
  sortCallLogsInPlace(logs);
  scheduleCallLogsFlush();
  return { record: merged, isNew: false };
}

export async function findLeadByPhone(phone?: string | null) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const match = initialLeads.find(
    (lead) => normalizePhone(lead.phone).endsWith(normalized) || normalized.endsWith(normalizePhone(lead.phone)),
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
  try {
    const raw = await fs.readFile(LEADS_CONTACT_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as LeadLastContactOverrides;
  } catch {
    return {};
  }
}

export async function setLeadLastContactOverride(leadId: string, value: string) {
  if (!leadId) return;
  const current = await getLeadLastContactOverrides();
  const next: LeadLastContactOverrides = {
    ...current,
    [leadId]: value,
  };
  await ensureDataDir();
  await fs.writeFile(LEADS_CONTACT_FILE, JSON.stringify(next, null, 2), "utf8");
}
