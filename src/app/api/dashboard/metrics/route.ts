import { NextResponse } from "next/server";
import { getCallLogs } from "@/lib/calls-store";
import { isAgendaEventLinkedToLead, normalizeAgendaEventStatus, normalizeText } from "@/lib/agenda-events";
import { getLeadPhones } from "@/lib/lead-contact-utils";
import { readCustomersCollection, readLeadsCollection } from "@/lib/leads-customers-store";
import { readDataFile } from "@/lib/storage-paths";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth } from "@/lib/require-auth";
import type { DashboardMetrics } from "@/types/dashboard";
import type { CallLog, Lead, LeadFinalizationRecord, Meeting } from "@/types/crm";
import type { PostCallWrapup } from "@/lib/post-call-flow";

const MEETINGS_FILE = "crm.agenda.meetings.v1.json";
const LEAD_FINALIZATIONS_FILE = "crm.leads.finalizations.v1.json";
const WRAPUPS_FILE = "crm.calls.wrapups.v1.json";
const CRM_TIMEZONE_OFFSET = "-03:00";
const DEFAULT_PERIOD_DAYS = 7;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const BR_DATE_PATTERN = /^(\d{2})\/(\d{2})\/(\d{4})$/;

type MetricsRequestFilters = {
  from: string;
  to: string;
  rangeStart: Date;
  rangeEnd: Date;
  vendedorId?: string;
  vendedorNome?: string;
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeLeadId(value?: string | null): string {
  return String(value || "").trim();
}

function normalizeDigits(value?: string | null): string {
  return String(value || "").replace(/\D/g, "");
}

function safePercent(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return (numerator / denominator) * 100;
}

function parseTime(value?: string | null): { hour: number; minute: number } | null {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function buildLocalDateTime(date?: string | null, time?: string | null): Date | null {
  const rawDate = String(date || "").trim();
  const parsedTime = parseTime(time);
  const dateMatch = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateMatch || !parsedTime) return null;

  const isoWithOffset = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}T${String(parsedTime.hour).padStart(2, "0")}:${String(parsedTime.minute).padStart(2, "0")}:00${CRM_TIMEZONE_OFFSET}`;
  const parsed = new Date(isoWithOffset);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed;
}

function toDateInputValue(date: Date): string {
  const localTimestamp = date.getTime() - date.getTimezoneOffset() * 60_000;
  return new Date(localTimestamp).toISOString().slice(0, 10);
}

function getDefaultDateRange(): { from: string; to: string } {
  const toDate = new Date();
  const fromDate = new Date(toDate);
  fromDate.setDate(fromDate.getDate() - (DEFAULT_PERIOD_DAYS - 1));
  return {
    from: toDateInputValue(fromDate),
    to: toDateInputValue(toDate),
  };
}

function parseDateOnly(value?: string | null): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (DATE_ONLY_PATTERN.test(raw)) return raw;
  const brMatch = raw.match(BR_DATE_PATTERN);
  if (!brMatch) return null;
  return `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`;
}

function parseDateTime(value?: string | null): Date | null {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const dateOnly = parseDateOnly(raw);
  if (dateOnly) {
    const parsed = new Date(`${dateOnly}T00:00:00${CRM_TIMEZONE_OFFSET}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function isWithinRange(referenceDate: Date | null, rangeStart: Date, rangeEnd: Date): boolean {
  if (!referenceDate) return true;
  const reference = referenceDate.getTime();
  return reference >= rangeStart.getTime() && reference <= rangeEnd.getTime();
}

function parseFiltersFromRequest(request: Request): MetricsRequestFilters {
  const url = new URL(request.url);
  const defaults = getDefaultDateRange();
  const fromRaw = parseDateOnly(url.searchParams.get("from")) || defaults.from;
  const toRaw = parseDateOnly(url.searchParams.get("to")) || defaults.to;
  const vendedorId = String(url.searchParams.get("vendedorId") || "").trim() || undefined;

  const from = fromRaw <= toRaw ? fromRaw : toRaw;
  const to = fromRaw <= toRaw ? toRaw : fromRaw;

  const rangeStart = new Date(`${from}T00:00:00${CRM_TIMEZONE_OFFSET}`);
  const rangeEnd = new Date(`${to}T23:59:59.999${CRM_TIMEZONE_OFFSET}`);

  return {
    from,
    to,
    rangeStart,
    rangeEnd,
    vendedorId,
  };
}

async function resolveVendedorNome(vendedorId?: string): Promise<string | undefined> {
  const normalizedId = String(vendedorId || "").trim();
  if (!normalizedId) return undefined;

  const admin = getSupabaseAdmin();
  if (!admin) return normalizedId;

  const { data, error } = await admin
    .from("crm_responsaveis")
    .select("nome")
    .eq("id", normalizedId)
    .maybeSingle();

  if (error) {
    console.error("[DASHBOARD] erro ao resolver vendedor", error.message);
    return normalizedId;
  }

  const nome = String(data?.nome || "").trim();
  return nome || normalizedId;
}

function isAnsweredCallStatus(status?: string | null): boolean {
  const normalized = normalizeText(status);
  return normalized === "atendida" || normalized === "answered" || normalized === "conectada";
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
  values: Array<string | null | undefined>,
  leadPhoneIndex: Map<string, Set<string>>,
): string | null {
  const phones = values.map((value) => normalizeDigits(value)).filter(Boolean);
  if (phones.length === 0) return null;

  const exactMatches = new Set<string>();
  for (const phone of phones) {
    const leadIds = leadPhoneIndex.get(phone);
    if (!leadIds || leadIds.size !== 1) continue;
    exactMatches.add(Array.from(leadIds)[0]);
  }
  if (exactMatches.size === 1) return Array.from(exactMatches)[0];

  const fuzzyMatches = new Set<string>();
  for (const phone of phones) {
    for (const [leadPhone, leadIds] of leadPhoneIndex.entries()) {
      if (!(leadPhone.endsWith(phone) || phone.endsWith(leadPhone))) continue;
      for (const leadId of leadIds) fuzzyMatches.add(leadId);
    }
  }
  if (fuzzyMatches.size === 1) return Array.from(fuzzyMatches)[0];

  return null;
}

function resolveScopedLeadIdByCall(
  call: CallLog,
  scopedLeadIds: Set<string>,
  leadPhoneIndex: Map<string, Set<string>>,
): string | null {
  const directLeadId = normalizeLeadId(call.leadId);
  if (directLeadId && scopedLeadIds.has(directLeadId)) return directLeadId;
  const byPhone = resolveLeadIdByPhone([call.telefone, call.called, call.caller], leadPhoneIndex);
  if (byPhone && scopedLeadIds.has(byPhone)) return byPhone;
  return null;
}

function resolveScopedLeadIdByWrapup(
  wrapup: PostCallWrapup,
  scopedLeadIds: Set<string>,
  leadPhoneIndex: Map<string, Set<string>>,
): string | null {
  const directLeadId = normalizeLeadId(wrapup.leadId);
  if (directLeadId && scopedLeadIds.has(directLeadId)) return directLeadId;
  const byPhone = resolveLeadIdByPhone([wrapup.telefone], leadPhoneIndex);
  if (byPhone && scopedLeadIds.has(byPhone)) return byPhone;
  return null;
}

function isNoShowMeeting(meeting: Meeting): boolean {
  const normalizedStatus = normalizeText(meeting.status);
  const normalizedType = normalizeText(meeting.eventType);
  const normalizedReason = normalizeText(meeting.reason);
  const normalizedNotes = normalizeText(meeting.notes);
  const hasNoShowMarker =
    normalizedNotes.includes("no show") ||
    normalizedNotes.includes("no-show") ||
    normalizedNotes.includes("no_show") ||
    normalizedNotes.includes("nao compareceu");

  if (normalizedStatus === "cancelado" && hasNoShowMarker) return true;
  if (normalizedStatus === "concluido" && hasNoShowMarker) return true;
  if (normalizedType === "call_agendada" && normalizedReason === "fechamento" && hasNoShowMarker) return true;
  return false;
}

function isCallSchedulingMeeting(meeting: Meeting): boolean {
  const normalizedType = normalizeText(meeting.eventType);
  const normalizedReason = normalizeText(meeting.reason);
  if (normalizedReason === "fechamento") return true;
  return normalizedType === "call_conversao";
}

function isAgendaScheduledCall(meeting: Meeting): boolean {
  if (!isCallSchedulingMeeting(meeting)) return false;
  const status = normalizeAgendaEventStatus(meeting);
  return status !== "apagado_logico" && status !== "remarcado";
}

function isFollowupMeeting(meeting: Meeting): boolean {
  const normalizedType = normalizeText(meeting.eventType);
  const normalizedReason = normalizeText(meeting.reason);
  if (normalizedType.startsWith("follow_up_")) return true;
  return normalizedReason === "follow-up" || normalizedReason === "follow up";
}

function isFutureActiveFollowup(meeting: Meeting, referenceDate: Date): boolean {
  if (!isFollowupMeeting(meeting)) return false;
  if (normalizeAgendaEventStatus(meeting) !== "ativo") return false;
  const dateTime = buildLocalDateTime(meeting.date, meeting.callTime);
  if (!dateTime) return false;
  return dateTime.getTime() >= referenceDate.getTime();
}

type DecisionContactStage = "fechamento" | "follow_up" | "sem_interesse" | "outro";

function normalizeWrapupResult(value?: string | null): string {
  const normalized = normalizeText(value);
  if (normalized === "cliente sem interesse") return "falou com cliente";
  return normalized;
}

function normalizeWrapupSubfinalizacao(value?: string | null): string {
  const normalized = normalizeText(value);
  if (normalized === "cliente sem interesse") return "sem interesse";
  return normalized;
}

function isSemInteresseWrapup(wrapup: PostCallWrapup): boolean {
  const result = normalizeText(wrapup.result);
  if (result === "cliente sem interesse") return true;

  const normalizedResult = normalizeWrapupResult(wrapup.result);
  const normalizedSubfinalizacao = normalizeWrapupSubfinalizacao(wrapup.nextAction);
  if (normalizedResult !== "falou com cliente") return false;
  return normalizedSubfinalizacao === "sem interesse" || normalizedSubfinalizacao === "sem_interesse";
}

function classifyDecisionContactWrapup(wrapup: PostCallWrapup): DecisionContactStage | null {
  const normalizedResult = normalizeWrapupResult(wrapup.result);
  if (normalizedResult !== "falou com cliente") return null;

  const normalizedSubfinalizacao = normalizeWrapupSubfinalizacao(wrapup.nextAction);
  if (!normalizedSubfinalizacao) return "outro";
  if (normalizedSubfinalizacao === "sem interesse" || normalizedSubfinalizacao === "sem_interesse") return "sem_interesse";
  if (
    normalizedSubfinalizacao === "follow-up" ||
    normalizedSubfinalizacao === "follow up" ||
    normalizedSubfinalizacao === "agendar ligacao" ||
    normalizedSubfinalizacao === "agendar whatsapp" ||
    normalizedSubfinalizacao === "confirmou possibilidade de contato"
  ) {
    return "follow_up";
  }
  if (normalizedSubfinalizacao.includes("video")) return "fechamento";
  return "outro";
}

function getWrapupDedupKey(wrapup: PostCallWrapup): string {
  const callId = normalizeLeadId(wrapup.callId);
  if (callId) return `call:${callId}`;

  const sessionId = normalizeLeadId(wrapup.sessionId);
  if (sessionId) return `session:${sessionId}`;

  const wrapupId = normalizeLeadId(wrapup.id);
  if (wrapupId) return `wrapup:${wrapupId}`;

  const leadId = normalizeLeadId(wrapup.leadId);
  const phoneDigits = normalizeDigits(wrapup.telefone);
  const createdAt = String(wrapup.createdAt || "").trim();
  return `fallback:${leadId}|${phoneDigits}|${createdAt}`;
}

function dedupeWrapups(wrapups: PostCallWrapup[]): PostCallWrapup[] {
  const deduped: PostCallWrapup[] = [];
  const seen = new Set<string>();

  for (const wrapup of wrapups) {
    const key = getWrapupDedupKey(wrapup);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(wrapup);
  }

  return deduped;
}

function getCallReferenceDate(call: CallLog): Date | null {
  return parseDateTime(call.startedAt || call.createdAt || null);
}

function getWrapupReferenceDate(wrapup: PostCallWrapup): Date | null {
  return parseDateTime(wrapup.createdAt || wrapup.updatedAt || null);
}

function getMeetingReferenceDate(meeting: Meeting): Date | null {
  const bySlot = buildLocalDateTime(meeting.date, meeting.callTime);
  if (bySlot) return bySlot;
  return parseDateTime(meeting.createdAt || meeting.updatedAt || null);
}

function getLeadReferenceDate(lead: Lead): Date | null {
  return parseDateTime(lead.entryDate || lead.finalizedAt || lead.convertedToCustomerAt || null);
}

function getFinalizationReferenceDate(record: LeadFinalizationRecord): Date | null {
  return parseDateTime(record.finalizedAt || null);
}

function normalizeOwnerName(value?: string | null): string {
  return normalizeText(value);
}

function matchesVendedor(ownerName: string | undefined, vendedorNome?: string): boolean {
  if (!vendedorNome) return true;
  return normalizeOwnerName(ownerName) === normalizeOwnerName(vendedorNome);
}

function isOutboundMeeting(meeting: Meeting, outboundLeads: Lead[], outboundLeadIds: Set<string>): boolean {
  const directLeadId = normalizeLeadId(meeting.leadId);
  if (directLeadId && outboundLeadIds.has(directLeadId)) return true;
  return outboundLeads.some((lead) => isAgendaEventLinkedToLead(meeting, lead));
}

function isOutboundFinalization(record: LeadFinalizationRecord): boolean {
  return record.channel === "outbound" && record.finalizationSource === "lead_profile";
}

function countLeadDesqualificado(
  leads: Lead[],
  finalizations: LeadFinalizationRecord[],
  filters: MetricsRequestFilters,
  scopedLeadIds: Set<string>,
): number {
  const lostLeadsCount = leads.filter((lead) => {
    if (lead.channel !== "outbound" || lead.status !== "Perdido") return false;
    const leadId = normalizeLeadId(lead.id);
    if (!leadId || !scopedLeadIds.has(leadId)) return false;
    return isWithinRange(getLeadReferenceDate(lead), filters.rangeStart, filters.rangeEnd);
  }).length;

  const finalizedAsDeleted = finalizations.filter((record) => {
    if (!isOutboundFinalization(record) || record.reason !== "apagar") return false;
    const leadId = normalizeLeadId(record.leadId);
    if (!leadId || !scopedLeadIds.has(leadId)) return false;
    return isWithinRange(getFinalizationReferenceDate(record), filters.rangeStart, filters.rangeEnd);
  }).length;

  return lostLeadsCount + finalizedAsDeleted;
}

function isClosingCallForCpc(meeting: Meeting): boolean {
  if (normalizeText(meeting.reason) !== "fechamento") return false;
  const status = normalizeAgendaEventStatus(meeting);
  return status !== "apagado_logico" && status !== "remarcado";
}

function isPurchasedClosingCall(meeting: Meeting): boolean {
  if (!isClosingCallForCpc(meeting)) return false;
  const manualAction = normalizeText(meeting.manualFinalizationAction);
  if (manualAction === "purchase") return true;

  const notes = normalizeText(meeting.notes);
  if (notes.includes("compra realizada")) return true;

  return false;
}

function getMeetingSaleValueCents(meeting: Meeting): number {
  if (Number.isFinite(meeting.saleValueCents) && Number(meeting.saleValueCents) > 0) {
    return Math.round(Number(meeting.saleValueCents));
  }
  return 0;
}

async function readServerSnapshot() {
  const [leads, meetings, customers, finalizations, wrapups] = await Promise.all([
    readLeadsCollection(),
    readDataFile<Meeting[]>(MEETINGS_FILE, []),
    readCustomersCollection(),
    readDataFile<LeadFinalizationRecord[]>(LEAD_FINALIZATIONS_FILE, []),
    readDataFile<PostCallWrapup[]>(WRAPUPS_FILE, []),
  ]);

  return {
    leads: asArray<Lead>(leads),
    meetings: asArray<Meeting>(meetings),
    customers: asArray<Lead>(customers),
    finalizations: asArray<LeadFinalizationRecord>(finalizations),
    wrapups: asArray<PostCallWrapup>(wrapups),
  };
}

function buildPayload(params: {
  leads: Lead[];
  customers: Lead[];
  meetings: Meeting[];
  finalizations: LeadFinalizationRecord[];
  wrapups: PostCallWrapup[];
  referenceDate: Date;
  callLogs: CallLog[];
  filters: MetricsRequestFilters;
}): DashboardMetrics {
  const { leads, customers, meetings, finalizations, wrapups, referenceDate, callLogs, filters } = params;

  const outboundLeads = leads.filter(
    (lead) =>
      lead.channel === "outbound" &&
      matchesVendedor(lead.owner, filters.vendedorNome) &&
      isWithinRange(getLeadReferenceDate(lead), filters.rangeStart, filters.rangeEnd),
  );
  const outboundCustomers = customers.filter(
    (customer) =>
      customer.channel === "outbound" &&
      matchesVendedor(customer.owner, filters.vendedorNome) &&
      isWithinRange(getLeadReferenceDate(customer), filters.rangeStart, filters.rangeEnd),
  );
  const outboundOperationalLeads = [...outboundLeads, ...outboundCustomers];
  const outboundOperationalLeadIds = new Set(
    outboundOperationalLeads.map((lead) => normalizeLeadId(lead.id)).filter(Boolean),
  );
  const scopedLeadIds = outboundOperationalLeadIds;
  const leadPhoneIndex = buildLeadPhoneIndex(outboundOperationalLeads);
  const meetingsInScope = meetings.filter(
    (meeting) =>
      isOutboundMeeting(meeting, outboundOperationalLeads, outboundOperationalLeadIds) &&
      matchesVendedor(meeting.owner, filters.vendedorNome) &&
      isWithinRange(getMeetingReferenceDate(meeting), filters.rangeStart, filters.rangeEnd),
  );
  const wrapupsInPeriod = wrapups.filter((wrapup) =>
    isWithinRange(getWrapupReferenceDate(wrapup), filters.rangeStart, filters.rangeEnd),
  );
  const callsInPeriod = callLogs.filter((call) =>
    isWithinRange(getCallReferenceDate(call), filters.rangeStart, filters.rangeEnd),
  );
  const finalizationsInPeriod = finalizations.filter((record) =>
    isWithinRange(getFinalizationReferenceDate(record), filters.rangeStart, filters.rangeEnd),
  );
  const totalLeadsCadastrados = outboundLeads.length;

  if (totalLeadsCadastrados === 0) {
    return {
      funnels: {
        absoluto: {
          ligacoes: 0,
          atendidas: 0,
          decisor: 0,
          agendamentos: 0,
          compras: 0,
        },
        conversao: {
          atendidasPercentual: 0,
          decisorPercentual: 0,
          agendamentosPercentual: 0,
          comprasPercentual: 0,
        },
      },
      cards: {
        acionamentoBase: 0,
        faturamento: 0,
        vendasRealizadas: 0,
        leadDesqualificado: 0,
        followUpsPendentes: 0,
        conversaoLigacao: 0,
        taxaContatoDecisor: 0,
        agendamentosPorLigacoes: 0,
        taxaSemInteresse: 0,
        percentualAtendimento: 0,
        percentualCpc: 0,
        noShow: 0,
      },
    };
  }

  const callsInScope = callsInPeriod.filter((call) =>
    Boolean(resolveScopedLeadIdByCall(call, scopedLeadIds, leadPhoneIndex)),
  );
  const wrapsInScope = wrapupsInPeriod.filter((wrapup) =>
    Boolean(resolveScopedLeadIdByWrapup(wrapup, scopedLeadIds, leadPhoneIndex)),
  );
  const dedupedWrapsInScope = dedupeWrapups(wrapsInScope);

  const ligacoes = callsInScope.length;
  const atendidas = callsInScope.filter((call) => isAnsweredCallStatus(call.status)).length;
  const leadsUnicosAcionados = new Set<string>();
  for (const call of callsInScope) {
    const leadId = resolveScopedLeadIdByCall(call, scopedLeadIds, leadPhoneIndex);
    if (!leadId) continue;
    leadsUnicosAcionados.add(leadId);
  }

  const decisorFromWrapups = dedupedWrapsInScope.filter((wrapup) => classifyDecisionContactWrapup(wrapup) !== null).length;
  const semInteresseTotal = dedupedWrapsInScope.filter((wrapup) => isSemInteresseWrapup(wrapup)).length;
  const agendamentosFromMeetings = meetingsInScope.filter((meeting) => isAgendaScheduledCall(meeting)).length;

  const decisor = Math.max(decisorFromWrapups, 0);
  const agendamentos = Math.max(agendamentosFromMeetings, 0);

  const atendidasPercentual = safePercent(atendidas, ligacoes);
  const decisorPercentual = safePercent(decisor, atendidas);
  const agendamentosPercentual = safePercent(agendamentos, decisor);

  const leadDesqualificado = countLeadDesqualificado(leads, finalizationsInPeriod, filters, scopedLeadIds);

  const closingCallsForCpc = meetingsInScope.filter((meeting) => isClosingCallForCpc(meeting));
  const purchasedClosingCalls = closingCallsForCpc.filter((meeting) => isPurchasedClosingCall(meeting));
  const vendasRealizadas = purchasedClosingCalls.length;
  const compras = Math.max(vendasRealizadas, 0);
  const comprasPercentual = safePercent(compras, agendamentos);
  const faturamento =
    purchasedClosingCalls.reduce((total, meeting) => total + getMeetingSaleValueCents(meeting), 0) / 100;
  const percentualCpc = safePercent(vendasRealizadas, closingCallsForCpc.length);

  const followUpsPendentes = meetingsInScope.filter((meeting) => isFutureActiveFollowup(meeting, referenceDate)).length;
  const noShow = meetingsInScope.filter((meeting) => isNoShowMeeting(meeting)).length;

  return {
    funnels: {
      absoluto: {
        ligacoes,
        atendidas,
        decisor,
        agendamentos,
        compras,
      },
      conversao: {
        atendidasPercentual,
        decisorPercentual,
        agendamentosPercentual,
        comprasPercentual,
      },
    },
    cards: {
      acionamentoBase: safePercent(leadsUnicosAcionados.size, totalLeadsCadastrados),
      faturamento,
      vendasRealizadas,
      leadDesqualificado,
      followUpsPendentes,
      conversaoLigacao: safePercent(agendamentos, decisor),
      taxaContatoDecisor: safePercent(decisor, atendidas),
      agendamentosPorLigacoes: safePercent(agendamentos, ligacoes),
      taxaSemInteresse: safePercent(semInteresseTotal, decisor),
      percentualAtendimento: atendidasPercentual,
      percentualCpc,
      noShow,
    },
  };
}

export async function GET(request: Request) {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  try {
    const baseFilters = parseFiltersFromRequest(request);
    const vendedorNome = await resolveVendedorNome(baseFilters.vendedorId);
    const filters: MetricsRequestFilters = {
      ...baseFilters,
      vendedorNome,
    };

    const [callLogs, snapshot] = await Promise.all([getCallLogs(), readServerSnapshot()]);
    const payload = buildPayload({
      ...snapshot,
      callLogs,
      referenceDate: new Date(),
      filters,
    });

    return NextResponse.json({
      success: true,
      metrics: payload,
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Nao foi possivel carregar metricas do dashboard." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  try {
    const baseFilters = parseFiltersFromRequest(request);
    const vendedorNome = await resolveVendedorNome(baseFilters.vendedorId);
    const filters: MetricsRequestFilters = {
      ...baseFilters,
      vendedorNome,
    };

    const [callLogs, snapshot] = await Promise.all([getCallLogs(), readServerSnapshot()]);
    const payload = buildPayload({
      ...snapshot,
      callLogs,
      referenceDate: new Date(),
      filters,
    });

    return NextResponse.json({
      success: true,
      metrics: payload,
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Nao foi possivel carregar metricas do dashboard." },
      { status: 500 },
    );
  }
}
