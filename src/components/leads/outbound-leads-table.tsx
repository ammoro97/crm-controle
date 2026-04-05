"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { Modal } from "@/components/ui/modal";
import { getLeadPhoneItems, getLeadPhones } from "@/lib/lead-contact-utils";
import { resolveLeadExpedienteStatusFromHorario } from "@/lib/lead-expediente";
import { resolveResponsavelFromUserAsync } from "@/lib/responsavel-resolver";
import {
  createDialSession,
  generateCallSessionId,
  getPostCallWrapups,
  resolveBlockingStateBeforeNewDial,
  subscribePostCallFlow,
  type PostCallWrapup,
} from "@/lib/post-call-flow";
import { CallLog, Lead } from "@/types/crm";
import { TruncatedCellLink, TruncatedCellText } from "./table-cell-truncate";

type OutboundLeadsTableProps = {
  leads: Lead[];
  onSelectLead: (lead: Lead) => void;
  onDeleteLeads: (ids: string[]) => void;
};

type DialApiResponse = {
  success?: boolean;
  message?: string;
  error?: string;
  externalCallId?: string | null;
  data?: unknown;
};

type CallFeedback = {
  type: "success" | "error";
  message: string;
};

type InternalCallsApiResponse = {
  success?: boolean;
  calls?: CallLog[];
};

type LeadInteractionMetrics = {
  totalCalls: number;
  totalFollowUps: number;
  hasScheduledCall: boolean;
  conversionDate: string | null;
};

type FollowUpChannel = "call" | "message" | "email" | "other";

type FollowUpScheduleCandidate = {
  date: string;
  dateTime: Date;
};

const expedienteStyle: Record<"Aberto" | "Fechado" | "Indefinido", string> = {
  Aberto: "bg-emerald-500/20 text-emerald-300 border-emerald-400/40",
  Fechado: "bg-rose-500/20 text-rose-300 border-rose-400/40",
  Indefinido: "bg-slate-500/20 text-slate-400 border-slate-400/40",
};

function parseCityState(city: string): { city: string; state: string } {
  if (!city.trim()) return { city: "-", state: "-" };
  const normalized = city.replace(/\s+/g, " ").trim();
  if (normalized.includes(">")) {
    const [cityName, state] = normalized.split(">").map((p) => p.trim());
    return { city: cityName || "-", state: state || "-" };
  }
  if (normalized.includes("-")) {
    const [cityName, state] = normalized.split("-").map((p) => p.trim());
    return { city: cityName || "-", state: state || "-" };
  }
  return { city: normalized, state: "-" };
}

function formatDateBR(value?: string | null): string {
  if (!value) return "-";
  const [year = "", month = "", day = ""] = value.split("-");
  if (!year || !month || !day) return "-";
  return `${day}/${month}/${year}`;
}

function formatLastInteraction(value?: string | null): string {
  const raw = String(value || "").trim();
  if (!raw) return "-";

  const normalized = raw.replace(" ", "T");
  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const dateMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}:\d{2}))?$/);
  if (dateMatch) {
    const [, year, month, day, time] = dateMatch;
    return time ? `${day}/${month}/${year} ${time}` : `${day}/${month}/${year}`;
  }

  return raw;
}

function normalizePhoneValue(value?: string | null): string {
  return String(value || "").trim();
}

function isDialablePhone(value?: string | null): boolean {
  const normalized = normalizePhoneValue(value);
  if (!normalized || normalized === "-") return false;
  const digits = normalized.replace(/\D/g, "");
  return digits.length >= 8;
}

function normalizePhoneDigits(value?: string | null): string {
  return normalizePhoneValue(value).replace(/\D/g, "");
}

function isSamePhoneValue(left?: string | null, right?: string | null): boolean {
  const leftDigits = normalizePhoneDigits(left);
  const rightDigits = normalizePhoneDigits(right);
  if (leftDigits && rightDigits) return leftDigits === rightDigits;
  return normalizePhoneValue(left).toLowerCase() === normalizePhoneValue(right).toLowerCase();
}

function getDialablePhoneItemsForLead(lead: Lead) {
  return getLeadPhoneItems(lead).filter((item) => isDialablePhone(item.value));
}

function formatNota(value?: number | string | null): string {
  if (value == null || value === "") return "-";
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (Number.isNaN(n)) return String(value);
  return n.toFixed(1);
}

