"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Modal } from "@/components/ui/modal";
import { getLeadPhones } from "@/lib/lead-contact-utils";
import { resolveLeadExpedienteStatusFromHorario } from "@/lib/lead-expediente";
import { resolveResponsavelFromUser, resolveResponsavelFromUserAsync } from "@/lib/responsavel-resolver";
import {
  createDialSession,
  generateCallSessionId,
  getPostCallWrapups,
  resolveBlockingStateBeforeNewDial,
  subscribePostCallFlow,
  type PostCallWrapup,
} from "@/lib/post-call-flow";
import { CallLog, Lead } from "@/types/crm";
import { TruncatedCellText } from "./table-cell-truncate";

type OutboundLeadsTableProps = {
  leads: Lead[];
  onSelectLead: (lead: Lead) => void;
  onEditLead: (lead: Lead) => void;
  onDeleteLeads: (ids: string[]) => void;
  mode?: "outbound" | "callback";
};

type SortCol =
  | "company"
  | "socios"
  | "owner"
  | "telefoneGoogle"
  | "telefoneCnpj"
  | "expediente"
  | "nota"
  | "avaliacoes"
  | "tempoCnpj"
  | "rlSite"
  | "source"
  | "acionadoBase"
  | "retornos";

type SortDir = "asc" | "desc";

const tableTextCollator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

function compareRowsByStableIdentity(
  a: { lead: Lead },
  b: { lead: Lead },
): number {
  const byName = tableTextCollator.compare(String(a.lead.name || ""), String(b.lead.name || ""));
  if (byName !== 0) return byName;

  const byCompany = tableTextCollator.compare(String(a.lead.company || ""), String(b.lead.company || ""));
  if (byCompany !== 0) return byCompany;

  return String(a.lead.id || "").localeCompare(String(b.lead.id || ""), "pt-BR", {
    sensitivity: "base",
    numeric: true,
  });
}

function SortHeader({
  col, label, width, active, dir, onSort,
}: {
  col: SortCol; label: string; width?: string;
  active: boolean; dir: SortDir; onSort: (col: SortCol) => void;
}) {
  return (
    <th
      className={`whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2 cursor-pointer select-none${width ? ` ${width}` : ""}${active ? " text-slate-100" : ""}`}
      onClick={() => onSort(col)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={`text-[10px] ${active ? "text-sky-400" : "text-muted/40"}`}>
          {active ? (dir === "asc" ? "↑" : "↓") : "⇅"}
        </span>
      </span>
    </th>
  );
}

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
  callbackCalls: number;
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

function normalizeSocioKey(value?: string | null): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function uniqSocios(values: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const value of values) {
    const normalized = normalizeSocioKey(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    next.push(String(value || "").trim());
  }
  return next;
}

function getLeadSociosList(lead: Lead): string[] {
  const fromSocios = Array.isArray(lead.socios)
    ? lead.socios.map((value) => String(value || "").trim()).filter(Boolean)
    : String(lead.socios || "")
        .split(/[|;,]/)
        .map((value) => value.trim())
        .filter(Boolean);

  const fromNames = Array.isArray(lead.names)
    ? lead.names.map((value) => String(value || "").trim()).filter(Boolean)
    : [];

  const legacyName = String(lead.name || "").trim();
  const merged = uniqSocios([
    ...fromSocios,
    ...fromNames,
    ...(legacyName ? [legacyName] : []),
  ]);

  const companyKey = normalizeSocioKey(lead.company);
  return merged.filter((value) => normalizeSocioKey(value) !== companyKey);
}

function getLeadSociosLabel(lead: Lead): string {
  const socios = getLeadSociosList(lead);
  return socios.length > 0 ? socios.join(", ") : "-";
}

function uniqPhones(values: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const raw of values) {
    const value = normalizePhoneValue(raw);
    if (!value) continue;
    const key = normalizePhoneDigits(value) || value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(value);
  }
  return next;
}

