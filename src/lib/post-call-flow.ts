"use client";

import { CallLog } from "@/types/crm";

const ACTIVE_CALL_SESSION_KEY = "crm.calls.active-session.v1";
const POST_CALL_WRAPUPS_KEY = "crm.calls.wrapups.v1";
const POST_CALL_EVENT = "crm:calls:flow:changed";

export type ActiveCallSessionStatus = "dialing" | "ended_detected" | "wrapped";
export type EndDetectionSource = "webhook" | "api4com-history";

export type ActiveCallSession = {
  sessionId: string;
  leadId?: string;
  nome?: string;
  empresa?: string;
  telefone: string;
  externalCallId?: string;
  userId?: string;
  responsavelId?: string;
  atendenteNome?: string;
  startedAt: string;
  sourcePath: string;
  status: ActiveCallSessionStatus;
  detectedAt?: string;
  matchedCallId?: string;
  detectionSource?: EndDetectionSource;
  promptedAt?: string;
};

export type PostCallResultOption =
  | "Ligacao caiu"
  | "Caixa postal"
  | "Ligacao muda"
  | "Numero invalido"
  | "Pessoa nao conhece"
  | "Falou com cliente"
  | "Falou com secretaria"
  | "Cliente sem interesse";

export type PostCallWrapup = {
  id: string;
  sessionId: string;
  externalCallId?: string;
  leadId?: string;
  nome?: string;
  empresa?: string;
  telefone: string;
  userId?: string;
  responsavelId?: string;
  atendenteNome?: string;
  spokeWithPerson?: "sim" | "nao";
  rightPerson?: "sim" | "nao";
  result: PostCallResultOption;
  connected?: boolean;
  finalizacaoTipo?: "NAO_CONECTOU" | "PROBLEMA_BASE" | "CONECTOU";
  finalizacaoResultado?: "POSITIVO" | "NEGATIVO" | "NEUTRO";
  reason?: string;
  observations: string;
  nextAction: string;
  followUpDate?: string;
  followUpTime?: string;
  callId?: string;
  conciliationStatus: "pending_conciliation" | "conciliated";
  createdAt: string;
  updatedAt: string;
};

type CallEndDetectionResult = {
  matched: boolean;
  callId?: string;
  detectionSource?: EndDetectionSource;
};

export type NewCallBlockReason = "active_call" | "pending_wrapup";

const POST_CALL_DEBUG_PREFIX = "[POSTCALL_DEBUG]";

function debugLog(message: string, payload?: unknown) {
  if (payload === undefined) {
    console.log(`${POST_CALL_DEBUG_PREFIX} ${message}`);
    return;
  }
  console.log(`${POST_CALL_DEBUG_PREFIX} ${message}`, payload);
}

function isBrowser() {
  return typeof window !== "undefined";
}

function emitFlowChanged() {
  if (!isBrowser()) return;
  window.dispatchEvent(new CustomEvent(POST_CALL_EVENT));
}

function safeParseJSON<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizePhoneDigits(value?: string | null) {
  return String(value || "").replace(/\D/g, "");
}

function readActiveSession(): ActiveCallSession | null {
  if (!isBrowser()) return null;
  const session = safeParseJSON<ActiveCallSession | null>(window.localStorage.getItem(ACTIVE_CALL_SESSION_KEY), null);
  debugLog("Leitura de sessao ativa", session);
  return session;
}

function writeActiveSession(next: ActiveCallSession | null) {
  if (!isBrowser()) return;
  if (!next) {
    window.localStorage.removeItem(ACTIVE_CALL_SESSION_KEY);
  } else {
    window.localStorage.setItem(ACTIVE_CALL_SESSION_KEY, JSON.stringify(next));
  }
  emitFlowChanged();
  debugLog("Sessao ativa atualizada", next);
}

function readWrapups(): PostCallWrapup[] {
  if (!isBrowser()) return [];
  const parsed = safeParseJSON<PostCallWrapup[]>(window.localStorage.getItem(POST_CALL_WRAPUPS_KEY), []);
  return Array.isArray(parsed) ? parsed : [];
}