function formatAvaliacoes(value?: number | string | null): string {
  if (value == null || value === "") return "-";
  const n = typeof value === "number" ? value : parseInt(String(value), 10);
  if (Number.isNaN(n)) return String(value);
  return n.toLocaleString("pt-BR");
}

const EMPTY_INTERACTION_METRICS: LeadInteractionMetrics = {
  totalCalls: 0,
  totalFollowUps: 0,
  hasScheduledCall: false,
  conversionDate: null,
};

function normalizeText(value?: string | null): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeDigits(value?: string | null): string {
  return String(value || "").replace(/\D/g, "");
}

function normalizeLeadId(value?: string | null): string {
  return String(value || "").trim();
}

function isIsoDate(value?: string | null): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function parseHalfHourTime(value?: string | null): { hour: number; minute: number } | null {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23) return null;
  if (minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function buildLocalDateTime(date?: string | null, time?: string | null): Date | null {
  if (!isIsoDate(date)) return null;
  const parsedTime = parseHalfHourTime(time);
  if (!parsedTime) return null;

  const [yearRaw, monthRaw, dayRaw] = String(date).split("-");
  const year = Number(yearRaw);
  const monthIndex = Number(monthRaw) - 1;
  const day = Number(dayRaw);
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || !Number.isFinite(day)) return null;

  const localDate = new Date(year, monthIndex, day, parsedTime.hour, parsedTime.minute, 0, 0);
  if (Number.isNaN(localDate.getTime())) return null;
  if (
    localDate.getFullYear() !== year ||
    localDate.getMonth() !== monthIndex ||
    localDate.getDate() !== day ||
    localDate.getHours() !== parsedTime.hour ||
    localDate.getMinutes() !== parsedTime.minute
  ) {
    return null;
  }

  return localDate;
}

function resolveFollowUpChannel(nextAction?: string | null): FollowUpChannel {
  const normalized = normalizeText(nextAction);
  if (!normalized) return "other";
  if (
    normalized.includes("video") ||
    normalized.includes("reuniao") ||
    normalized.includes("ligacao") ||
    normalized.includes("ligar") ||
    normalized.includes("call")
  ) {
    return "call";
  }
  if (
    normalized.includes("whatsapp") ||
    normalized.includes("mensagem") ||
    normalized.includes("retorno")
  ) {
    return "message";
  }
  if (normalized.includes("e-mail") || normalized.includes("email")) {
    return "email";
  }
  return "other";
}

function buildLeadPhoneIndex(leads: Lead[]): Map<string, Set<string>> {
  const byDigits = new Map<string, Set<string>>();
  for (const lead of leads) {
    const leadId = normalizeLeadId(lead.id);
    if (!leadId) continue;
    for (const phone of getLeadPhones(lead)) {
      const digits = normalizeDigits(phone);
      if (!digits) continue;
      const current = byDigits.get(digits) || new Set<string>();
      current.add(leadId);
      byDigits.set(digits, current);
    }
  }
  return byDigits;
}

function resolveLeadIdByPhone(
  rawPhones: Array<string | null | undefined>,
  leadPhoneIndex: Map<string, Set<string>>,
): string | null {
  const candidates = rawPhones.map((value) => normalizeDigits(value)).filter(Boolean);
  if (candidates.length === 0) return null;

  const exactMatches = new Set<string>();
  for (const digits of candidates) {
    const leadIds = leadPhoneIndex.get(digits);
    if (!leadIds || leadIds.size !== 1) continue;
    exactMatches.add(Array.from(leadIds)[0]);
  }
  if (exactMatches.size === 1) return Array.from(exactMatches)[0];

  const fuzzyMatches = new Set<string>();
  for (const digits of candidates) {
    for (const [phoneDigits, leadIds] of leadPhoneIndex.entries()) {
      if (!(phoneDigits.endsWith(digits) || digits.endsWith(phoneDigits))) continue;
      for (const leadId of leadIds) fuzzyMatches.add(leadId);
    }
  }
  if (fuzzyMatches.size === 1) return Array.from(fuzzyMatches)[0];

  return null;
}

