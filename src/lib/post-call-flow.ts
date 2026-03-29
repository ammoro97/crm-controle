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
  | "Ligação caiu"
  | "Caixa postal"
  | "Ligação muda"
  | "Número inválido"
  | "Pessoa não conhece"
  | "Falou com cliente"
  | "Falou com secretária"
  | "Pediu retorno";

export type PostCallWrapup = {
  id: string;
  sessionId: string;
  leadId?: string;
  nome?: string;
  empresa?: string;
  telefone: string;
  userId?: string;
  responsavelId?: string;
  atendenteNome?: string;
  spokeWithPerson: "sim" | "nao";
  rightPerson: "sim" | "nao";
  result: PostCallResultOption;
  observations: string;
  nextAction: string;
  followUpDate?: string;
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
      (typeof entry.durationSeconds === "number" && entry.durationSeconds >= 0),
  );
}

function findMatchingCallLog(session: ActiveCallSession, logs: CallLog[]): CallLog | null {
  const sessionPhone = normalizePhoneDigits(session.telefone);
  const sessionStart = Date.parse(session.startedAt);
  debugLog("Iniciando matching com call logs internos", {
    sessionId: session.sessionId,
    leadId: session.leadId,
    sessionPhone,
    sessionStart: session.startedAt,
    logsCount: logs.length,
  });

  const candidatesByTime: CallLog[] = [];

  for (const log of logs) {
    if (!isEndedCallLog(log)) continue;

    const sameLead = Boolean(session.leadId && log.leadId && session.leadId === log.leadId);
    const logPhone = normalizePhoneDigits(log.telefone || log.called || log.caller || "");
    const samePhone = Boolean(sessionPhone && logPhone && (logPhone.endsWith(sessionPhone) || sessionPhone.endsWith(logPhone)));
    const reference = log.endedAt || log.startedAt || log.updatedAt || log.createdAt;
    const referenceMs = Date.parse(reference || "");
    const inRecentWindow =
      !Number.isNaN(sessionStart) && !Number.isNaN(referenceMs) && referenceMs >= sessionStart - 1000 * 60 * 5 && referenceMs <= sessionStart + 1000 * 60 * 120;

    if (inRecentWindow) {
      candidatesByTime.push(log);
    }

    if (!sameLead && !samePhone) {
      debugLog("Registro interno rejeitado por lead/telefone", {
        callId: log.id,
        sameLead,
        samePhone,
        logLeadId: log.leadId,
        logPhone,
      });
      continue;
    }

    if (!Number.isNaN(sessionStart)) {
      const logTimeRaw = log.startedAt || log.createdAt || "";
      const logTime = Date.parse(logTimeRaw);
      if (!Number.isNaN(logTime)) {
        const distance = Math.abs(logTime - sessionStart);
        if (distance > 1000 * 60 * 120) {
          debugLog("Registro interno rejeitado por janela de tempo", {
            callId: log.id,
            logTime: logTimeRaw,
            distanceMs: distance,
          });
          continue;
        }
      }
    }

    debugLog("Registro interno aceito", {
      callId: log.id,
      sameLead,
      samePhone,
      status: log.status,
      eventType: log.eventType,
      startedAt: log.startedAt,
      endedAt: log.endedAt,
    });
    return log;
  }

  if (candidatesByTime.length === 1) {
    debugLog("Sem match estrito. Usando fallback por candidato unico em janela recente", {
      callId: candidatesByTime[0].id,
    });
    return candidatesByTime[0];
  }

  debugLog("Nenhum matching interno encontrado", {
    candidatesByTime: candidatesByTime.map((item) => item.id),
  });
  return null;
}