function writeWrapups(next: PostCallWrapup[]) {
  if (!isBrowser()) return;
  window.localStorage.setItem(POST_CALL_WRAPUPS_KEY, JSON.stringify(next));
  emitFlowChanged();
  debugLog("Wrapups salvos", { total: next.length });
}

function isEndedCallLog(entry: CallLog) {
  const eventType = String(entry.eventType || "").toLowerCase();
  return Boolean(
    entry.endedAt ||
      eventType.includes("hangup") ||
      (typeof entry.durationSeconds === "number" && entry.durationSeconds > 0),
  );
}

function findMatchingCallLog(session: ActiveCallSession, logs: CallLog[]): CallLog | null {
  const sessionId = String(session.sessionId || "").trim();
  const externalCallId = String(session.externalCallId || "").trim();
  debugLog("Iniciando matching com call logs internos", {
    sessionId,
    externalCallId,
    logsCount: logs.length,
  });

  const endedLogs = logs.filter((entry) => isEndedCallLog(entry));

  if (sessionId) {
    const sessionMatches = endedLogs.filter((log) => String(log.sessionId || "").trim() === sessionId);
    if (sessionMatches.length === 1) {
      debugLog("Registro interno correlacionado por sessionId", {
        sessionId,
        callId: sessionMatches[0].id,
      });
      return sessionMatches[0];
    }
    if (sessionMatches.length > 1) {
      debugLog("Correlacao ambigua por sessionId (nao sera conciliado)", {
        sessionId,
        callIds: sessionMatches.map((item) => item.id),
      });
      return null;
    }
  }

  if (externalCallId) {
    const externalMatches = endedLogs.filter((log) => {
      const logId = String(log.id || "").trim();
      const logExternalId = String(log.externalCallId || "").trim();
      return logId === externalCallId || logExternalId === externalCallId;
    });
    if (externalMatches.length === 1) {
      debugLog("Registro interno correlacionado por externalCallId", {
        externalCallId,
        callId: externalMatches[0].id,
      });
      return externalMatches[0];
    }
    if (externalMatches.length > 1) {
      debugLog("Correlacao ambigua por externalCallId (nao sera conciliado)", {
        externalCallId,
        callIds: externalMatches.map((item) => item.id),
      });
      return null;
    }
  }

  debugLog("Nenhum matching interno deterministico encontrado", { sessionId, externalCallId });
  return null;
}

function findUniqueRecentEndedCallLogByPhone(session: ActiveCallSession, logs: CallLog[]): CallLog | null {
  const sessionPhone = normalizePhoneDigits(session.telefone);
  const sessionStart = Date.parse(session.startedAt);
  if (!sessionPhone || Number.isNaN(sessionStart)) return null;

  const candidates = logs.filter((log) => {
    if (!isEndedCallLog(log)) return false;
    const logPhone = normalizePhoneDigits(log.telefone || log.called || log.caller || "");
    if (!logPhone) return false;
    if (!(logPhone.endsWith(sessionPhone) || sessionPhone.endsWith(logPhone))) return false;
    const reference = Date.parse(log.endedAt || log.startedAt || log.updatedAt || log.createdAt || "");
    if (Number.isNaN(reference)) return false;
    return reference >= sessionStart - 1000 * 30 && reference <= sessionStart + 1000 * 60 * 15;
  });

  if (candidates.length !== 1) {
    debugLog("Fallback interno por telefone nao aplicado (ambiguidade/ausencia)", {
      sessionId: session.sessionId,
      sessionPhone,
      candidates: candidates.map((item) => item.id),
    });
    return null;
  }

  debugLog("Fallback interno por telefone aplicado por unicidade", {
    sessionId: session.sessionId,
    callId: candidates[0].id,
  });
  return candidates[0];
}

