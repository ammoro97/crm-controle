"use client";

import { Fragment, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { useAuth } from "@/components/auth/auth-provider";
import {
  getLeadsSnapshot,
  getMeetingsSnapshot,
  setLeadsSnapshot,
  setMeetingsSnapshot,
  subscribeLeadsSnapshot,
} from "@/lib/crm-data-store";
import { useResponsaveisRecords } from "@/lib/responsaveis-store";
import { resolveResponsavelFromUserAsync } from "@/lib/responsavel-resolver";
import {
  ActiveCallSession,
  PostCallWrapup,
  PostCallResultOption,
  detectCallEnd,
  getActiveCallSession,
  getPendingPostCallWrapupsCount,
  getPostCallWrapups,
  markCallSessionEnded,
  markCallSessionWrapped,
  markSessionPrompted,
  reconcileWrapupsWithCallLogs,
  savePostCallWrapup,
  subscribePostCallFlow,
} from "@/lib/post-call-flow";
import { CallLog, Lead, LeadObservation, Meeting } from "@/types/crm";

type Api4ComCallItem = {
  id?: string | number;
  uniqueid?: string;
  call_id?: string;
  first_name?: string;
  nome?: string;
  empresa?: string;
  telefone?: string;
  to?: string;
  started_at?: string;
  startedAt?: string;
  ended_at?: string;
  endedAt?: string;
  duration?: string | number;
  hangup_cause?: string;
  hangupCause?: string;
  record_url?: string;
  recording_url?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

type MappedCall = {
  id: string;
  nome: string;
  empresa: string;
  telefone: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number;
  status: string;
  finalizacao: string;
  atendente: string;
  origem: string;
  raw: Api4ComCallItem;
};

type CallsApiResponse = {
  ok?: boolean;
  items?: Api4ComCallItem[];
  raw?: unknown;
  error?: string;
};

type InternalCallsApiResponse = {
  success?: boolean;
  calls?: CallLog[];
};

type LeadsIndexes = {
  byId: Map<string, Lead>;
  byPhoneDigits: Map<string, Lead>;
};

type PostCallFormState = {
  result: PostCallResultOption;
  reason: "Ja possui CRM e nao tem interesse" | "Outros" | "";
  observations: string;
  nextAction: string;
  followUpDate: string;
  followUpTime: string;
};

type CurrentCallEvidence = {
  id?: string;
  startedAt?: string | null;
  endedAt?: string | null;
  durationSeconds?: number;
  status?: string;
};

type WrapupsIndexes = {
  byCallId: Map<string, PostCallWrapup>;
  byPhone: Map<string, PostCallWrapup[]>;
};

type ResponsavelByIdIndex = Map<string, string>;

const postCallResultOptions: Array<{ value: PostCallResultOption; label: string }> = [
  { value: "Ligacao caiu", label: "Ligacao caiu" },
  { value: "Caixa postal", label: "Caixa postal" },
  { value: "Ligacao muda", label: "Ligacao muda" },
  { value: "Numero invalido", label: "Numero invalido" },
  { value: "Pessoa nao conhece", label: "Pessoa nao conhece" },
  { value: "Falou com cliente", label: "Falou com cliente" },
  { value: "Falou com secretaria", label: "Falou com secretaria" },
  { value: "Pediu retorno", label: "Pediu retorno" },
  { value: "Cliente sem interesse", label: "Cliente sem interesse" },
];

const baseFinalizacaoOptions = [
  "Todas",
  "Ligacao caiu",
  "Caixa postal",
  "Ligacao muda",
  "Numero invalido",
  "Pessoa nao conhece",
  "Falou com cliente",
  "Falou com secretaria",
  "Pediu retorno",
  "Cliente sem interesse",
];

const nextActionOptions = [
  "Ligar novamente",
  "Enviar WhatsApp",
  "Enviar proposta",
  "Agendar reuniao",
  "Aguardar retorno",
  "Retornar em data combinada",
  "Encerrar lead",
];

const finalizacaoComProximaAcao = new Set<PostCallResultOption>([
  "Falou com cliente",
  "Falou com secretaria",
  "Pediu retorno",
  "Cliente sem interesse",
]);

const nextActionComFollowUp = new Set([
  "Ligar novamente",
  "Aguardar retorno",
  "Retornar em data combinada",
  "Agendar reuniao",
]);

const OFFICIAL_FINALIZACOES = new Set(baseFinalizacaoOptions.filter((value) => value !== "Todas"));

function normalizeDigits(value?: string | null) {
  return String(value || "").replace(/\D/g, "");
}

function buildLeadsIndexes(leads: Lead[]): LeadsIndexes {
  const byId = new Map<string, Lead>();
  const byPhoneDigits = new Map<string, Lead>();

  for (const lead of leads) {
    byId.set(lead.id, lead);
    const digits = normalizeDigits(lead.phone);
    if (digits) byPhoneDigits.set(digits, lead);
  }

  return { byId, byPhoneDigits };
}

function findLeadByPhone(indexes: LeadsIndexes, phoneRaw?: string | null) {
  const digits = normalizeDigits(phoneRaw);
  if (!digits) return null;
  if (indexes.byPhoneDigits.has(digits)) return indexes.byPhoneDigits.get(digits) || null;
  for (const [phone, lead] of indexes.byPhoneDigits.entries()) {
    if (phone.endsWith(digits) || digits.endsWith(phone)) return lead;
  }
  return null;
}

function formatDurationHuman(seconds?: number) {
  const safe = Number(seconds || 0);
  if (!Number.isFinite(safe) || safe <= 0) return "sem duracao registrada";
  const minutes = Math.floor(safe / 60);
  const remaining = safe % 60;
  if (minutes > 0) {
    return `${minutes} minuto${minutes > 1 ? "s" : ""}${remaining > 0 ? ` e ${remaining}s` : ""}`;
  }
  return `${remaining}s`;
}

function normalizeText(value?: string | null) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function normalizeFinalizacaoLabel(value: string) {
  const normalized = normalizeText(value);
  if (!normalized) return "-";
  if (OFFICIAL_FINALIZACOES.has(value)) return value;

  const legacyMap: Record<string, string> = {
    "falou com a pessoa": "Falou com cliente",
    "era a pessoa errada": "Pessoa nao conhece",
    "pessoa errada": "Pessoa nao conhece",
    "nao atendeu": "Caixa postal",
    "não atendeu": "Caixa postal",
    "caixa postal": "Caixa postal",
    "numero invalido": "Numero invalido",
    "número inválido": "Numero invalido",
    "ligacao caiu": "Ligacao caiu",
    "ligação caiu": "Ligacao caiu",
    "pediu retorno": "Pediu retorno",
    "deixou recado": "Falou com secretaria",
    outro: "Pediu retorno",
    falou_com_pessoa: "Falou com cliente",
    pessoa_errada: "Pessoa nao conhece",
    nao_atendeu: "Caixa postal",
    caixa_postal: "Caixa postal",
    numero_invalido: "Numero invalido",
    ligacao_caiu: "Ligacao caiu",
    pediu_retorno: "Pediu retorno",
    deixou_recado: "Falou com secretaria",
    "cliente sem interesse": "Cliente sem interesse",
    cliente_sem_interesse: "Cliente sem interesse",
  };

  return legacyMap[normalized] || "-";
}

function buildWrapupsIndexes(wrapups: PostCallWrapup[]): WrapupsIndexes {
  const byCallId = new Map<string, PostCallWrapup>();
  const byPhone = new Map<string, PostCallWrapup[]>();

  const ordered = [...wrapups].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const wrapup of ordered) {
    if (wrapup.callId && !byCallId.has(wrapup.callId)) {
      byCallId.set(wrapup.callId, wrapup);
    }
    const digits = normalizeDigits(wrapup.telefone);
    if (digits) {
      const current = byPhone.get(digits) || [];
      current.push(wrapup);
      byPhone.set(digits, current);
    }
  }

  return { byCallId, byPhone };
}

function isTechnicalAnswered(status: string, durationSeconds: number) {
  if (durationSeconds <= 0) return false;
  const normalized = normalizeText(status);
  if (!normalized) return true;

  const blockedTokens = ["cancel", "number changed", "unallocated number", "nao atendida", "sem resposta", "ocupado", "busy"];
  if (blockedTokens.some((token) => normalized.includes(token))) return false;
  return true;
}

function nowDateAndTime() {
  const now = new Date();
  return {
    date: now.toISOString().slice(0, 10),
    time: now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    dateTime: now.toISOString(),
  };
}

function createDefaultPostCallForm(): PostCallFormState {
  return {
    reason: "",
    result: "Caixa postal",
    observations: "",
    nextAction: "",
    followUpDate: "",
    followUpTime: "",
  };
}

function getSuggestedNextActionByFinalizacao(result: PostCallResultOption): string {
  if (result === "Falou com cliente") return "Enviar proposta";
  if (result === "Pediu retorno") return "Retornar em data combinada";
  if (result === "Cliente sem interesse") return "Encerrar lead";
  if (result === "Ligacao caiu" || result === "Caixa postal" || result === "Ligacao muda") {
    return "Ligar novamente";
  }
  return "";
}

function formatDate(value?: string | null) {
  if (!value || typeof value !== "string") return "-";
  const raw = value.trim();
  if (!raw) return "-";

  const [datePartRaw] = raw.split("T");
  const dateOnly = (datePartRaw || "").split(" ")[0] || "";
  const [yyyy = "", mm = "", dd = ""] = dateOnly.split("-");

  if (!yyyy || !mm || !dd) return "-";
  return `${dd}/${mm}/${yyyy}`;
}

function formatTime(value?: string | null) {
  if (!value || typeof value !== "string") return "-";
  const raw = value.trim();
  if (!raw) return "-";

  const [, timePartRaw = ""] = raw.split("T");
  const timeClean = timePartRaw.replace("Z", "").trim();
  if (timeClean.length < 5) return "-";

  return timeClean.slice(0, 5);
}

function formatDuration(seconds?: number) {
  const totalSeconds = Number(seconds || 0);
  const safe = Number.isFinite(totalSeconds) ? totalSeconds : 0;
  const minutes = Math.floor(safe / 60);
  const restSeconds = safe % 60;
  return `${minutes.toString().padStart(2, "0")}:${restSeconds.toString().padStart(2, "0")}`;
}

function parseDuration(value: unknown): number {
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber >= 0) return asNumber;
  return 0;
}