function findMatchingApi4ComHistoryCall(
  session: ActiveCallSession,
  items: Array<Record<string, unknown>>,
): { id?: string } | null {
  const sessionPhone = normalizePhoneDigits(session.telefone);
  const sessionStart = Date.parse(session.startedAt);
  debugLog("Iniciando matching com historico externo API4Com", {
    sessionId: session.sessionId,
    leadId: session.leadId,
    sessionPhone,
    sessionStart: session.startedAt,
    itemsCount: items.length,
  });

  const recentCandidates: Array<Record<string, unknown>> = [];

  for (const item of items) {
    const metadata = item.metadata && typeof item.metadata === "object" ? (item.metadata as Record<string, unknown>) : {};
    const metaLeadId = String(metadata.leadId || "").trim();
    const hasLeadMatch = Boolean(session.leadId && metaLeadId && session.leadId === metaLeadId);

    const phoneCandidates = [
      item.telefone,
      item.to,
      item.called,
      item.caller,
      item.from,
      item.phone,
      item.phone_number,
      item.destination,
      metadata.telefone,
    ]
      .map((value) => normalizePhoneDigits(String(value || "")))
      .filter(Boolean);

    const hasPhoneMatch =
      sessionPhone.length > 0 &&
      phoneCandidates.some((phone) => phone.endsWith(sessionPhone) || sessionPhone.endsWith(phone));

    if (!hasLeadMatch && !hasPhoneMatch) {
      debugLog("Registro externo rejeitado por lead/telefone", {
        itemId: String(item.id || item.uniqueid || item.call_id || ""),
        metaLeadId,
        phoneCandidates,
      });
      continue;
    }

    const startedAt = String(item.started_at || item.startedAt || "");
    const endedAt = String(item.ended_at || item.endedAt || "");
    if (startedAt && !Number.isNaN(sessionStart)) {
      const startedTs = Date.parse(startedAt);
      if (!Number.isNaN(startedTs)) {
        const distance = Math.abs(startedTs - sessionStart);
        if (distance > 1000 * 60 * 120) {
          debugLog("Registro externo rejeitado por janela de tempo", {
            itemId: String(item.id || item.uniqueid || item.call_id || ""),
            startedAt,
            distanceMs: distance,
          });
          continue;
        }
        if (startedTs >= sessionStart - 1000 * 60 * 5) {
          recentCandidates.push(item);
        }
      }
    }

    const id = String(item.id || item.uniqueid || item.call_id || "").trim() || undefined;
    debugLog("Registro externo aceito", {
      itemId: id,
      hasLeadMatch,
      hasPhoneMatch,
      startedAt,
      endedAt,
      hangup: item.hangup_cause || item.hangupCause,
      duration: item.duration,
    });
    return { id };
  }

  if (recentCandidates.length === 1) {
    const unique = recentCandidates[0];
    const id = String(unique.id || unique.uniqueid || unique.call_id || "").trim() || undefined;
    debugLog("Sem match estrito. Usando fallback externo por candidato unico recente", { id });
    return { id };
  }

  debugLog("Nenhum matching externo encontrado", {
    recentCandidates: recentCandidates.map((item) => String(item.id || item.uniqueid || item.call_id || "")),
  });
  return null;
}

export function getActiveCallSession() {
  return readActiveSession();
}

export function createDialSession(input: {
  leadId?: string;
  nome?: string;
  empresa?: string;
  telefone: string;
  userId?: string;
  responsavelId?: string;
  atendenteNome?: string;
  sourcePath?: string;
}) {
  const session: ActiveCallSession = {
    sessionId: `SESSION-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    leadId: input.leadId,
    nome: input.nome,
    empresa: input.empresa,
    telefone: input.telefone,
    userId: input.userId,
    responsavelId: input.responsavelId,
    atendenteNome: input.atendenteNome,
    startedAt: new Date().toISOString(),
    sourcePath: input.sourcePath || "/leads",
    status: "dialing",
  };
  writeActiveSession(session);
  debugLog("Sessao de discagem criada", {
    sessionId: session.sessionId,
    leadId: session.leadId,
    nome: session.nome,
    empresa: session.empresa,
    telefone: session.telefone,
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

  const next = current.map((wrapup) => {
    if (wrapup.conciliationStatus === "conciliated") return wrapup;

    const syntheticSession: ActiveCallSession = {
      sessionId: wrapup.sessionId,
      leadId: wrapup.leadId,
      nome: wrapup.nome,
      empresa: wrapup.empresa,
      telefone: wrapup.telefone,
      userId: wrapup.userId,
      responsavelId: wrapup.responsavelId,
      atendenteNome: wrapup.atendenteNome,
      startedAt: wrapup.createdAt,
      sourcePath: "/ligacoes",
      status: "ended_detected",
    };

    const match = findMatchingCallLog(syntheticSession, logs);
    if (!match) return wrapup;

    return {
      ...wrapup,
      callId: wrapup.callId || match.id,
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
    }
  } catch {
    debugLog("Erro ao consultar fonte primaria /api/ligacoes");
  }

  try {
    debugLog("Consultando fonte fallback /api/api4com/calls");
    const response = await fetch("/api/api4com/calls?page=1", {
      method: "GET",
      cache: "no-store",
      signal,
    });
    if (!response.ok) return { matched: false };
    const data = (await response.json()) as { ok?: boolean; items?: Array<Record<string, unknown>> };
    if (!data.ok || !Array.isArray(data.items)) {
      debugLog("Fallback sem dados validos", { ok: data.ok, itemsType: typeof data.items });
      return { matched: false };
    }

    debugLog("Fonte fallback respondeu", { itemsCount: data.items.length });

    const match = findMatchingApi4ComHistoryCall(session, data.items);
    if (!match) {
      debugLog("Nenhum fim detectado no fallback");
      return { matched: false };
    }

    debugLog("Fim detectado no fallback", { callId: match.id });
    return {
      matched: true,
      callId: match.id,
      detectionSource: "api4com-history",
    };
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