function findMatchingApi4ComHistoryCall(
  session: ActiveCallSession,
  items: Array<Record<string, unknown>>,
): { id?: string } | null {
  const sessionId = String(session.sessionId || "").trim();
  const sessionExternalCallId = String(session.externalCallId || "").trim();
  debugLog("Iniciando matching com historico externo API4Com", {
    sessionId,
    externalCallId: sessionExternalCallId,
    itemsCount: items.length,
  });

  const isExternallyEnded = (item: Record<string, unknown>) => {
    const endedAt = String(item.ended_at || item.endedAt || "").trim();
    const hangup = String(item.hangup_cause || item.hangupCause || "").trim();
    const state = String(item.state || item.call_state || item.callStatus || item.status || "").toLowerCase().trim();
    const disposition = String(item.disposition || item.call_disposition || "").toLowerCase().trim();
    const durationRaw = item.duration;
    const duration = Number(durationRaw);
    const terminalStateTokens = [
      "hangup",
      "finished",
      "completed",
      "cancel",
      "busy",
      "failed",
      "no answer",
      "no-answer",
      "answered",
    ];
    const hasTerminalState = terminalStateTokens.some(
      (token) => state.includes(token) || disposition.includes(token),
    );
    return Boolean(endedAt || hangup || (Number.isFinite(duration) && duration > 0) || hasTerminalState);
  };

  const getItemId = (item: Record<string, unknown>) =>
    String(item.id || item.uniqueid || item.call_id || "").trim();

  const bySession: Record<string, unknown>[] = [];
  const byExternalId: Record<string, unknown>[] = [];

  for (const item of items) {
    const itemId = getItemId(item);
    const metadata = item.metadata && typeof item.metadata === "object" ? (item.metadata as Record<string, unknown>) : {};
    const metaSessionId = String(metadata.sessionId || "").trim();
    if (!isExternallyEnded(item)) continue;
    if (sessionId && metaSessionId === sessionId) bySession.push(item);
    if (sessionExternalCallId && itemId && itemId === sessionExternalCallId) byExternalId.push(item);
  }

  if (bySession.length === 1) {
    const item = bySession[0];
    const id = getItemId(item) || undefined;
    debugLog("Registro externo correlacionado por sessionId", {
      sessionId,
      callId: id,
    });
    return { id };
  }
  if (bySession.length > 1) {
    debugLog("Correlacao externa ambigua por sessionId (nao sera conciliado)", {
      sessionId,
      ids: bySession.map((item) => getItemId(item)).filter(Boolean),
    });
    return null;
  }

  if (byExternalId.length === 1) {
    const item = byExternalId[0];
    const id = getItemId(item) || undefined;
    debugLog("Registro externo correlacionado por externalCallId", {
      externalCallId: sessionExternalCallId,
      callId: id,
    });
    return { id };
  }
  if (byExternalId.length > 1) {
    debugLog("Correlacao externa ambigua por externalCallId (nao sera conciliado)", {
      externalCallId: sessionExternalCallId,
      ids: byExternalId.map((item) => getItemId(item)).filter(Boolean),
    });
    return null;
  }

  debugLog("Nenhum matching externo deterministico encontrado", {
    sessionId,
    externalCallId: sessionExternalCallId,
  });
  return null;
}