function buildLeadInteractionMetricsById(params: {
  leads: Lead[];
  calls: CallLog[];
  wrapups: PostCallWrapup[];
  referenceDate: Date;
}): Record<string, LeadInteractionMetrics> {
  const { leads, calls, wrapups, referenceDate } = params;
  const metricsByLead: Record<string, LeadInteractionMetrics> = {};
  const validLeadIds = new Set<string>();
  const leadPhoneIndex = buildLeadPhoneIndex(leads);
  const callFollowUpsByLead = new Map<string, FollowUpScheduleCandidate[]>();

  for (const lead of leads) {
    const leadId = normalizeLeadId(lead.id);
    if (!leadId) continue;
    validLeadIds.add(leadId);
    metricsByLead[leadId] = { ...EMPTY_INTERACTION_METRICS };
  }

  for (const call of calls) {
    const directLeadId = normalizeLeadId(call.leadId);
    const resolvedLeadId =
      (directLeadId && validLeadIds.has(directLeadId) ? directLeadId : null) ||
      resolveLeadIdByPhone([call.telefone, call.called, call.caller], leadPhoneIndex);
    if (!resolvedLeadId || !metricsByLead[resolvedLeadId]) continue;
    metricsByLead[resolvedLeadId].totalCalls += 1;
  }

  for (const wrapup of wrapups) {
    const directLeadId = normalizeLeadId(wrapup.leadId);
    const resolvedLeadId =
      (directLeadId && validLeadIds.has(directLeadId) ? directLeadId : null) ||
      resolveLeadIdByPhone([wrapup.telefone], leadPhoneIndex);
    if (!resolvedLeadId || !metricsByLead[resolvedLeadId]) continue;

    const followUpDate = String(wrapup.followUpDate || "").trim();
    const followUpTime = String(wrapup.followUpTime || "").trim();
    const followUpDateTime = buildLocalDateTime(followUpDate, followUpTime);
    if (!followUpDateTime) continue;

    metricsByLead[resolvedLeadId].totalFollowUps += 1;

    if (resolveFollowUpChannel(wrapup.nextAction) === "call") {
      const current = callFollowUpsByLead.get(resolvedLeadId) || [];
      current.push({
        date: followUpDate,
        dateTime: followUpDateTime,
      });
      callFollowUpsByLead.set(resolvedLeadId, current);
    }
  }

  const referenceTimestamp = referenceDate.getTime();
  for (const leadId of validLeadIds) {
    const candidates = callFollowUpsByLead.get(leadId) || [];
    if (candidates.length === 0) continue;

    const futureCandidates = candidates
      .filter((candidate) => candidate.dateTime.getTime() >= referenceTimestamp)
      .sort((a, b) => a.dateTime.getTime() - b.dateTime.getTime());

    if (futureCandidates.length > 0) {
      metricsByLead[leadId].hasScheduledCall = true;
      metricsByLead[leadId].conversionDate = futureCandidates[0].date;
      continue;
    }

    const latestCandidate = [...candidates].sort((a, b) => b.dateTime.getTime() - a.dateTime.getTime())[0];
    metricsByLead[leadId].conversionDate = latestCandidate?.date || null;
  }

  return metricsByLead;
}

function extractDialCallId(payload: unknown): string | undefined {
  const tryReadId = (value: unknown): string | undefined => {
    if (!value || typeof value !== "object") return undefined;
    const source = value as Record<string, unknown>;
    const direct = String(
      source.externalCallId || source.id || source.call_id || source.callId || source.uniqueid || "",
    ).trim();
    return direct || undefined;
  };
  const walk = (value: unknown, depth: number): string | undefined => {
    if (depth > 4) return undefined;
    const direct = tryReadId(value);
    if (direct) return direct;
    if (!value || typeof value !== "object") return undefined;
    const source = value as Record<string, unknown>;
    for (const nested of Object.values(source)) {
      if (nested && typeof nested === "object") {
        const found = walk(nested, depth + 1);
        if (found) return found;
      }
    }
    return undefined;
  };
  return walk(payload, 0);
}

function phoneQualityLabel(value?: string) {
  if (value === "bom") return "Bom";
  if (value === "ruim") return "Ruim";
  return "Nao classificado";
}

function phoneQualityBadgeClass(value?: string) {
  if (value === "bom") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  if (value === "ruim") return "border-rose-500/40 bg-rose-500/10 text-rose-300";
  return "border-slate-600/80 bg-slate-700/40 text-slate-300";
}