function parseLeadPhoneColumn(value?: string[] | string | null): string[] {
  if (Array.isArray(value)) {
    return uniqPhones(value.map((item) => String(item || "").trim()));
  }

  const raw = String(value || "").trim();
  if (!raw) return [];

  return uniqPhones(
    raw
      .split(/[\n\r|;,]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function getLeadTelefoneGoogleList(lead: Lead): string[] {
  return parseLeadPhoneColumn(lead.telefone_google);
}

function getLeadTelefoneCnpjList(lead: Lead): string[] {
  return parseLeadPhoneColumn(lead.telefone_cnpj);
}

function getLeadRlSite(lead: Lead): string {
  const raw = String(lead.rl_site || "").trim();
  return raw || "-";
}

function formatTempoCnpj(value?: number | string | null): string {
  if (value == null || value === "") return "-";
  if (typeof value === "number") return Number.isFinite(value) ? `${value}` : "-";
  const text = String(value).trim();
  return text || "-";
}

function sortValueTempoCnpj(value?: number | string | null): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").trim().replace(",", ".");
  const parsed = Number.parseFloat(text);
  if (Number.isFinite(parsed)) return parsed;
  const digits = text.replace(/[^\d.-]/g, "");
  const fallback = Number.parseFloat(digits);
  return Number.isFinite(fallback) ? fallback : Number.NEGATIVE_INFINITY;
}

function formatSortablePhone(value?: string | null): string {
  const normalized = normalizePhoneValue(value);
  if (!normalized) return "";
  const digits = normalizePhoneDigits(normalized);
  return digits || normalized.toLowerCase();
}

function sortByPhoneText(left?: string | null, right?: string | null): number {
  return formatSortablePhone(left).localeCompare(formatSortablePhone(right), "pt-BR", { sensitivity: "base" });
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
  callbackCalls: 0,
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

function buildCallLogsFingerprint(calls: CallLog[]): string {
  if (calls.length === 0) return "empty";
  return calls
    .map((call) => `${String(call.id || "").trim()}|${String(call.updatedAt || "").trim()}`)
    .join(";");
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

function parseTimestampMs(value?: string | null): number | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
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
  const callbackStartByLead = new Map<string, number>();
  const callFollowUpsByLead = new Map<string, FollowUpScheduleCandidate[]>();

  for (const lead of leads) {
    const leadId = normalizeLeadId(lead.id);
    if (!leadId) continue;
    validLeadIds.add(leadId);
    metricsByLead[leadId] = { ...EMPTY_INTERACTION_METRICS };
    const callbackStart = parseTimestampMs(lead.callbackAt || null);
    if (callbackStart !== null) {
      callbackStartByLead.set(leadId, callbackStart);
    }
  }

  for (const call of calls) {
    const directLeadId = normalizeLeadId(call.leadId);
    const resolvedLeadId =
      (directLeadId && validLeadIds.has(directLeadId) ? directLeadId : null) ||
      resolveLeadIdByPhone([call.telefone, call.called, call.caller], leadPhoneIndex);
    if (!resolvedLeadId || !metricsByLead[resolvedLeadId]) continue;
    metricsByLead[resolvedLeadId].totalCalls += 1;

    const callbackStart = callbackStartByLead.get(resolvedLeadId);
    if (callbackStart !== undefined) {
      const callTimestamp =
        parseTimestampMs(call.startedAt) ??
        parseTimestampMs(call.answeredAt) ??
        parseTimestampMs(call.endedAt) ??
        parseTimestampMs(call.createdAt);
      if (callTimestamp !== null && callTimestamp >= callbackStart) {
        metricsByLead[resolvedLeadId].callbackCalls += 1;
      }
    }
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

const RESPONSAVEL_REQUIRED_MESSAGE =
  "Seu usuario ainda nao esta vinculado a um responsavel no CRM. Cadastre esse e-mail em Configuracoes > Responsaveis antes de realizar ligacoes.";
const OUTBOUND_LEADS_PAGE_SIZE = 100;

export function OutboundLeadsTable({
  leads,
  onSelectLead,
  onEditLead,
  onDeleteLeads,
  mode = "outbound",
}: OutboundLeadsTableProps) {
  const { currentUser } = useAuth();
  const topScrollRef = useRef<HTMLDivElement | null>(null);
  const bottomScrollRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const syncingScrollRef = useRef<"top" | "bottom" | null>(null);
  const dragStartXRef = useRef(0);
  const dragStartScrollLeftRef = useRef(0);
  const isDraggingRef = useRef(false);
  const suppressClickRef = useRef(false);
  const feedbackTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const callLogsFingerprintRef = useRef<string>("empty");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [scrollContentWidth, setScrollContentWidth] = useState(2000);
  const [isDragging, setIsDragging] = useState(false);
  const [callingLeadId, setCallingLeadId] = useState<string | null>(null);
  const [callFeedbackByLead, setCallFeedbackByLead] = useState<Record<string, CallFeedback>>({});
  const [responsavelMissingModalOpen, setResponsavelMissingModalOpen] = useState(false);
  const [phonePickerLead, setPhonePickerLead] = useState<Lead | null>(null);
  const [phonePickerOptions, setPhonePickerOptions] = useState<string[]>([]);
  const [phonePickerTitle, setPhonePickerTitle] = useState("Selecionar telefone");
  const [selectedDialPhone, setSelectedDialPhone] = useState("");
  // Referencia de tempo unificada — atualiza em intervalos e serve tanto para
  // expediente quanto para calculo de metricas (evita dois re-renders por ciclo)
  const [tableReferenceDate, setTableReferenceDate] = useState<Date>(() => new Date());
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [leadWrapups, setLeadWrapups] = useState<PostCallWrapup[]>(() => getPostCallWrapups());

  const leadInteractionMetricsById = useMemo(
    () =>
      buildLeadInteractionMetricsById({
        leads,
        calls: callLogs,
        wrapups: leadWrapups,
        referenceDate: tableReferenceDate,
      }),
    [callLogs, leadWrapups, leads, tableReferenceDate],
  );

  const tableRows = useMemo(
    () =>
      leads.map((lead) => ({
        lead,
        socios: getLeadSociosLabel(lead),
        telefoneGoogleList: getLeadTelefoneGoogleList(lead),
        telefoneCnpjList: getLeadTelefoneCnpjList(lead),
        telefoneGoogleSort: getLeadTelefoneGoogleList(lead)[0] || "",
        telefoneCnpjSort: getLeadTelefoneCnpjList(lead)[0] || "",
        rlSite: getLeadRlSite(lead),
        expediente: resolveLeadExpedienteStatusFromHorario(lead.horario_funcionamento, {
          referenceDate: tableReferenceDate,
        }),
        metrics: leadInteractionMetricsById[lead.id] || EMPTY_INTERACTION_METRICS,
      })),
    [tableReferenceDate, leadInteractionMetricsById, leads],
  );

  const [sortCol, setSortCol] = useState<SortCol | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [currentPage, setCurrentPage] = useState(1);

  const handleSort = (col: SortCol) => {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
    setCurrentPage(1);
  };

  const sortedRows = useMemo(() => {
    if (!sortCol) {
      return [...tableRows].sort(compareRowsByStableIdentity);
    }
    return [...tableRows].sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case "company":      cmp = (a.lead.company || "").localeCompare(b.lead.company || "", "pt-BR", { sensitivity: "base" }); break;
        case "socios":       cmp = (a.socios || "").localeCompare(b.socios || "", "pt-BR", { sensitivity: "base" }); break;
        case "owner":        cmp = (a.lead.owner || "").localeCompare(b.lead.owner || "", "pt-BR", { sensitivity: "base" }); break;
        case "telefoneGoogle": cmp = sortByPhoneText(a.telefoneGoogleSort, b.telefoneGoogleSort); break;
        case "telefoneCnpj": cmp = sortByPhoneText(a.telefoneCnpjSort, b.telefoneCnpjSort); break;
        case "expediente": {
          const order: Record<"Aberto" | "Fechado" | "Indefinido", number> = {
            Aberto: 0,
            Fechado: 1,
            Indefinido: 2,
          };
          cmp = order[a.expediente] - order[b.expediente];
          break;
        }
        case "source":       cmp = (a.lead.source || "").localeCompare(b.lead.source || "", "pt-BR", { sensitivity: "base" }); break;
        case "nota":         cmp = (Number(a.lead.nota) || 0) - (Number(b.lead.nota) || 0); break;
        case "avaliacoes":   cmp = (Number(a.lead.avaliacoes) || 0) - (Number(b.lead.avaliacoes) || 0); break;
        case "tempoCnpj":    cmp = sortValueTempoCnpj(a.lead.tempo_cnpj) - sortValueTempoCnpj(b.lead.tempo_cnpj); break;
        case "rlSite":       cmp = a.rlSite.localeCompare(b.rlSite, "pt-BR", { sensitivity: "base" }); break;
        case "acionadoBase": {
          const getVal = (row: typeof a) => {
            const v =
              mode === "callback"
                ? row.metrics.callbackCalls > 0
                : row.metrics.totalCalls > 0 || Boolean(String(row.lead.firstContactDate || "").trim());
            return v ? 1 : 0;
          };
          cmp = getVal(a) - getVal(b);
          break;
        }
        case "retornos": cmp = a.metrics.callbackCalls - b.metrics.callbackCalls; break;
        default: break;
      }
      if (cmp === 0) {
        return compareRowsByStableIdentity(a, b);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [mode, sortCol, sortDir, tableRows]);

  const totalRows = sortedRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / OUTBOUND_LEADS_PAGE_SIZE));
  const currentPageSafe = Math.min(currentPage, totalPages);
  const pageStartIndex = (currentPageSafe - 1) * OUTBOUND_LEADS_PAGE_SIZE;
  const pagedRows = sortedRows.slice(pageStartIndex, pageStartIndex + OUTBOUND_LEADS_PAGE_SIZE);
  const visibleStart = totalRows === 0 ? 0 : pageStartIndex + 1;
  const visibleEnd = totalRows === 0 ? 0 : pageStartIndex + pagedRows.length;

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
    // Feedback imediato — spinner antes dos checks assincronos
    setCallingLeadId(lead.id);
    setCallFeedbackByLead((prev) => {
      const next = { ...prev };
      delete next[lead.id];
      return next;
    });
    try {
      const sessionController = new AbortController();
      // Tenta cache em memoria primeiro (sem round-trip ao banco)
      const cachedResponsavel = resolveResponsavelFromUser(currentUser);
      // Executa blocking check e resolucao de responsavel em paralelo
      const [blocking, resolvedResponsavel] = await Promise.all([
        resolveBlockingStateBeforeNewDial(sessionController.signal),
        cachedResponsavel.linked
          ? Promise.resolve(cachedResponsavel)
          : resolveResponsavelFromUserAsync(currentUser),
      ]);
      if (blocking.blocked && blocking.session) {
        const blockingMessage =
          blocking.reason === "pending_wrapup"
            ? "Existe uma ligacao encerrada aguardando finalizacao obrigatoria. Finalize antes de iniciar outra."
            : "Existe uma ligacao em andamento. Conclua essa chamada antes de iniciar outra.";
        setCallFeedback(lead.id, { type: "error", message: blockingMessage });
        return;
      }
      if (!currentUser || !resolvedResponsavel.linked || !resolvedResponsavel.responsavel) {
        setCallFeedback(lead.id, { type: "error", message: RESPONSAVEL_REQUIRED_MESSAGE });
        setResponsavelMissingModalOpen(true);
        return;
      }
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
      } catch (error) {
        void error;
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
      createDialSession({
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
      onSelectLead(lead);
    } catch (error) {
      void error;
      setCallFeedback(lead.id, { type: "error", message: "Falha de rede ao tentar ligar." });
    } finally {
      setCallingLeadId(null);
    }
  };

  const requestDial = (lead: Lead, columnPhones: string[], columnLabel: string) => {
    const dialablePhones = uniqPhones(columnPhones).filter((phone) => isDialablePhone(phone));
    if (dialablePhones.length === 0) {
      setCallFeedback(lead.id, { type: "error", message: `Sem telefone valido em ${columnLabel}.` });
      return;
    }

    if (dialablePhones.length === 1) {
      void callLead(lead, dialablePhones[0]);
      return;
    }

    setPhonePickerLead(lead);
    setPhonePickerTitle(`Selecionar telefone (${columnLabel})`);
    setPhonePickerOptions(dialablePhones);
    setSelectedDialPhone(dialablePhones[0]);
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
        const nextFingerprint = buildCallLogsFingerprint(data.calls);
        if (nextFingerprint === callLogsFingerprintRef.current) return;
        callLogsFingerprintRef.current = nextFingerprint;
        setCallLogs(data.calls);
      } catch (error) {
        void error;
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

  // Intervalo unificado: atualiza expediente e metricas num unico re-render por minuto
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setTableReferenceDate(new Date());
    }, 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [leads]);

  useEffect(() => {
    setCurrentPage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);

  const allSelected = pagedRows.length > 0 && pagedRows.every(({ lead }) => selectedIds.has(lead.id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        pagedRows.forEach(({ lead }) => {
          next.delete(lead.id);
        });
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        pagedRows.forEach(({ lead }) => {
          next.add(lead.id);
        });
        return next;
      });
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
        <table ref={tableRef} className="w-full min-w-[2200px] text-left">
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
              <th className="w-[6rem] whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">Acoes</th>
              <SortHeader col="acionadoBase" label="Acionado" active={sortCol === "acionadoBase"} dir={sortDir} onSort={handleSort} />
              {mode === "callback" ? (
                <SortHeader col="retornos" label="Retornos" active={sortCol === "retornos"} dir={sortDir} onSort={handleSort} />
              ) : null}
              <SortHeader col="company" label="Empresa" width="w-[14rem]" active={sortCol === "company"} dir={sortDir} onSort={handleSort} />
              <SortHeader col="socios" label="Socios" width="w-[14rem]" active={sortCol === "socios"} dir={sortDir} onSort={handleSort} />
              <SortHeader col="owner" label="Vendedor" width="w-[12rem]" active={sortCol === "owner"} dir={sortDir} onSort={handleSort} />
              <SortHeader col="telefoneGoogle" label="Telefone Google" width="w-[15rem]" active={sortCol === "telefoneGoogle"} dir={sortDir} onSort={handleSort} />
              <SortHeader col="telefoneCnpj" label="Telefone CNPJ" width="w-[15rem]" active={sortCol === "telefoneCnpj"} dir={sortDir} onSort={handleSort} />
              <SortHeader col="expediente" label="Expediente" active={sortCol === "expediente"} dir={sortDir} onSort={handleSort} />
              <SortHeader col="nota" label="Nota" active={sortCol === "nota"} dir={sortDir} onSort={handleSort} />
              <SortHeader col="avaliacoes" label="Avaliacao" active={sortCol === "avaliacoes"} dir={sortDir} onSort={handleSort} />
              <SortHeader col="tempoCnpj" label="Tempo CNPJ" active={sortCol === "tempoCnpj"} dir={sortDir} onSort={handleSort} />
              <SortHeader col="rlSite" label="RL Site" width="w-[14rem]" active={sortCol === "rlSite"} dir={sortDir} onSort={handleSort} />
              <SortHeader col="source" label="Origem" width="w-[12rem]" active={sortCol === "source"} dir={sortDir} onSort={handleSort} />
            </tr>
          </thead>
          <tbody>
            {pagedRows.map(({ lead, socios, telefoneGoogleList, telefoneCnpjList, rlSite, expediente, metrics }) => {
              const hasBaseActivation =
                mode === "callback"
                  ? metrics.callbackCalls > 0
                  : metrics.totalCalls > 0 || Boolean(String(lead.firstContactDate || "").trim());

              const telefoneGoogleDisplay = telefoneGoogleList.length > 0 ? telefoneGoogleList : ["-"];
              const telefoneCnpjDisplay = telefoneCnpjList.length > 0 ? telefoneCnpjList : ["-"];
              const canDialGoogle = telefoneGoogleList.some((phone) => isDialablePhone(phone));
              const canDialCnpj = telefoneCnpjList.some((phone) => isDialablePhone(phone));

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
                  <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">
                    <button
                      type="button"
                      className="rounded-md border border-sky-500/40 bg-sky-500/10 px-2 py-1 text-[11px] text-sky-300 transition hover:bg-sky-500/20"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditLead(lead);
                      }}
                    >
                      Editar
                    </button>
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
                  {mode === "callback" ? (
                    <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">{metrics.callbackCalls}</td>
                  ) : null}
                  <td className="whitespace-nowrap px-3 py-2.5 font-medium xl:px-3.5 2xl:py-2">
                    <TruncatedCellText value={lead.company} fallback="-" widthClass="w-[14rem] max-w-[14rem]" />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">
                    <TruncatedCellText value={socios} fallback="-" widthClass="w-[14rem] max-w-[14rem]" />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">
                    <TruncatedCellText value={lead.owner} fallback="-" widthClass="w-[12rem] max-w-[12rem]" />
                  </td>
                  <td className="px-3 py-2.5 xl:px-3.5 2xl:py-2">
                    <div className="flex w-[15rem] max-w-[15rem] items-center justify-between gap-2">
                      <div className="max-h-16 flex-1 space-y-1 overflow-y-auto pr-1">
                        {telefoneGoogleDisplay.map((phone, index) => (
                          <TruncatedCellText
                            key={`${lead.id}-google-${phone}-${index}`}
                            value={phone}
                            fallback="-"
                            widthClass="w-[9.5rem] max-w-[9.5rem]"
                          />
                        ))}
                      </div>
                      <button
                        type="button"
                        className="min-w-[74px] rounded-md border border-emerald-400/40 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-200 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={callingLeadId === lead.id || !canDialGoogle}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!canDialGoogle) return;
                          requestDial(lead, telefoneGoogleList, "Telefone Google");
                        }}
                        title={!canDialGoogle ? "Telefone indisponivel para ligacao." : undefined}
                      >
                        {callingLeadId === lead.id ? "Ligando..." : "Ligar"}
                      </button>
                    </div>
                    {callFeedbackByLead[lead.id] ? (
                      <p
                        className={`mt-1 text-[11px] ${
                          callFeedbackByLead[lead.id].type === "success" ? "text-emerald-300" : "text-rose-300"
                        }`}
                      >
                        {callFeedbackByLead[lead.id].message}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 xl:px-3.5 2xl:py-2">
                    <div className="flex w-[15rem] max-w-[15rem] items-center justify-between gap-2">
                      <div className="max-h-16 flex-1 space-y-1 overflow-y-auto pr-1">
                        {telefoneCnpjDisplay.map((phone, index) => (
                          <TruncatedCellText
                            key={`${lead.id}-cnpj-${phone}-${index}`}
                            value={phone}
                            fallback="-"
                            widthClass="w-[9.5rem] max-w-[9.5rem]"
                          />
                        ))}
                      </div>
                      <button
                        type="button"
                        className="min-w-[74px] rounded-md border border-emerald-400/40 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-200 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={callingLeadId === lead.id || !canDialCnpj}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!canDialCnpj) return;
                          requestDial(lead, telefoneCnpjList, "Telefone CNPJ");
                        }}
                        title={!canDialCnpj ? "Telefone indisponivel para ligacao." : undefined}
                      >
                        {callingLeadId === lead.id ? "Ligando..." : "Ligar"}
                      </button>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">
                    <span
                      className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${expedienteStyle[expediente]}`}
                    >
                      {expediente}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">{formatNota(lead.nota)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">{formatAvaliacoes(lead.avaliacoes)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">{formatTempoCnpj(lead.tempo_cnpj)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">
                    <TruncatedCellText value={rlSite} fallback="-" widthClass="w-[14rem] max-w-[14rem]" />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 xl:px-3.5 2xl:py-2">
                    <TruncatedCellText value={lead.source} fallback="-" widthClass="w-[12rem] max-w-[12rem]" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border/70 bg-slate-950/30 px-3 py-2.5 text-xs text-slate-300 xl:px-3.5">
        <span>
          {visibleStart}-{visibleEnd} de {totalRows} leads
        </span>
        <div className="flex items-center gap-2">
          <span>
            Pagina {currentPageSafe} / {totalPages}
          </span>
          <button
            type="button"
            className="rounded-md border border-border px-2.5 py-1 transition hover:border-slate-500 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
            disabled={currentPageSafe <= 1}
          >
            Anterior
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-2.5 py-1 transition hover:border-slate-500 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={currentPageSafe >= totalPages}
          >
            Proximo
          </button>
        </div>
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
        title={phonePickerTitle}
        open={Boolean(phonePickerLead)}
        onClose={() => {
          setPhonePickerLead(null);
          setPhonePickerOptions([]);
          setPhonePickerTitle("Selecionar telefone");
          setSelectedDialPhone("");
        }}
      >
        {phonePickerLead ? (
          <div className="space-y-3">
            {(() => {
              const hasSelectedDialPhone = phonePickerOptions.some((item) => isSamePhoneValue(item, selectedDialPhone));
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
                {phonePickerOptions.length === 0 ? <option value="">Nenhum telefone valido</option> : null}
                {phonePickerOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <div className="max-h-28 space-y-1 overflow-y-auto rounded-lg border border-border bg-slate-950/50 p-2">
              {phonePickerOptions.length === 0 ? (
                <p className="text-xs text-slate-400">Nenhum telefone valido para discagem neste lead.</p>
              ) : (
                phonePickerOptions.map((item) => {
                  return (
                    <div
                      key={`phone-picker-${item}`}
                      className="flex items-center justify-between gap-2 text-xs text-slate-200"
                    >
                      <span className="font-mono">{item}</span>
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
                  setPhonePickerOptions([]);
                  setPhonePickerTitle("Selecionar telefone");
                  setSelectedDialPhone("");
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary h-9 px-3 py-1.5 text-xs"
                onClick={() => {
                  const selectedPhone = phonePickerOptions.find((item) => isSamePhoneValue(item, selectedDialPhone));
                  if (!phonePickerLead || !selectedPhone) return;
                  const lead = phonePickerLead;
                  const phone = selectedPhone;
                  setPhonePickerLead(null);
                  setPhonePickerOptions([]);
                  setPhonePickerTitle("Selecionar telefone");
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