function findUniqueRecentApi4ComHistoryCallByPhone(
  session: ActiveCallSession,
  items: Array<Record<string, unknown>>,
): { id?: string } | null {
  const sessionPhone = normalizePhoneDigits(session.telefone);
  const sessionStart = Date.parse(session.startedAt);
  if (!sessionPhone || Number.isNaN(sessionStart)) return null;

  const getItemId = (item: Record<string, unknown>) =>
    String(item.id || item.uniqueid || item.call_id || "").trim() || undefined;

  const isExternallyEnded = (item: Record<string, unknown>) => {
    const endedAt = String(item.ended_at || item.endedAt || "").trim();
    const hangup = String(item.hangup_cause || item.hangupCause || "").trim();
    const duration = Number(item.duration);
    const state = String(item.state || item.call_state || item.callStatus || item.status || "").toLowerCase().trim();
    const disposition = String(item.disposition || item.call_disposition || "").toLowerCase().trim();
    const terminalTokens = ["hangup", "finished", "completed", "cancel", "busy", "failed", "no answer", "no-answer", "answered"];
    const hasTerminalState = terminalTokens.some((token) => state.includes(token) || disposition.includes(token));
    return Boolean(endedAt || hangup || (Number.isFinite(duration) && duration > 0) || hasTerminalState);
  };

  const getReferenceTs = (item: Record<string, unknown>) => {
    const candidates = [
      item.ended_at,
      item.endedAt,
      item.started_at,
      item.startedAt,
      item.updated_at,
      item.updatedAt,
      item.created_at,
      item.createdAt,
    ];
    for (const candidate of candidates) {
      const raw = String(candidate || "").trim();
      if (!raw) continue;
      const ts = Date.parse(raw);
      if (!Number.isNaN(ts)) return ts;
    }
    return Number.NaN;
  };

  const matches = items.filter((item) => {
    if (!isExternallyEnded(item)) return false;
    const metadata = item.metadata && typeof item.metadata === "object" ? (item.metadata as Record<string, unknown>) : {};
    const phones = [
      item.telefone,
      item.to,
      item.to_number,
      item.called,
      item.caller,
      item.from,
      item.from_number,
      item.number,
      item.phone_number,
      item.phoneNumber,
      item.dst,
      item.src,
      item.phone,
      item.destination,
      metadata.telefone,
    ]
      .map((value) => normalizePhoneDigits(String(value || "")))
      .filter(Boolean);
    if (!phones.some((phone) => phone.endsWith(sessionPhone) || sessionPhone.endsWith(phone))) return false;

    const ts = getReferenceTs(item);
    if (Number.isNaN(ts)) return false;
    return ts >= sessionStart - 1000 * 30 && ts <= sessionStart + 1000 * 60 * 15;
  });

  if (matches.length !== 1) {
    debugLog("Fallback externo por telefone nao aplicado (ambiguidade/ausencia)", {
      sessionId: session.sessionId,
      sessionPhone,
      candidateIds: matches.map((item) => getItemId(item)).filter(Boolean),
    });
    return null;
  }

  const id = getItemId(matches[0]);
  debugLog("Fallback externo por telefone aplicado por unicidade", {
    sessionId: session.sessionId,
    callId: id,
  });
  return { id };
}

export function getActiveCallSession() {
  return readActiveSession();
}

export function getBlockingCallSessionForNewDial() {
  const current = readActiveSession();
  if (!current) return null;
  if (current.status === "wrapped") return null;
  return current;
}

export function clearActiveCallSession(input?: { expectedSessionId?: string; reason?: string }) {
  const current = readActiveSession();
  if (!current) return false;
  if (input?.expectedSessionId && current.sessionId !== input.expectedSessionId) {
    debugLog("ACTIVE CALL CLEAR SKIPPED: expectedSessionId mismatch", {
      expectedSessionId: input.expectedSessionId,
      currentSessionId: current.sessionId,
      reason: input.reason || null,
    });
    return false;
  }
  writeActiveSession(null);
  debugLog("ACTIVE CALL CLEARED", {
    sessionId: current.sessionId,
    previousStatus: current.status,
    reason: input?.reason || "manual",
  });
  return true;
}

export async function resolveBlockingStateBeforeNewDial(signal?: AbortSignal): Promise<{
  blocked: boolean;
  reason?: NewCallBlockReason;
  session?: ActiveCallSession | null;
}> {
  const current = getBlockingCallSessionForNewDial();
  if (!current) {
    debugLog("NEW CALL ALLOWED", { reason: "no_blocking_session" });
    return { blocked: false, session: null };
  }

  if (current.status === "ended_detected") {
    debugLog("NEW CALL BLOCKED", { reason: "pending_wrapup", sessionId: current.sessionId });
    return { blocked: true, reason: "pending_wrapup", session: current };
  }

  const detection = await detectCallEnd(current, signal);
  if (detection.matched && detection.detectionSource) {
    const updated = markCallSessionEnded({
      sessionId: current.sessionId,
      callId: detection.callId,
      detectionSource: detection.detectionSource,
    });
    debugLog("WRAPUP REQUIRED", {
      sessionId: current.sessionId,
      callId: detection.callId || null,
      source: detection.detectionSource,
    });
    debugLog("NEW CALL BLOCKED", { reason: "pending_wrapup", sessionId: current.sessionId });
    return { blocked: true, reason: "pending_wrapup", session: updated || current };
  }

  debugLog("NEW CALL BLOCKED", { reason: "active_call", sessionId: current.sessionId });
  return { blocked: true, reason: "active_call", session: current };
}