const RESPONSAVEL_REQUIRED_MESSAGE =
  "Seu usuario ainda nao esta vinculado a um responsavel no CRM. Cadastre esse e-mail em Configuracoes > Responsaveis antes de realizar ligacoes.";

export function OutboundLeadsTable({ leads, onSelectLead, onDeleteLeads }: OutboundLeadsTableProps) {
  const { currentUser } = useAuth();
  const router = useRouter();
  const topScrollRef = useRef<HTMLDivElement | null>(null);
  const bottomScrollRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const syncingScrollRef = useRef<"top" | "bottom" | null>(null);
  const dragStartXRef = useRef(0);
  const dragStartScrollLeftRef = useRef(0);
  const isDraggingRef = useRef(false);
  const suppressClickRef = useRef(false);
  const feedbackTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [scrollContentWidth, setScrollContentWidth] = useState(2000);
  const [isDragging, setIsDragging] = useState(false);
  const [callingLeadId, setCallingLeadId] = useState<string | null>(null);
  const [callFeedbackByLead, setCallFeedbackByLead] = useState<Record<string, CallFeedback>>({});
  const [responsavelMissingModalOpen, setResponsavelMissingModalOpen] = useState(false);
  const [phonePickerLead, setPhonePickerLead] = useState<Lead | null>(null);
  const [selectedDialPhone, setSelectedDialPhone] = useState("");
  const [expedienteReferenceDate, setExpedienteReferenceDate] = useState<Date>(() => new Date());
  const [metricsReferenceDate, setMetricsReferenceDate] = useState<Date>(() => new Date());
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [leadWrapups, setLeadWrapups] = useState<PostCallWrapup[]>(() => getPostCallWrapups());

  const leadInteractionMetricsById = useMemo(
    () =>
      buildLeadInteractionMetricsById({
        leads,
        calls: callLogs,
        wrapups: leadWrapups,
        referenceDate: metricsReferenceDate,
      }),
    [callLogs, leadWrapups, leads, metricsReferenceDate],
  );

  const tableRows = useMemo(
    () =>
      leads.map((lead) => ({
        lead,
        location: parseCityState(lead.city),
        expediente: resolveLeadExpedienteStatusFromHorario(lead.horario_funcionamento, {
          referenceDate: expedienteReferenceDate,
        }),
        metrics: leadInteractionMetricsById[lead.id] || EMPTY_INTERACTION_METRICS,
      })),
    [expedienteReferenceDate, leadInteractionMetricsById, leads],
  );

  const setCallFeedback = (leadId: string, feedback: CallFeedback) => {
    setCallFeedbackByLead((prev) => ({ ...prev, [leadId]: feedback }));
    if (feedbackTimeoutsRef.current[leadId]) clearTimeout(feedbackTimeoutsRef.current[leadId]);
    feedbackTimeoutsRef.current[leadId] = setTimeout(() => {
      setCallFeedbackByLead((prev) => {
        const next = { ...prev };
        delete next[leadId];
        return next;
      });
      delete feedbackTimeoutsRef.current[leadId];
    }, 6000);
  };

  const callLead = async (lead: Lead, phoneToDial: string) => {
    if (!phoneToDial) {
      setCallFeedback(lead.id, { type: "error", message: "Lead sem telefone para discagem." });
      return;
    }
    const sessionController = new AbortController();
    const blocking = await resolveBlockingStateBeforeNewDial(sessionController.signal);
    if (blocking.blocked && blocking.session) {
      const blockingMessage =
        blocking.reason === "pending_wrapup"
          ? "Existe uma ligacao encerrada aguardando finalizacao obrigatoria. Finalize antes de iniciar outra."
          : "Existe uma ligacao em andamento. Conclua essa chamada antes de iniciar outra.";
      setCallFeedback(lead.id, { type: "error", message: blockingMessage });
      if (blocking.reason === "pending_wrapup") {
        router.push("/ligacoes?postCall=1");
      }
      return;
    }
    const resolvedResponsavel = await resolveResponsavelFromUserAsync(currentUser);
    if (!currentUser || !resolvedResponsavel.linked || !resolvedResponsavel.responsavel) {
      setCallFeedback(lead.id, { type: "error", message: RESPONSAVEL_REQUIRED_MESSAGE });
      setResponsavelMissingModalOpen(true);
      return;
    }
    setCallingLeadId(lead.id);
    setCallFeedbackByLead((prev) => {
      const next = { ...prev };
      delete next[lead.id];
      return next;
    });
    try {
      const sessionId = generateCallSessionId();
      const response = await fetch("/api/ligacoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          numero: phoneToDial,
          leadId: lead.id,
          nome: lead.name,
          empresa: lead.company,
          responsavelId: resolvedResponsavel.responsavel.id,
          atendenteNome: resolvedResponsavel.responsavel.nome,
        }),
      });
      let data: DialApiResponse | null = null;
      try {
        data = (await response.json()) as DialApiResponse;
      } catch {
        data = null;
      }
      if (!response.ok || !data?.success) {
        setCallFeedback(lead.id, {
          type: "error",
          message: data?.message || data?.error || "Nao foi possivel disparar a ligacao.",
        });
        return;
      }
      setCallFeedback(lead.id, { type: "success", message: data.message || "Ligacao disparada com sucesso." });
      const externalCallId = extractDialCallId(data);
      const session = createDialSession({
        sessionId,
        leadId: lead.id,
        nome: lead.name,
        empresa: lead.company,
        telefone: phoneToDial,
        externalCallId,
        userId: currentUser?.id,
        responsavelId: resolvedResponsavel.responsavel.id,
        atendenteNome: resolvedResponsavel.responsavel.nome,
        sourcePath: typeof window !== "undefined" ? window.location.pathname : "/leads",
      });
      router.push(`/ligacoes?postCall=1&sessionId=${encodeURIComponent(session.sessionId)}`);
    } catch {
      setCallFeedback(lead.id, { type: "error", message: "Falha de rede ao tentar ligar." });
    } finally {
      setCallingLeadId(null);
    }
  };

  const requestDial = (lead: Lead, preferredPhone?: string) => {
    const dialablePhoneItems = getDialablePhoneItemsForLead(lead);
    if (dialablePhoneItems.length === 0) {
      setCallFeedback(lead.id, { type: "error", message: "Lead sem telefone para discagem." });
      return;
    }

    if (dialablePhoneItems.length === 1) {
      void callLead(lead, dialablePhoneItems[0].value);
      return;
    }

    const preferredValidPhone = preferredPhone
      ? dialablePhoneItems.find((item) => isSamePhoneValue(item.value, preferredPhone))?.value
      : "";
    setPhonePickerLead(lead);
    setSelectedDialPhone(preferredValidPhone || dialablePhoneItems[0].value);
  };

  useEffect(() => {
    const syncWidth = () => {
      if (!tableRef.current) return;
      setScrollContentWidth(tableRef.current.scrollWidth);
    };
    syncWidth();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => syncWidth());
    if (tableRef.current) observer.observe(tableRef.current);
    if (bottomScrollRef.current) observer.observe(bottomScrollRef.current);
    return () => observer.disconnect();
  }, [leads.length]);

  useEffect(() => {
    return () => {
      Object.values(feedbackTimeoutsRef.current).forEach((id) => clearTimeout(id));
      feedbackTimeoutsRef.current = {};
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadCallLogs = async () => {
      try {
        const response = await fetch("/api/ligacoes", {
          method: "GET",
          cache: "no-store",
        });
        const data = (await response.json()) as InternalCallsApiResponse;
        if (!response.ok || !data.success || !Array.isArray(data.calls)) return;
        if (cancelled) return;
        setCallLogs(data.calls);
      } catch {
        // Ignore transient loading failures and keep the last successful snapshot
      }
    };

    void loadCallLogs();
    const intervalId = window.setInterval(() => {
      void loadCallLogs();
    }, 45000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    setLeadWrapups(getPostCallWrapups());
    return subscribePostCallFlow(() => {
      setLeadWrapups(getPostCallWrapups());
    });
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setExpedienteReferenceDate(new Date());
    }, 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setMetricsReferenceDate(new Date());
    }, 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [leads]);

  const allSelected = tableRows.length > 0 && tableRows.every(({ lead }) => selectedIds.has(lead.id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(tableRows.map(({ lead }) => lead.id)));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleTopScroll = () => {
    if (!topScrollRef.current || !bottomScrollRef.current) return;
    if (syncingScrollRef.current === "bottom") { syncingScrollRef.current = null; return; }
    syncingScrollRef.current = "top";
    bottomScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
  };

  const handleBottomScroll = () => {
    if (!topScrollRef.current || !bottomScrollRef.current) return;
    if (syncingScrollRef.current === "top") { syncingScrollRef.current = null; return; }
    syncingScrollRef.current = "bottom";
    topScrollRef.current.scrollLeft = bottomScrollRef.current.scrollLeft;
  };

  const isInteractiveTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    return Boolean(target.closest("button, input, select, textarea, a, label"));
  };

  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (!bottomScrollRef.current) return;
    if (isInteractiveTarget(event.target)) return;
    isDraggingRef.current = true;
    setIsDragging(true);
    suppressClickRef.current = false;
    dragStartXRef.current = event.clientX;
    dragStartScrollLeftRef.current = bottomScrollRef.current.scrollLeft;
  };

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!isDraggingRef.current || !bottomScrollRef.current) return;
      const deltaX = event.clientX - dragStartXRef.current;
      if (Math.abs(deltaX) > 3) suppressClickRef.current = true;
      event.preventDefault();
      bottomScrollRef.current.scrollLeft = dragStartScrollLeftRef.current - deltaX;
    };
    const stopDragging = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      setIsDragging(false);
      setTimeout(() => { suppressClickRef.current = false; }, 0);
    };
    window.addEventListener("mousemove", handleMouseMove, { passive: false });
    window.addEventListener("mouseup", stopDragging);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopDragging);
    };
  }, []);

  return (
    <div className="panel overflow-hidden">
      {selectedIds.size > 0 ? (
        <div className="flex items-center gap-3 border-b border-rose-500/30 bg-rose-500/10 px-4 py-2.5">
          <span className="text-[13px] text-rose-300">
            {selectedIds.size} {selectedIds.size === 1 ? "lead selecionado" : "leads selecionados"}
          </span>
          <button
            type="button"
            className="rounded-md border border-rose-400/50 bg-rose-500/20 px-3 py-1 text-[12px] text-rose-200 transition hover:bg-rose-500/30"
            onClick={() => {
              onDeleteLeads(Array.from(selectedIds));
              setSelectedIds(new Set());
            }}
          >
            Apagar selecionados
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1 text-[12px] text-slate-400 transition hover:text-slate-200"
            onClick={() => setSelectedIds(new Set())}
          >
            Cancelar
          </button>
        </div>
      ) : null}
      <div
        ref={topScrollRef}
        onScroll={handleTopScroll}
        className="overflow-x-auto border-b border-border/70 bg-slate-950/30"
        aria-label="Rolagem horizontal superior da tabela de leads outbound"
      >
        <div style={{ width: scrollContentWidth, height: "14px" }} />
      </div>
      <div
        ref={bottomScrollRef}
        onScroll={handleBottomScroll}
        onMouseDown={handleMouseDown}
        className={`overflow-x-auto ${isDragging ? "cursor-grabbing select-none" : "cursor-grab"}`}
      >
        <table ref={tableRef} className="w-full min-w-[3000px] text-left">
          <thead className="border-b border-border bg-slate-900/60 text-[11px] uppercase tracking-[0.08em] text-muted">
            <tr>
              <th className="w-9 px-3 py-2.5 xl:px-3.5 2xl:py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="h-3.5 w-3.5 cursor-pointer accent-sky-500"
                  onClick={(e) => e.stopPropagation()}
                  aria-label="Selecionar todos"
                />
              </th>
              <th className="w-[14rem] whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Empresa</th>
              <th className="w-[12rem] whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Responsavel</th>
              <th className="w-[12rem] whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Vendedor</th>
              <th className="w-[19rem] whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Telefone</th>
              <th className="w-[14rem] whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Email</th>
              <th className="w-[16rem] whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Site</th>
              <th className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Expediente</th>
              <th className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Data Cadastro</th>
              <th className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">1o Contato</th>
              <th className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Acionado Base</th>
              <th className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Ultimo Contato</th>
              <th className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Nota</th>
              <th className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Avaliacoes</th>
              <th className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Cidade</th>
              <th className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Estado</th>
              <th className="w-[12rem] whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Origem</th>
              <th className="w-[9rem] whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Total de Ligacoes</th>
              <th className="w-[10rem] whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Total de Follow-ups</th>
              <th className="w-[9rem] whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Call Agendada</th>
              <th className="w-[10rem] whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Data de Conversao</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map(({ lead, location, expediente, metrics }) => {
              const phones = getLeadPhones(lead);
              const hasBaseActivation = metrics.totalCalls > 0 || Boolean(String(lead.firstContactDate || "").trim());
              return (
                <tr
                key={lead.id}
                onClick={() => {
                  if (suppressClickRef.current) return;
                  onSelectLead(lead);
                }}
                className="cursor-pointer border-b border-border/70 text-[13px] text-slate-200 transition-all duration-150 hover:bg-sky-900/35 hover:shadow-[inset_0_0_0_1px_rgba(56,189,248,0.28)] xl:text-sm"
              >
                <td className="w-9 px-3 py-2.5 xl:px-3.5 2xl:py-2">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(lead.id)}
                    onChange={() => toggleSelect(lead.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="h-3.5 w-3.5 cursor-pointer accent-sky-500"
                    aria-label={`Selecionar ${lead.company || lead.name}`}
                  />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 font-medium xl:px-3.5 2xl:py-2">
                  <TruncatedCellText value={lead.company} fallback="-" widthClass="w-[14rem] max-w-[14rem]" />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">
                  <TruncatedCellText
                    value={lead.name !== lead.company ? lead.name : ""}
                    widthClass="w-[12rem] max-w-[12rem]"
                  />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">
                  <TruncatedCellText value={lead.owner} fallback="-" widthClass="w-[12rem] max-w-[12rem]" />
                </td>
                <td className="px-3 py-2.5 xl:px-3.5 2xl:py-2">
                  <div className="w-[19rem] max-w-[19rem] space-y-1.5">
                    {(phones.length > 0 ? phones : [""]).map((phone, index) => {
                      const displayPhone = normalizePhoneValue(phone) || "-";
                      const canDialPhone = isDialablePhone(phone);
                      return (
                        <div
                          key={`${lead.id}-phone-${displayPhone}-${index}`}
                          className="flex items-center justify-between gap-2"
                        >
                          <TruncatedCellText value={displayPhone} widthClass="w-[11.5rem] max-w-[11.5rem]" />
                          <button
                            type="button"
                            className="min-w-[74px] rounded-md border border-emerald-400/40 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-200 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={callingLeadId === lead.id || !canDialPhone}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!canDialPhone) return;
                              requestDial(lead, phone);
                            }}
                            title={!canDialPhone ? "Telefone indisponivel para ligacao." : undefined}
                          >
                            {callingLeadId === lead.id ? "Ligando..." : "Ligar"}
                          </button>
                        </div>
                      );
                    })}
                    {callFeedbackByLead[lead.id] ? (
                      <p
                        className={`text-[11px] ${
                          callFeedbackByLead[lead.id].type === "success" ? "text-emerald-300" : "text-rose-300"
                        }`}
                      >
                        {callFeedbackByLead[lead.id].message}
                      </p>
                    ) : null}
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">
                  <TruncatedCellText value={lead.email} fallback="-" widthClass="w-[14rem] max-w-[14rem]" />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">
                  {lead.site ? (
                    <TruncatedCellLink
                      value={lead.site}
                      href={lead.site.startsWith("http") ? lead.site : `https://${lead.site}`}
                      onClick={(e) => e.stopPropagation()}
                      widthClass="w-[16rem] max-w-[16rem]"
                      className="text-sky-400 underline underline-offset-2 transition hover:text-sky-300"
                    />
                  ) : (
                    <TruncatedCellText value="" fallback="-" widthClass="w-[16rem] max-w-[16rem]" />
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">
                  <span
                    className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${expedienteStyle[expediente]}`}
                  >
                    {expediente}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">
                  {formatDateBR(lead.entryDate)}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">
                  {formatDateBR(lead.firstContactDate || null)}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">
                  <span
                    className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      hasBaseActivation
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                        : "border-slate-600/80 bg-slate-700/40 text-slate-300"
                    }`}
                  >
                    {hasBaseActivation ? "Sim" : "Nao"}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">
                  <TruncatedCellText
                    value={formatLastInteraction(lead.lastInteraction)}
                    fallback="-"
                    widthClass="w-[11rem] max-w-[11rem]"
                  />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">
                  {formatNota(lead.nota)}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">
                  {formatAvaliacoes(lead.avaliacoes)}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">{location.city}</td>
                <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">{location.state}</td>
                <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">
                  <TruncatedCellText value={lead.source} fallback="-" widthClass="w-[12rem] max-w-[12rem]" />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">{metrics.totalCalls}</td>
                <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">{metrics.totalFollowUps}</td>
                <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">
                  <span
                    className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      metrics.hasScheduledCall
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                        : "border-slate-600/80 bg-slate-700/40 text-slate-300"
                    }`}
                  >
                    {metrics.hasScheduledCall ? "Sim" : "Nao"}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">
                  {metrics.conversionDate ? formatDateBR(metrics.conversionDate) : "-"}
                </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal
        title="Ligacao nao permitida"
        open={responsavelMissingModalOpen}
        onClose={() => setResponsavelMissingModalOpen(false)}
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-200">{RESPONSAVEL_REQUIRED_MESSAGE}</p>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-primary" onClick={() => setResponsavelMissingModalOpen(false)}>
              Entendi
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        title="Selecionar telefone"
        open={Boolean(phonePickerLead)}
        onClose={() => {
          setPhonePickerLead(null);
          setSelectedDialPhone("");
        }}
      >
        {phonePickerLead ? (
          <div className="space-y-3">
            {(() => {
              const phoneItems = getDialablePhoneItemsForLead(phonePickerLead);
              const fallbackPrimaryPhone = phoneItems[0]?.value || "";
              const configuredPrimaryPhone = isDialablePhone(phonePickerLead.phone)
                ? String(phonePickerLead.phone)
                : fallbackPrimaryPhone;
              const hasSelectedDialPhone = phoneItems.some((item) => isSamePhoneValue(item.value, selectedDialPhone));
              return (
                <>
            <p className="text-sm text-slate-200">
              Escolha o numero para ligar para <span className="font-semibold">{phonePickerLead.name}</span>.
            </p>
            <label className="text-[11px] uppercase tracking-[0.08em] text-muted">
              Telefones disponiveis
              <select
                className="field mt-1 h-9 px-2.5 py-1.5 text-xs"
                value={selectedDialPhone}
                onChange={(e) => setSelectedDialPhone(e.target.value)}
              >
                {phoneItems.length === 0 ? <option value="">Nenhum telefone valido</option> : null}
                {phoneItems.map((item) => {
                  const isPrimary = isSamePhoneValue(item.value, configuredPrimaryPhone);
                  return (
                    <option key={item.value} value={item.value}>
                      {item.value} - {phoneQualityLabel(item.quality)}
                      {isPrimary ? " - Principal" : ""}
                    </option>
                  );
                })}
              </select>
            </label>
            <div className="max-h-28 space-y-1 overflow-y-auto rounded-lg border border-border bg-slate-950/50 p-2">
              {phoneItems.length === 0 ? (
                <p className="text-xs text-slate-400">Nenhum telefone valido para discagem neste lead.</p>
              ) : (
                phoneItems.map((item) => {
                  const isPrimary = isSamePhoneValue(item.value, configuredPrimaryPhone);
                  return (
                    <div
                      key={`phone-quality-${item.value}`}
                      className="flex items-center justify-between gap-2 text-xs text-slate-200"
                    >
                      <span className="font-mono">{item.value}</span>
                      <div className="flex items-center gap-1.5">
                        {isPrimary ? (
                          <span className="rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.06em] text-sky-200">
                            Principal
                          </span>
                        ) : null}
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.06em] ${phoneQualityBadgeClass(item.quality)}`}
                        >
                          {phoneQualityLabel(item.quality)}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-ghost h-9 px-3 py-1.5 text-xs"
                onClick={() => {
                  setPhonePickerLead(null);
                  setSelectedDialPhone("");
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary h-9 px-3 py-1.5 text-xs"
                onClick={() => {
                  const selectedPhone = phoneItems.find((item) => isSamePhoneValue(item.value, selectedDialPhone));
                  if (!phonePickerLead || !selectedPhone) return;
                  const lead = phonePickerLead;
                  const phone = selectedPhone.value;
                  setPhonePickerLead(null);
                  setSelectedDialPhone("");
                  void callLead(lead, phone);
                }}
                disabled={!hasSelectedDialPhone}
              >
                Iniciar ligacao
              </button>
            </div>
                </>
              );
            })()}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