function parseDateMaybe(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim();
}

function humanizeHangupCause(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "Nao atendida";
  const lower = normalized.toLowerCase();

  if (lower.includes("busy")) return "Ocupado";
  if (lower.includes("cancel")) return "Cancelada";
  if (lower.includes("no answer") || lower.includes("no-answer")) return "Sem resposta";
  if (lower.includes("normal")) return "Atendida";

  return normalized
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function mapApiCallToRow(
  item: Api4ComCallItem,
  index: number,
  context: {
    leadsIndexes: LeadsIndexes;
    internalById: Map<string, CallLog>;
    wrapupsIndexes: WrapupsIndexes;
    responsavelById: ResponsavelByIdIndex;
  },
): MappedCall {
  const startedAt = parseDateMaybe(item.started_at ?? item.startedAt);
  const endedAt = parseDateMaybe(item.ended_at ?? item.endedAt);
  const durationSeconds = parseDuration(item.duration);
  const rawStatus = String(item.hangup_cause ?? item.hangupCause ?? "").trim();
  const status = rawStatus ? humanizeHangupCause(rawStatus) : durationSeconds > 0 ? "Atendida" : "Nao atendida";
  const rawId = String(item.id ?? item.uniqueid ?? item.call_id ?? "").trim();
  const metadata =
    item.metadata && typeof item.metadata === "object" ? (item.metadata as Record<string, unknown>) : null;
  const metadataLeadId = String(metadata?.leadId ?? "").trim();
  const metadataNome = String(metadata?.nome ?? "").trim();
  const metadataEmpresa = String(metadata?.empresa ?? "").trim();
  const metadataTelefone = String(metadata?.telefone ?? "").trim();
  const metadataResponsavelId = String(metadata?.responsavelId ?? "").trim();

  const internal = rawId ? context.internalById.get(rawId) : undefined;
  const leadFromId =
    (metadataLeadId ? context.leadsIndexes.byId.get(metadataLeadId) : undefined) ||
    (internal?.leadId ? context.leadsIndexes.byId.get(internal.leadId) : undefined);
  const leadFromPhone =
    findLeadByPhone(context.leadsIndexes, metadataTelefone || item.telefone || item.to || internal?.telefone || internal?.called) ||
    null;
  const linkedLead = leadFromId || leadFromPhone || null;

  const resolvedNome =
    linkedLead?.name ||
    internal?.nome ||
    metadataNome ||
    String(item.first_name ?? item.nome ?? "-").trim() ||
    "-";
  const resolvedEmpresa =
    linkedLead?.company || internal?.empresa || metadataEmpresa || String(item.empresa ?? "-").trim() || "-";
  const resolvedTelefone =
    linkedLead?.phone ||
    internal?.telefone ||
    metadataTelefone ||
    String(item.telefone ?? item.to ?? "-").trim() ||
    "-";
  const resolvedStatus = internal?.status || status;
  const resolvedStartedAt = internal?.startedAt || startedAt;

  let matchedWrapup: PostCallWrapup | undefined = rawId ? context.wrapupsIndexes.byCallId.get(rawId) : undefined;
  if (!matchedWrapup) {
    const phoneDigits = normalizeDigits(resolvedTelefone || metadataTelefone || item.telefone || item.to || "");
    const candidates = context.wrapupsIndexes.byPhone.get(phoneDigits) || [];
    if (candidates.length > 0) {
      const startedTs = Date.parse(resolvedStartedAt || "");
      if (!Number.isNaN(startedTs)) {
        let best: PostCallWrapup | undefined;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const candidate of candidates) {
          const candidateTs = Date.parse(candidate.createdAt || "");
          if (Number.isNaN(candidateTs)) continue;
          const distance = Math.abs(candidateTs - startedTs);
          if (distance <= 1000 * 60 * 120 && distance < bestDistance) {
            best = candidate;
            bestDistance = distance;
          }
        }
        matchedWrapup = best;
      } else {
        matchedWrapup = candidates[0];
      }
    }
  }
  const finalizacao = matchedWrapup ? normalizeFinalizacaoLabel(matchedWrapup.result) : "-";
  const atendenteFromWrapupResponsavelId =
    matchedWrapup?.responsavelId ? context.responsavelById.get(matchedWrapup.responsavelId) : undefined;
  const atendenteFromResponsavelId = metadataResponsavelId
    ? context.responsavelById.get(metadataResponsavelId)
    : undefined;
  const atendente =
    atendenteFromWrapupResponsavelId ||
    atendenteFromResponsavelId ||
    "Responsavel nao vinculado";

  return {
    id: rawId || `api4com-${index}-${Date.now()}`,
    nome: resolvedNome,
    empresa: resolvedEmpresa,
    telefone: resolvedTelefone,
    startedAt: resolvedStartedAt,
    endedAt: internal?.endedAt || endedAt,
    durationSeconds: Number(internal?.durationSeconds ?? durationSeconds),
    status: resolvedStatus,
    finalizacao,
    atendente,
    origem: "api4com",
    raw: item,
  };
}