export function generateCallSessionId() {
  return `SESSION-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createDialSession(input: {
  sessionId?: string;
  leadId?: string;
  nome?: string;
  empresa?: string;
  telefone: string;
  externalCallId?: string;
  userId?: string;
  responsavelId?: string;
  atendenteNome?: string;
  sourcePath?: string;
}) {
  const session: ActiveCallSession = {
    sessionId: input.sessionId || generateCallSessionId(),
    leadId: input.leadId,
    nome: input.nome,
    empresa: input.empresa,
    telefone: input.telefone,
    externalCallId: input.externalCallId,
    userId: input.userId,
    responsavelId: input.responsavelId,
    atendenteNome: input.atendenteNome,
    startedAt: new Date().toISOString(),
    sourcePath: input.sourcePath || "/leads",
    status: "dialing",
  };
  writeActiveSession(session);
  debugLog("CALL STARTED", {
    sessionId: session.sessionId,
    externalCallId: session.externalCallId || null,
    leadId: session.leadId || null,
    telefone: session.telefone,
    status: session.status,
  });
  debugLog("Sessao de discagem criada", {
    sessionId: session.sessionId,
    leadId: session.leadId,
    nome: session.nome,
    empresa: session.empresa,
    telefone: session.telefone,
    externalCallId: session.externalCallId || null,
    sourcePath: session.sourcePath,
    startedAt: session.startedAt,
  });
  return session;
}

export function markSessionPrompted(sessionId: string) {
  const current = readActiveSession();
  if (!current || current.sessionId !== sessionId) return;
  writeActiveSession({
    ...current,
    promptedAt: new Date().toISOString(),
  });
  debugLog("Sessao marcada como modal ja exibido", { sessionId });
}

export function markCallSessionEnded(input: {
  sessionId: string;
  callId?: string;
  detectionSource: EndDetectionSource;
}) {
  const current = readActiveSession();
  if (!current || current.sessionId !== input.sessionId) return null;
  const updated: ActiveCallSession = {
    ...current,
    status: "ended_detected",
    detectedAt: new Date().toISOString(),
    matchedCallId: input.callId || current.matchedCallId,
    detectionSource: input.detectionSource,
  };
  writeActiveSession(updated);
  debugLog("CALL ENDED DETECTED", {
    sessionId: input.sessionId,
    callId: input.callId || null,
    source: input.detectionSource,
  });
  debugLog("Sessao marcada como encerrada", {
    sessionId: input.sessionId,
    callId: input.callId,
    detectionSource: input.detectionSource,
  });
  return updated;
}

export function markCallSessionWrapped(sessionId: string) {
  const current = readActiveSession();
  if (!current || current.sessionId !== sessionId) return null;
  const updated: ActiveCallSession = {
    ...current,
    status: "wrapped",
  };
  writeActiveSession(updated);
  debugLog("FINALIZATION SAVED", { sessionId });
  debugLog("Sessao marcada como finalizada (wrap concluido)", { sessionId });
  return updated;
}

export function savePostCallWrapup(
  input: Omit<PostCallWrapup, "id" | "createdAt" | "updatedAt">,
): PostCallWrapup {
  const now = new Date().toISOString();
  const wrapup: PostCallWrapup = {
    ...input,
    id: `WRAP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
  };
  const current = readWrapups();
  writeWrapups([wrapup, ...current]);
  debugLog("Wrapup de pos-ligacao salvo", {
    wrapupId: wrapup.id,
    sessionId: wrapup.sessionId,
    conciliationStatus: wrapup.conciliationStatus,
    callId: wrapup.callId || null,
  });
  return wrapup;
}

export function getPostCallWrapups() {
  return readWrapups();
}

export function getPendingPostCallWrapupsCount() {
  return readWrapups().filter((item) => item.conciliationStatus === "pending_conciliation").length;
}

