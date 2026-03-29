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
  | "Pediu retorno"
  | "Cliente sem interesse";

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
  const sessionExternalCallId = String(session.externalCallId || "").trim();
  const MAX_EXTERNAL_MATCH_DISTANCE_MS = 1000 * 60 * 60 * 12; // 12h (tolerancia para timezone/formatos diferentes)
  debugLog("Iniciando matching com historico externo API4Com", {
    sessionId: session.sessionId,
    leadId: session.leadId,
    sessionPhone,
    sessionStart: session.startedAt,
    itemsCount: items.length,
  });

  const recentCandidates: Array<Record<string, unknown>> = [];
  const recentEndedCandidates: Array<Record<string, unknown>> = [];
  const broadPhoneEndedCandidates: Array<Record<string, unknown>> = [];
  const broadPhoneCandidates: Array<Record<string, unknown>> = [];
  const recentGlobalEndedCandidates: Array<Record<string, unknown>> = [];

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

  const getExternalReferenceDate = (item: Record<string, unknown>) => {
    const candidates = [
      item.started_at,
      item.startedAt,
      item.ended_at,
      item.endedAt,
      item.created_at,
      item.createdAt,
      item.updated_at,
      item.updatedAt,
      item.timestamp,
      item.datetime,
      item.date_time,
      item.date,
    ];

    for (const candidate of candidates) {
      const raw = String(candidate || "").trim();
      if (!raw) continue;
      const ts = Date.parse(raw);
      if (!Number.isNaN(ts)) return { raw, ts };
    }
    return { raw: "", ts: Number.NaN };
  };

  for (const item of items) {
    const itemId = getItemId(item);
    if (sessionExternalCallId && itemId && itemId === sessionExternalCallId) {
      if (isExternallyEnded(item)) {
        debugLog("Registro externo aceito por callId da sessao (encerrado)", {
          itemId,
          sessionExternalCallId,
        });
        return { id: itemId };
      }

      debugLog("Registro externo bateu callId da sessao, mas ainda nao encerrou", {
        itemId,
        sessionExternalCallId,
      });
    }

    const metadata = item.metadata && typeof item.metadata === "object" ? (item.metadata as Record<string, unknown>) : {};
    const metaLeadId = String(metadata.leadId || "").trim();
    const hasLeadMatch = Boolean(session.leadId && metaLeadId && session.leadId === metaLeadId);

    const phoneCandidates = [
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

    const hasPhoneMatch =
      sessionPhone.length > 0 &&
      phoneCandidates.some((phone) => phone.endsWith(sessionPhone) || sessionPhone.endsWith(phone));

    if (!hasLeadMatch && !hasPhoneMatch) {
      debugLog("Registro externo rejeitado por lead/telefone", {
        itemId,
        metaLeadId,
        phoneCandidates,
      });
      continue;
    }

    if (hasPhoneMatch) {
      broadPhoneCandidates.push(item);
      if (isExternallyEnded(item)) {
        broadPhoneEndedCandidates.push(item);
      }
    }

    const startedAt = String(item.started_at || item.startedAt || "");
    const endedAt = String(item.ended_at || item.endedAt || "");
    const reference = getExternalReferenceDate(item);
    if (!Number.isNaN(reference.ts) && !Number.isNaN(sessionStart)) {
      const distance = Math.abs(reference.ts - sessionStart);
      if (distance > MAX_EXTERNAL_MATCH_DISTANCE_MS) {
        debugLog("Registro externo rejeitado por janela de tempo", {
          itemId,
          referenceAt: reference.raw,
          distanceMs: distance,
        });
        continue;
      }

      if (reference.ts >= sessionStart - 1000 * 60 * 10) {
        recentCandidates.push(item);
        if (isExternallyEnded(item)) {
          recentEndedCandidates.push(item);
        }
      }

      // Fallback global: chamada encerrada em janela proxima da sessao, mesmo sem metadados/telefone confiaveis.
      if (
        isExternallyEnded(item) &&
        reference.ts >= sessionStart - 1000 * 60 * 10 &&
        reference.ts <= sessionStart + 1000 * 60 * 120
      ) {
        recentGlobalEndedCandidates.push(item);
      }
    }

    const id = itemId || undefined;
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

  if (recentEndedCandidates.length === 1) {
    const unique = recentEndedCandidates[0];
    const id = String(unique.id || unique.uniqueid || unique.call_id || "").trim() || undefined;
    debugLog("Sem match estrito. Usando fallback externo por candidato unico recente e encerrado", {
      id,
    });
    return { id };
  }

  if (broadPhoneEndedCandidates.length === 1) {
    const unique = broadPhoneEndedCandidates[0];
    const id = String(unique.id || unique.uniqueid || unique.call_id || "").trim() || undefined;
    debugLog("Sem match por janela. Usando fallback por telefone unico encerrado", { id });
    return { id };
  }

  if (broadPhoneCandidates.length === 1) {
    const unique = broadPhoneCandidates[0];
    const id = String(unique.id || unique.uniqueid || unique.call_id || "").trim() || undefined;
    debugLog("Sem match por janela. Usando fallback por telefone unico", { id });
    return { id };
  }

  if (recentGlobalEndedCandidates.length === 1) {
    const unique = recentGlobalEndedCandidates[0];
    const id = String(unique.id || unique.uniqueid || unique.call_id || "").trim() || undefined;
    debugLog("Fallback global aplicado: unico registro encerrado em janela recente", { id });
    return { id };
  }

  if (recentGlobalEndedCandidates.length > 1) {
    // Escolhe o encerrado mais proximo do inicio da sessao quando ha mais de um candidato.
    const nearest = recentGlobalEndedCandidates
      .map((item) => {
        const startedAt = String(item.started_at || item.startedAt || "");
        const ts = Date.parse(startedAt);
        return {
          item,
          distance: Number.isNaN(ts) || Number.isNaN(sessionStart) ? Number.POSITIVE_INFINITY : Math.abs(ts - sessionStart),
        };
      })
      .sort((a, b) => a.distance - b.distance)[0];

    if (nearest && Number.isFinite(nearest.distance)) {
      const id = String(nearest.item.id || nearest.item.uniqueid || nearest.item.call_id || "").trim() || undefined;
      debugLog("Fallback global aplicado: candidato encerrado mais proximo", {
        id,
        distanceMs: nearest.distance,
      });
      return { id };
    }
  }

  debugLog("Nenhum matching externo encontrado", {
    recentCandidates: recentCandidates.map((item) => String(item.id || item.uniqueid || item.call_id || "")),
    recentEndedCandidates: recentEndedCandidates.map((item) =>
      String(item.id || item.uniqueid || item.call_id || ""),
    ),
    broadPhoneEndedCandidates: broadPhoneEndedCandidates.map((item) =>
      String(item.id || item.uniqueid || item.call_id || ""),
    ),
    broadPhoneCandidates: broadPhoneCandidates.map((item) =>
      String(item.id || item.uniqueid || item.call_id || ""),
    ),
    recentGlobalEndedCandidates: recentGlobalEndedCandidates.map((item) =>
      String(item.id || item.uniqueid || item.call_id || ""),
    ),
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
  externalCallId?: string;
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
    externalCallId: input.externalCallId,
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
        debugLog("Nenhum fim detectado no fallback desta rodada", { fallbackUrl });
        continue;
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