function formatTotalTime(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function normalizeMeetingPersonName(value?: string) {
  return String(value || "").trim().toLowerCase();
}

function statusBadgeClass(status?: string) {
  const normalized = (status || "").toLowerCase();
  if (normalized === "atendida") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  if (normalized === "nao atendida" || normalized === "sem resposta") return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  if (normalized === "ocupado") return "border-sky-500/40 bg-sky-500/10 text-sky-300";
  return "border-rose-500/40 bg-rose-500/10 text-rose-300";
}

export default function LigacoesPage() {
  const { currentUser } = useAuth();
  const responsaveisRecords = useResponsaveisRecords();
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [calls, setCalls] = useState<MappedCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [leadsSnapshot, setLeadsSnapshotState] = useState<Lead[]>(() => getLeadsSnapshot());
  const [internalById, setInternalById] = useState<Map<string, CallLog>>(new Map());
  const [wrapups, setWrapups] = useState<PostCallWrapup[]>(() => getPostCallWrapups());
  const [finalizacaoFilter, setFinalizacaoFilter] = useState("Todas");
  const [atendenteFilter, setAtendenteFilter] = useState("Todos");

  const [activeSession, setActiveSession] = useState<ActiveCallSession | null>(null);
  const [wrapupOpen, setWrapupOpen] = useState(false);
  const [wrapupSaving, setWrapupSaving] = useState(false);
  const [wrapupError, setWrapupError] = useState<string | null>(null);
  const [wrapupMessage, setWrapupMessage] = useState<string | null>(null);
  const [postCallForm, setPostCallForm] = useState<PostCallFormState>(createDefaultPostCallForm());

  const checkingCallEndRef = useRef(false);
  const showReasonField = postCallForm.result === "Cliente sem interesse";
  const showNextActionField = finalizacaoComProximaAcao.has(postCallForm.result);
  const showFollowUpFields = showNextActionField && nextActionComFollowUp.has(postCallForm.nextAction);
  const responsavelById = useMemo(() => {
    const map: ResponsavelByIdIndex = new Map();
    for (const item of responsaveisRecords) {
      map.set(item.id, item.nome);
    }
    return map;
  }, [responsaveisRecords]);

  const loadCalls = async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);

    try {
      const [externalResponse, internalResponse] = await Promise.all([
        fetch("/api/api4com/calls", {
          method: "GET",
          cache: "no-store",
          signal,
        }),
        fetch("/api/ligacoes", {
          method: "GET",
          cache: "no-store",
          signal,
        }),
      ]);

      const externalData = (await externalResponse.json()) as CallsApiResponse;
      const internalData = (await internalResponse.json()) as InternalCallsApiResponse;

      if (!externalResponse.ok || !externalData.ok) {
        setError(externalData.error || "Nao foi possivel carregar ligacoes.");
        setCalls([]);
        return;
      }

      const internalMap = new Map<string, CallLog>();
      if (internalResponse.ok && internalData.success && Array.isArray(internalData.calls)) {
        for (const item of internalData.calls) {
          internalMap.set(item.id, item);
        }
      }
      setInternalById(internalMap);

      const leadsIndexes = buildLeadsIndexes(leadsSnapshot);
      const wrapupsIndexes = buildWrapupsIndexes(wrapups);
      const rows = (Array.isArray(externalData.items) ? externalData.items : []).map((item, index) =>
        mapApiCallToRow(item, index, { leadsIndexes, internalById: internalMap, wrapupsIndexes, responsavelById }),
      );
      rows.sort((a, b) => {
        const first = a.startedAt || "";
        const second = b.startedAt || "";
        return second.localeCompare(first);
      });
      setCalls(rows);
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") return;
      setError("Nao foi possivel carregar ligacoes.");
      setCalls([]);
    } finally {
      setLoading(false);
    }
  };

  const runWrapupReconciliation = async () => {
    if (getPendingPostCallWrapupsCount() === 0) return;

    try {
      const response = await fetch("/api/ligacoes", {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = (await response.json()) as InternalCallsApiResponse;
      if (!data.success || !Array.isArray(data.calls)) return;
      reconcileWrapupsWithCallLogs(data.calls);
    } catch {
      // noop
    }
  };

  useEffect(() => {
    const syncSession = () => {
      const session = getActiveCallSession();
      console.log("[POSTCALL_DEBUG] /ligacoes syncSession", session);
      setActiveSession(session);
      setWrapups(getPostCallWrapups());
    };
    syncSession();
    return subscribePostCallFlow(syncSession);
  }, []);

  useEffect(() => {
    const syncLeads = () => {
      setLeadsSnapshotState(getLeadsSnapshot());
    };
    syncLeads();
    return subscribeLeadsSnapshot(syncLeads);
  }, []);

  useEffect(() => {
    console.log("[POSTCALL_DEBUG] /ligacoes carregada", {
      href: typeof window !== "undefined" ? window.location.href : "",
      activeSession,
    });
  }, [activeSession]);

  useEffect(() => {
    const controller = new AbortController();
    void loadCalls(controller.signal);
    void runWrapupReconciliation();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void runWrapupReconciliation();
    }, 20000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    let unmounted = false;

    const checkCallEnd = async () => {
      if (checkingCallEndRef.current) return;
      const session = getActiveCallSession();
      if (!session || session.status !== "dialing") return;

      checkingCallEndRef.current = true;
      const controller = new AbortController();
      try {
        const detection = await detectCallEnd(session, controller.signal);
        if (!detection.matched || !detection.detectionSource) return;
        if (unmounted) return;
        markCallSessionEnded({
          sessionId: session.sessionId,
          callId: detection.callId,
          detectionSource: detection.detectionSource,
        });
      } finally {
        checkingCallEndRef.current = false;
      }
    };

    void checkCallEnd();
    const intervalId = window.setInterval(() => {
      void checkCallEnd();
    }, 4000);

    return () => {
      unmounted = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!activeSession) return;
    if (activeSession.status !== "ended_detected") return;
    if (activeSession.promptedAt) {
      console.log("[POSTCALL_DEBUG] Modal de finalizacao nao abriu: sessao ja marcada como prompted", {
        sessionId: activeSession.sessionId,
        promptedAt: activeSession.promptedAt,
      });
      return;
    }

    console.log("[POSTCALL_DEBUG] Abrindo modal automatico de finalizacao", {
      sessionId: activeSession.sessionId,
      callId: activeSession.matchedCallId,
      detectionSource: activeSession.detectionSource,
    });
    setPostCallForm(createDefaultPostCallForm());
    setWrapupError(null);
    setWrapupOpen(true);
    markSessionPrompted(activeSession.sessionId);
  }, [activeSession]);

  useEffect(() => {
    setPostCallForm((prev) => {
      if (showNextActionField) return prev;
      if (!prev.nextAction && !prev.followUpDate && !prev.followUpTime) return prev;
      return {
        ...prev,
        nextAction: "",
        followUpDate: "",
        followUpTime: "",
      };
    });
  }, [showNextActionField]);

  useEffect(() => {
    setPostCallForm((prev) => {
      if (showFollowUpFields) return prev;
      if (!prev.followUpDate && !prev.followUpTime) return prev;
      return {
        ...prev,
        followUpDate: "",
        followUpTime: "",
      };
    });
  }, [showFollowUpFields]);

  const finalizacaoOptions = baseFinalizacaoOptions;
  const atendenteOptions = useMemo(() => {
    const dynamic = Array.from(new Set(calls.map((call) => call.atendente).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b),
    );
    return ["Todos", ...dynamic];
  }, [calls]);

  const filteredCalls = useMemo(() => {
    return calls.filter((call) => {
      const matchesFinalizacao = finalizacaoFilter === "Todas" || call.finalizacao === finalizacaoFilter;
      const matchesAtendente = atendenteFilter === "Todos" || call.atendente === atendenteFilter;
      return matchesFinalizacao && matchesAtendente;
    });
  }, [atendenteFilter, calls, finalizacaoFilter]);

  const summary = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    let todayCalls = 0;
    let answered = 0;
    let missed = 0;
    let totalAnsweredSeconds = 0;

    for (const call of filteredCalls) {
      const duration = Number(call.durationSeconds || 0);
      if ((call.startedAt || "").slice(0, 10) === today) todayCalls += 1;
      if (isTechnicalAnswered(call.status, duration)) {
        answered += 1;
        totalAnsweredSeconds += duration;
      }
      else missed += 1;
    }

    return {
      todayCalls,
      answered,
      missed,
      totalTime: formatTotalTime(totalAnsweredSeconds),
    };
  }, [filteredCalls]);

  const atendimentoRate = useMemo(() => {
    const total = filteredCalls.length;
    if (total <= 0) return 0;
    return Math.round((summary.answered / total) * 100);
  }, [filteredCalls.length, summary.answered]);

  const applyWrapupToLead = (
    session: ActiveCallSession,
    formState: PostCallFormState,
    ownerName: string,
    callEvidence?: CurrentCallEvidence,
  ) => {
    const leads = getLeadsSnapshot();
    const now = nowDateAndTime();
    const normalizedSessionPhone = normalizeDigits(session.telefone);

    const leadIndex = leads.findIndex((lead) => {
      if (session.leadId && lead.id === session.leadId) return true;
      const leadPhone = normalizeDigits(lead.phone);
      return Boolean(normalizedSessionPhone && leadPhone && (leadPhone.endsWith(normalizedSessionPhone) || normalizedSessionPhone.endsWith(leadPhone)));
    });

    if (leadIndex === -1) {
      console.log("[POSTCALL_DEBUG] Nenhum lead encontrado para vincular finalizacao", {
        sessionId: session.sessionId,
        leadId: session.leadId,
        telefone: session.telefone,
      });
      return;
    }

    const lead = leads[leadIndex];
    const observationId = `OBS-CALL-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const freeTextObservationId = `OBS-CALL-TEXT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const resultLabel = normalizeFinalizacaoLabel(formState.result) || "Finalizacao registrada";
    const durationText = formatDurationHuman(callEvidence?.durationSeconds);
    const callDate = formatDate(callEvidence?.startedAt || now.date);
    const callTime = formatTime(callEvidence?.startedAt || `${now.date}T${now.time}:00`);
    const followUpDateText = formState.followUpDate ? formatDate(formState.followUpDate) : "-";
    const followUpTimeText = formState.followUpTime || "-";
    const followUpText =
      followUpDateText !== "-" || followUpTimeText !== "-"
        ? `${followUpDateText}${followUpTimeText !== "-" ? ` ${followUpTimeText}` : ""}`.trim()
        : "-";

    const structuredLines = [
      `Finalizacao: ${resultLabel}`,
      `Motivo: ${formState.reason || "-"}`,
      `Proxima acao: ${formState.nextAction.trim() || "-"}`,
      `Follow-up: ${followUpText}`,
      `Duracao: ${durationText}`,
      `Data/Hora da ligacao: ${callDate} ${callTime !== "-" ? `- ${callTime}` : ""}`.trim(),
    ];

    const structuredObservation: LeadObservation = {
      id: observationId,
      date: now.date,
      time: now.time,
      owner: ownerName,
      type: "contato",
      content: structuredLines.join("\n"),
    };

    const freeTextObservation =
      formState.observations.trim().length > 0
        ? ({
            id: freeTextObservationId,
            date: now.date,
            time: now.time,
            owner: ownerName,
            type: "informacao interna",
            content: formState.observations.trim(),
          } as LeadObservation)
        : null;

    const linkedObservationId = freeTextObservation?.id || structuredObservation.id;

    const historyEventDescription = `Ligacao realizada com o lead. Finalizacao: ${resultLabel}.`;

    const nextLead: Lead = {
      ...lead,
      history: [
        ...lead.history,
        {
          id: `H-CALL-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          date: now.date,
          time: now.time,
          eventType: "LIGACAO",
          description: historyEventDescription,
          owner: ownerName,
          linkedObservationId,
          linkedTab: "observacoes",
        },
      ],
      observationLog: freeTextObservation
        ? [...lead.observationLog, structuredObservation, freeTextObservation]
        : [...lead.observationLog, structuredObservation],
      lastInteraction: `${now.date} ${now.time}`,
      nextAction: formState.nextAction.trim() || lead.nextAction,
      nextActionDate: formState.followUpDate ? formState.followUpDate : lead.nextActionDate,
      firstContactDate: lead.firstContactDate || now.date,
    };

    const nextLeads = [...leads];
    nextLeads[leadIndex] = nextLead;
    setLeadsSnapshot(nextLeads);
    setLeadsSnapshotState(nextLeads);
  };

  const createFollowUpMeetingIfNeeded = (
    session: ActiveCallSession,
    formState: PostCallFormState,
    ownerName: string,
  ) => {
    if (!formState.followUpDate || !formState.followUpTime) return;

    const leads = getLeadsSnapshot();
    const sessionPhone = normalizeDigits(session.telefone);
    const lead =
      leads.find((item) => item.id === session.leadId) ||
      leads.find((item) => {
        const leadPhone = normalizeDigits(item.phone);
        return Boolean(sessionPhone && leadPhone && (leadPhone.endsWith(sessionPhone) || sessionPhone.endsWith(leadPhone)));
      }) ||
      null;

    const sessionMarker = `[POSTCALL:${session.sessionId}]`;
    const meetings = getMeetingsSnapshot();
    const normalizedLeadName = normalizeMeetingPersonName(lead?.name || session.nome || "");
    const hasExistingMeeting = meetings.some((meeting) => {
      if ((meeting.notes || "").includes(sessionMarker)) return true;
      if (meeting.date !== formState.followUpDate || meeting.callTime !== formState.followUpTime) return false;
      if (normalizeMeetingPersonName(meeting.owner) !== normalizeMeetingPersonName(ownerName)) return false;
      return normalizedLeadName && normalizeMeetingPersonName(meeting.personName) === normalizedLeadName;
    });

    if (hasExistingMeeting) return;

    const notes = [
      "Origem: Ligacao",
      `Finalizacao: ${normalizeFinalizacaoLabel(formState.result)}`,
      `Proxima acao: ${formState.nextAction || "-"}`,
      `Telefone: ${lead?.phone || session.telefone}`,
      sessionMarker,
    ];
    if (formState.observations.trim()) {
      notes.push(`Observacoes: ${formState.observations.trim()}`);
    }

    const meeting: Meeting = {
      id: `MEET-CALL-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      personName: lead?.name || session.nome || "Lead sem nome",
      date: formState.followUpDate,
      callTime: formState.followUpTime,
      reason: "follow-up",
      owner: ownerName,
      notes: notes.join("\n"),
    };

    setMeetingsSnapshot([...meetings, meeting]);

    if (!lead) return;

    const agendamentoDescricao = (() => {
      const acao = String(formState.nextAction || "").trim().toLowerCase();
      if (acao.includes("reuniao")) return "Reuniao agendada com o lead.";
      if (acao.includes("ligar")) return "Ligacao agendada com o lead.";
      if (acao.includes("retorno")) return "Retorno agendado com o lead.";
      return "Follow-up agendado para o lead.";
    })();

    const now = nowDateAndTime();
    const refreshedLeads = getLeadsSnapshot();
    const refreshedLeadIndex = refreshedLeads.findIndex((item) => item.id === lead.id);
    if (refreshedLeadIndex === -1) return;

    const refreshedLead = refreshedLeads[refreshedLeadIndex];
    const leadComAgendamento: Lead = {
      ...refreshedLead,
      history: [
        ...refreshedLead.history,
        {
          id: `H-AGD-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          date: now.date,
          time: now.time,
          eventType: "AGENDAMENTO",
          description: agendamentoDescricao,
          owner: ownerName,
        },
      ],
    };

    const nextLeads = [...refreshedLeads];
    nextLeads[refreshedLeadIndex] = leadComAgendamento;
    setLeadsSnapshot(nextLeads);
    setLeadsSnapshotState(nextLeads);
  };

  const handleSaveWrapup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeSession) {
      setWrapupError("Nenhum contexto de chamada disponivel para finalizar.");
      return;
    }
    if (!postCallForm.result) {
      setWrapupError("Selecione o resultado da ligacao.");
      return;
    }
    if (postCallForm.result === "Cliente sem interesse" && !postCallForm.reason) {
      setWrapupError("Selecione o motivo para cliente sem interesse.");
      return;
    }
    if (showNextActionField && !postCallForm.nextAction.trim()) {
      setWrapupError("Selecione a proxima acao para continuar.");
      return;
    }
    if (showFollowUpFields && (!postCallForm.followUpDate || !postCallForm.followUpTime)) {
      setWrapupError("Preencha data e horario do follow-up para continuar.");
      return;
    }

    setWrapupSaving(true);
    setWrapupError(null);
    setWrapupMessage(null);

    try {
      const resolvedResponsavel = await resolveResponsavelFromUserAsync(currentUser);
      if (!resolvedResponsavel.linked || !resolvedResponsavel.responsavel) {
        setWrapupError(
          "Seu usuario ainda nao esta vinculado a um responsavel no CRM. Cadastre esse e-mail em Configuracoes > Responsaveis antes de finalizar ligacoes.",
        );
        return;
      }

      const ownerName = resolvedResponsavel.responsavel.nome;
      const ownerId = resolvedResponsavel.responsavel.id;
      const currentCallEvidence: CurrentCallEvidence | undefined = activeSession.matchedCallId
        ? (() => {
            const fromTable = calls.find((item) => item.id === activeSession.matchedCallId);
            if (fromTable) {
              return {
                id: fromTable.id,
                startedAt: fromTable.startedAt,
                endedAt: fromTable.endedAt,
                durationSeconds: fromTable.durationSeconds,
                status: fromTable.status,
              };
            }
            const fromInternal = activeSession.matchedCallId ? internalById.get(activeSession.matchedCallId) : undefined;
            if (fromInternal) {
              return {
                id: fromInternal.id,
                startedAt: fromInternal.startedAt || null,
                endedAt: fromInternal.endedAt || null,
                durationSeconds: Number(fromInternal.durationSeconds || 0),
                status: fromInternal.status || undefined,
              };
            }
            return undefined;
          })()
        : undefined;

      savePostCallWrapup({
        sessionId: activeSession.sessionId,
        leadId: activeSession.leadId,
        nome: activeSession.nome,
        empresa: activeSession.empresa,
        telefone: activeSession.telefone,
        userId: activeSession.userId,
        responsavelId: ownerId,
        atendenteNome: ownerName,
        result: postCallForm.result,
        reason: postCallForm.reason || undefined,
        observations: postCallForm.observations.trim(),
        nextAction: postCallForm.nextAction.trim(),
        followUpDate: postCallForm.followUpDate || undefined,
        followUpTime: postCallForm.followUpTime || undefined,
        callId: activeSession.matchedCallId,
        conciliationStatus: activeSession.matchedCallId ? "conciliated" : "pending_conciliation",
      });
      applyWrapupToLead(activeSession, postCallForm, ownerName, currentCallEvidence);
      createFollowUpMeetingIfNeeded(activeSession, postCallForm, ownerName);

      markCallSessionWrapped(activeSession.sessionId);
      console.log("[POSTCALL_DEBUG] Wrapup salvo e sessao marcada como wrapped", {
        sessionId: activeSession.sessionId,
      });
      setPostCallForm(createDefaultPostCallForm());
      setWrapupOpen(false);
      setWrapupMessage("Finalizacao da ligacao registrada com sucesso.");
      await runWrapupReconciliation();
      await loadCalls();
    } catch {
      setWrapupError("Nao foi possivel registrar a finalizacao desta ligacao.");
    } finally {
      setWrapupSaving(false);
    }
  };

  return (
    <section className="space-y-6">
      <div className="panel p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-100">Ligacoes</h1>
            <p className="mt-1 text-sm text-slate-400">Acompanhe o historico de chamadas realizadas no CRM.</p>
          </div>
          <div className="flex w-full flex-wrap items-end justify-start gap-2 lg:w-auto lg:justify-end">
            <label className="text-[11px] uppercase tracking-[0.08em] text-muted">
              Atendente
              <select
                className="field mt-1 h-9 min-w-[190px] px-2.5 py-1.5 text-xs"
                value={atendenteFilter}
                onChange={(event) => setAtendenteFilter(event.target.value)}
              >
                {atendenteOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11px] uppercase tracking-[0.08em] text-muted">
              Finalizacao
              <select
                className="field mt-1 h-9 min-w-[190px] px-2.5 py-1.5 text-xs"
                value={finalizacaoFilter}
                onChange={(event) => setFinalizacaoFilter(event.target.value)}
              >
                {finalizacaoOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn-ghost h-9 px-3 py-1.5 text-xs"
              onClick={() => {
                void loadCalls();
              }}
              disabled={loading}
            >
              {loading ? "Atualizando..." : "Atualizar"}
            </button>
          </div>
        </div>
        {wrapupMessage ? <p className="mt-2 text-xs text-emerald-300">{wrapupMessage}</p> : null}
      </div>

      <div className="space-y-3">
        <article className="panel border-sky-400/40 bg-sky-500/10 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-sky-200">Ligacoes Hoje</p>
              <p className="mt-2 text-4xl font-semibold leading-none text-slate-100">{summary.todayCalls}</p>
              <p className="mt-2 text-xs text-sky-100/80">Volume total de chamadas do dia</p>
            </div>
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-sky-500/20 text-sm text-sky-100">?</span>
          </div>
        </article>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <article className="panel border-emerald-500/40 bg-emerald-500/10 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.12em] text-emerald-200">Ligacoes Atendidas</p>
                <p className="mt-2 text-3xl font-semibold leading-none text-emerald-100">{summary.answered}</p>
                <p className="mt-2 text-xs text-emerald-200/90">
                  Taxa de atendimento: {summary.answered} de {filteredCalls.length} ({atendimentoRate}%)
                </p>
              </div>
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20 text-sm text-emerald-100">?</span>
            </div>
          </article>

          <article className="panel border-amber-500/40 bg-amber-500/10 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.12em] text-amber-200">Ligacoes Nao Atendidas</p>
                <p className="mt-2 text-3xl font-semibold leading-none text-amber-100">{summary.missed}</p>
                <p className="mt-2 text-xs text-amber-200/90">Chamadas sem atendimento efetivo</p>
              </div>
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-amber-500/20 text-sm text-amber-100">?</span>
            </div>
          </article>

          <article className="panel border-slate-500/40 bg-slate-800/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.12em] text-slate-300">Tempo Total em Chamadas</p>
                <p className="mt-2 text-3xl font-semibold leading-none text-slate-100">{summary.totalTime}</p>
                <p className="mt-2 text-xs text-slate-400">Soma de duracao das chamadas atendidas</p>
              </div>
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-700 text-sm text-slate-200">?</span>
            </div>
          </article>
        </div>
      </div>

      <div className="panel overflow-hidden">
        {loading ? <p className="px-4 py-4 text-sm text-slate-400">Carregando ligacoes...</p> : null}
        {error ? <p className="px-4 py-4 text-sm text-rose-300">{error}</p> : null}

        {!loading && !error ? (
          <div className="overflow-x-auto">
            <table className="min-w-[1260px] w-full text-left">
              <thead className="border-b border-border bg-slate-900/60 text-[11px] uppercase tracking-[0.08em] text-muted">
                <tr>
                  <th className="whitespace-nowrap px-3 py-2.5">Nome</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Empresa</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Telefone</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Atendente</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Data</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Inicio</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Fim</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Duracao</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Status</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Finalizacao</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Origem</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Acao</th>
                </tr>
              </thead>
              <tbody>
                {filteredCalls.length === 0 ? (
                  <tr>
                    <td className="px-3 py-4 text-sm text-slate-400" colSpan={12}>
                      Nenhuma ligacao encontrada.
                    </td>
                  </tr>
                ) : (
                  filteredCalls.map((call) => {
                    const isOpen = selectedCallId === call.id;
                    return (
                      <Fragment key={call.id}>
                        <tr className="border-b border-border/70 text-sm text-slate-200 transition hover:bg-slate-900/40">
                          <td className="whitespace-nowrap px-3 py-3">{call.nome}</td>
                          <td className="whitespace-nowrap px-3 py-3">{call.empresa}</td>
                          <td className="whitespace-nowrap px-3 py-3">{call.telefone}</td>
                          <td className="whitespace-nowrap px-3 py-3">{call.atendente || "Responsavel nao vinculado"}</td>
                          <td className="whitespace-nowrap px-3 py-3">{formatDate(call.startedAt)}</td>
                          <td className="whitespace-nowrap px-3 py-3">{formatTime(call.startedAt)}</td>
                          <td className="whitespace-nowrap px-3 py-3">{formatTime(call.endedAt)}</td>
                          <td className="whitespace-nowrap px-3 py-3">{formatDuration(call.durationSeconds)}</td>
                          <td className="whitespace-nowrap px-3 py-3">
                            <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${statusBadgeClass(call.status)}`}>
                              {call.status || "Nao atendida"}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3">
                            <span className="rounded-md border border-border/70 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-200">
                              {call.finalizacao || "-"}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3">{call.origem}</td>
                          <td className="whitespace-nowrap px-3 py-3">
                            <button
                              type="button"
                              className="rounded-md border border-border px-2.5 py-1.5 text-xs text-slate-200 transition hover:bg-slate-800"
                              onClick={() => setSelectedCallId((prev) => (prev === call.id ? null : call.id))}
                            >
                              {isOpen ? "Ocultar detalhes" : "Ver detalhes"}
                            </button>
                          </td>
                        </tr>
                        {isOpen ? (
                          <tr className="border-b border-border/70 bg-slate-950/40">
                            <td colSpan={12} className="px-3 py-3">
                              <div className="grid gap-3 rounded-lg border border-border bg-slate-900/50 p-4 md:grid-cols-2 xl:grid-cols-4">
                                <div>
                                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-400">Nome</p>
                                  <p className="mt-1 text-sm text-slate-100">{call.nome}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-400">Empresa</p>
                                  <p className="mt-1 text-sm text-slate-100">{call.empresa}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-400">Telefone</p>
                                  <p className="mt-1 text-sm text-slate-100">{call.telefone}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-400">Atendente</p>
                                  <p className="mt-1 text-sm text-slate-100">{call.atendente || "Responsavel nao vinculado"}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-400">Data</p>
                                  <p className="mt-1 text-sm text-slate-100">{formatDate(call.startedAt)}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-400">Inicio</p>
                                  <p className="mt-1 text-sm text-slate-100">{formatTime(call.startedAt)}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-400">Atendimento</p>
                                  <p className="mt-1 text-sm text-slate-100">{Number(call.durationSeconds) > 0 ? "Sim" : "Nao"}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-400">Fim</p>
                                  <p className="mt-1 text-sm text-slate-100">{formatTime(call.endedAt)}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-400">Duracao</p>
                                  <p className="mt-1 text-sm text-slate-100">{formatDuration(call.durationSeconds)}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-400">Status</p>
                                  <p className="mt-1 text-sm text-slate-100">{call.status || "Nao atendida"}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-400">Finalizacao</p>
                                  <p className="mt-1 text-sm text-slate-100">{call.finalizacao || "-"}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-400">Ramal/Origem</p>
                                  <p className="mt-1 text-sm text-slate-100">{call.origem}</p>
                                </div>
                                <div className="md:col-span-2">
                                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-400">Hangup cause</p>
                                  <p className="mt-1 text-sm text-slate-100">
                                    {String(call.raw.hangup_cause ?? call.raw.hangupCause ?? "-")}
                                  </p>
                                </div>
                                <div className="md:col-span-2 xl:col-span-4">
                                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-400">Audio</p>
                                  {typeof call.raw.recording_url === "string" && call.raw.recording_url ? (
                                    <a
                                      href={call.raw.recording_url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="mt-1 inline-flex text-sm text-emerald-300 underline underline-offset-2"
                                    >
                                      Abrir gravacao
                                    </a>
                                  ) : typeof call.raw.record_url === "string" && call.raw.record_url ? (
                                    <a
                                      href={call.raw.record_url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="mt-1 inline-flex text-sm text-emerald-300 underline underline-offset-2"
                                    >
                                      Abrir gravacao
                                    </a>
                                  ) : (
                                    <p className="mt-1 text-sm text-slate-500">Em breve</p>
                                  )}
                                </div>
                                <div>
                                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-400">Transcricao</p>
                                  <p className="mt-1 text-sm text-slate-500">Em breve</p>
                                </div>
                                <div>
                                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-400">Analise IA</p>
                                  <p className="mt-1 text-sm text-slate-500">Em breve</p>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <Modal
        title="Finalizacao de ligacao"
        open={wrapupOpen}
        onClose={() => {
          setWrapupOpen(false);
          setWrapupError(null);
        }}
      >
        <form className="space-y-4" onSubmit={handleSaveWrapup}>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              Telefone
              <input className="field mt-1" value={activeSession?.telefone || "-"} readOnly />
            </label>
            <label className="text-sm">
              Nome do lead
              <input className="field mt-1" value={activeSession?.nome || "-"} readOnly />
            </label>
            <label className="text-sm md:col-span-2">
              Finalizacao
              <select
                className="field mt-1"
                value={postCallForm.result}
                onChange={(event) => {
                  const value = event.target.value as PostCallResultOption;
                  const suggestedNextAction = getSuggestedNextActionByFinalizacao(value);
                  setPostCallForm((prev) => ({
                    ...prev,
                    result: value,
                    reason: value === "Cliente sem interesse" ? prev.reason : "",
                    nextAction: finalizacaoComProximaAcao.has(value)
                      ? suggestedNextAction || prev.nextAction
                      : "",
                  }));
                }}
              >
                {postCallResultOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {showReasonField ? (
              <label className="text-sm md:col-span-2">
                Motivo
                <select
                  className="field mt-1"
                  value={postCallForm.reason}
                  onChange={(event) =>
                    setPostCallForm((prev) => ({
                      ...prev,
                      reason: event.target.value as "Ja possui CRM e nao tem interesse" | "Outros" | "",
                    }))
                  }
                >
                  <option value="">Selecione...</option>
                  <option value="Ja possui CRM e nao tem interesse">Ja possui CRM e nao tem interesse</option>
                  <option value="Outros">Outros</option>
                </select>
              </label>
            ) : null}
            <label className="text-sm md:col-span-2">
              Observacoes
              <textarea
                className="field mt-1 min-h-[110px]"
                value={postCallForm.observations}
                onChange={(event) => setPostCallForm((prev) => ({ ...prev, observations: event.target.value }))}
              />
            </label>
            {showNextActionField ? (
              <label className="text-sm md:col-span-2">
                Proxima acao
                <select
                  className="field mt-1"
                  value={postCallForm.nextAction}
                  onChange={(event) => setPostCallForm((prev) => ({ ...prev, nextAction: event.target.value }))}
                >
                  <option value="">Selecione...</option>
                  {nextActionOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {showFollowUpFields ? (
              <>
                <label className="text-sm">
                  Data de follow-up
                  <input
                    type="date"
                    className="field mt-1"
                    value={postCallForm.followUpDate}
                    onChange={(event) => setPostCallForm((prev) => ({ ...prev, followUpDate: event.target.value }))}
                  />
                </label>
                <label className="text-sm">
                  Horario de follow-up
                  <input
                    type="time"
                    className="field mt-1"
                    value={postCallForm.followUpTime}
                    onChange={(event) => setPostCallForm((prev) => ({ ...prev, followUpTime: event.target.value }))}
                  />
                </label>
              </>
            ) : null}
          </div>

          {activeSession && !activeSession.matchedCallId ? (
            <p className="text-xs text-amber-300">
              Esta finalizacao sera salva como pendente de conciliacao ate a chamada oficial ser identificada.
            </p>
          ) : null}

          {wrapupError ? <p className="text-xs text-rose-300">{wrapupError}</p> : null}

          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost" onClick={() => setWrapupOpen(false)} disabled={wrapupSaving}>
              Fechar
            </button>
            <button type="submit" className="btn-primary" disabled={wrapupSaving}>
              {wrapupSaving ? "Salvando..." : "Salvar finalizacao"}
            </button>
          </div>
        </form>
      </Modal>
    </section>
  );
}