export function reconcileWrapupsWithCallLogs(logs: CallLog[]) {
  const current = readWrapups();
  if (current.length === 0) return { changed: 0, records: current };

  const endedLogs = logs.filter((entry) => isEndedCallLog(entry));
  const byId = new Map<string, CallLog>();
  const bySessionId = new Map<string, CallLog[]>();
  const byExternalCallId = new Map<string, CallLog[]>();

  for (const log of endedLogs) {
    const id = String(log.id || "").trim();
    if (id) byId.set(id, log);

    const sessionId = String(log.sessionId || "").trim();
    if (sessionId) {
      const list = bySessionId.get(sessionId) || [];
      list.push(log);
      bySessionId.set(sessionId, list);
    }

    const externalCallId = String(log.externalCallId || "").trim();
    if (externalCallId) {
      const list = byExternalCallId.get(externalCallId) || [];
      list.push(log);
      byExternalCallId.set(externalCallId, list);
    }
  }

  const resolveBySessionId = (sessionId: string) => {
    const candidates = bySessionId.get(sessionId) || [];
    return candidates.length === 1 ? candidates[0] : null;
  };

  const resolveByExternalCallId = (externalCallId: string) => {
    const candidates = [
      ...(byExternalCallId.get(externalCallId) || []),
      ...(byId.has(externalCallId) ? [byId.get(externalCallId)!] : []),
    ];
    const uniqueById = Array.from(new Map(candidates.map((item) => [item.id, item])).values());
    return uniqueById.length === 1 ? uniqueById[0] : null;
  };

  const resolveByCallId = (callId: string) => {
    const log = byId.get(callId);
    return log || null;
  };

  const next = current.map((wrapup) => {
    const wrapSessionId = String(wrapup.sessionId || "").trim();
    const wrapExternalCallId = String(wrapup.externalCallId || "").trim();
    const wrapCallId = String(wrapup.callId || "").trim();

    let matched: CallLog | null = null;
    let source: "sessionId" | "externalCallId" | "callId" | null = null;

    if (wrapSessionId) {
      matched = resolveBySessionId(wrapSessionId);
      source = matched ? "sessionId" : null;
    } else if (wrapExternalCallId) {
      matched = resolveByExternalCallId(wrapExternalCallId);
      source = matched ? "externalCallId" : null;
    } else if (wrapCallId) {
      matched = resolveByCallId(wrapCallId);
      source = matched ? "callId" : null;
    }

    if (!matched) {
      const shouldKeepPending = wrapup.conciliationStatus === "pending_conciliation" && !wrapup.callId;
      if (shouldKeepPending) return wrapup;
      return {
        ...wrapup,
        callId: undefined,
        conciliationStatus: "pending_conciliation" as const,
        updatedAt: new Date().toISOString(),
      };
    }

    if (wrapSessionId && String(matched.sessionId || "").trim() && String(matched.sessionId || "").trim() !== wrapSessionId) {
      return {
        ...wrapup,
        callId: undefined,
        conciliationStatus: "pending_conciliation" as const,
        updatedAt: new Date().toISOString(),
      };
    }

    if (
      wrapExternalCallId &&
      String(matched.externalCallId || "").trim() &&
      String(matched.externalCallId || "").trim() !== wrapExternalCallId &&
      String(matched.id || "").trim() !== wrapExternalCallId
    ) {
      return {
        ...wrapup,
        callId: undefined,
        conciliationStatus: "pending_conciliation" as const,
        updatedAt: new Date().toISOString(),
      };
    }

    debugLog("Wrapup conciliado de forma deterministica", {
      wrapupId: wrapup.id,
      callId: matched.id,
      source,
    });

    if (wrapup.callId === matched.id && wrapup.conciliationStatus === "conciliated") {
      return wrapup;
    }

    return {
      ...wrapup,
      callId: matched.id,
      conciliationStatus: "conciliated" as const,
      updatedAt: new Date().toISOString(),
    };
  });

  const changed = next.filter((item, index) => JSON.stringify(item) !== JSON.stringify(current[index])).length;
  if (changed > 0) writeWrapups(next);

  debugLog("Conciliacao de wrapups executada", {
    logsCount: logs.length,
    changed,
    pendingAfter: next.filter((item) => item.conciliationStatus === "pending_conciliation").length,
  });

  return { changed, records: next };
}

export async function detectCallEnd(session: ActiveCallSession, signal?: AbortSignal): Promise<CallEndDetectionResult> {
  if (!session || session.status !== "dialing") {
    debugLog("DetectCallEnd ignorado: sessao ausente ou nao ativa", session);
    return { matched: false };
  }

  debugLog("DetectCallEnd iniciado", {
    sessionId: session.sessionId,
    leadId: session.leadId,
    telefone: session.telefone,
    startedAt: session.startedAt,
  });

  try {
    debugLog("Consultando fonte primaria /api/ligacoes");
    const response = await fetch("/api/ligacoes", {
      method: "GET",
      cache: "no-store",
      signal,
    });

    if (response.ok) {
      const data = (await response.json()) as { success?: boolean; calls?: CallLog[] };
      const logs = Array.isArray(data.calls) ? data.calls : [];
      debugLog("Fonte primaria respondeu", {
        ok: response.ok,
        success: data.success,
        logsCount: logs.length,
      });
      const match = findMatchingCallLog(session, logs);
      if (match) {
        debugLog("Fim detectado na fonte primaria", { callId: match.id });
        return {
          matched: true,
          callId: match.id,
          detectionSource: "webhook",
        };
      }

      const uniqueByPhone = findUniqueRecentEndedCallLogByPhone(session, logs);
      if (uniqueByPhone) {
        debugLog("Fim detectado na fonte primaria por fallback de unicidade", { callId: uniqueByPhone.id });
        return {
          matched: true,
          callId: uniqueByPhone.id,
          detectionSource: "webhook",
        };
      }
    }
  } catch {
    debugLog("Erro ao consultar fonte primaria /api/ligacoes");
  }

  try {
    const sessionPhoneDigits = normalizePhoneDigits(session.telefone);
    const fallbackUrls = [
      sessionPhoneDigits ? `/api/api4com/calls?page=1&filter=${encodeURIComponent(sessionPhoneDigits)}` : "",
      "/api/api4com/calls?page=1",
      "/api/api4com/calls?page=2",
      "/api/api4com/calls?page=3",
    ].filter(Boolean);

    for (const fallbackUrl of fallbackUrls) {
      debugLog("Consultando fonte fallback /api/api4com/calls", { fallbackUrl });
      const response = await fetch(fallbackUrl, {
        method: "GET",
        cache: "no-store",
        signal,
      });
      if (!response.ok) continue;

      const data = (await response.json()) as { ok?: boolean; items?: Array<Record<string, unknown>> };
      if (!data.ok || !Array.isArray(data.items)) {
        debugLog("Fallback sem dados validos", { ok: data.ok, itemsType: typeof data.items, fallbackUrl });
        continue;
      }

      debugLog("Fonte fallback respondeu", { itemsCount: data.items.length, fallbackUrl });

      const match = findMatchingApi4ComHistoryCall(session, data.items);
      if (!match) {
        const uniqueByPhone = findUniqueRecentApi4ComHistoryCallByPhone(session, data.items);
        if (!uniqueByPhone) {
          debugLog("Nenhum fim detectado no fallback desta rodada", { fallbackUrl });
          continue;
        }
        debugLog("Fim detectado no fallback por unicidade", { callId: uniqueByPhone.id, fallbackUrl });
        return {
          matched: true,
          callId: uniqueByPhone.id,
          detectionSource: "api4com-history",
        };
      }

      debugLog("Fim detectado no fallback", { callId: match.id, fallbackUrl });
      return {
        matched: true,
        callId: match.id,
        detectionSource: "api4com-history",
      };
    }

    debugLog("Nenhum fim detectado no fallback");
    return { matched: false };
  } catch {
    debugLog("Erro ao consultar fallback /api/api4com/calls");
    return { matched: false };
  }
}

export function subscribePostCallFlow(listener: () => void) {
  if (!isBrowser()) return () => undefined;

  const onStorage = (event: StorageEvent) => {
    if (event.key === ACTIVE_CALL_SESSION_KEY || event.key === POST_CALL_WRAPUPS_KEY) {
      listener();
    }
  };

  window.addEventListener(POST_CALL_EVENT, listener);
  window.addEventListener("storage", onStorage);

  return () => {
    window.removeEventListener(POST_CALL_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}
