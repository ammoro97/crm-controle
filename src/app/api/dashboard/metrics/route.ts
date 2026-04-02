import { NextRequest, NextResponse } from "next/server";
import { getCallLogs } from "@/lib/calls-store";
import { isAgendaEventLinkedToLead, normalizeAgendaEventStatus, normalizeText } from "@/lib/agenda-events";
import { readLeadsCollection } from "@/lib/leads-customers-store";
import { readDataFile } from "@/lib/storage-paths";
import { requireAuth } from "@/lib/require-auth";
import type { DashboardMetrics } from "@/types/dashboard";
import type { CallLog, Lead, LeadFinalizationRecord, Meeting } from "@/types/crm";
import type { PostCallWrapup } from "@/lib/post-call-flow";

type DashboardMetricsInput = {
  leads?: Lead[];
  meetings?: Meeting[];
  finalizations?: LeadFinalizationRecord[];
  wrapups?: PostCallWrapup[];
};

const MEETINGS_FILE = "crm.agenda.meetings.v1.json";
const LEAD_FINALIZATIONS_FILE = "crm.leads.finalizations.v1.json";
const WRAPUPS_FILE = "crm.calls.wrapups.v1.json";

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeLeadId(value?: string | null): string {
  return String(value || "").trim();
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

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]) - 1;
  const day = Number(dateMatch[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

  const parsed = new Date(year, month, day, parsedTime.hour, parsedTime.minute, 0, 0);
  if (Number.isNaN(parsed.getTime())) return null;
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month ||
    parsed.getDate() !== day ||
    parsed.getHours() !== parsedTime.hour ||
    parsed.getMinutes() !== parsedTime.minute
  ) {
    return null;
  }

  return parsed;
}

function isAnsweredCallStatus(status?: string | null): boolean {
  const normalized = normalizeText(status);
  return normalized === "atendida" || normalized === "answered" || normalized === "conectada";
}

function shouldUseOutboundScope(leads: Lead[]): boolean {
  return leads.some((lead) => lead.channel === "outbound");
}

function isInOutboundScopeByLeadId(
  leadId: string | null | undefined,
  outboundLeadIds: Set<string>,
  useOutboundScope: boolean,
): boolean {
  if (!useOutboundScope) return true;
  const normalizedLeadId = normalizeLeadId(leadId);
  if (!normalizedLeadId) return true;
  return outboundLeadIds.has(normalizedLeadId);
}

function isNoShowMeeting(meeting: Meeting): boolean {
  const normalizedStatus = normalizeText(meeting.status);
  const normalizedType = normalizeText(meeting.eventType);
  const normalizedReason = normalizeText(meeting.reason);
  const normalizedNotes = normalizeText(meeting.notes);

  if (normalizedStatus === "cancelado" && normalizedNotes.includes("no show")) return true;
  if (normalizedStatus === "concluido" && normalizedNotes.includes("nao compareceu")) return true;
  if (normalizedType === "call_agendada" && normalizedReason === "fechamento" && normalizedNotes.includes("no show")) return true;
  return false;
}

function isCallSchedulingMeeting(meeting: Meeting): boolean {
  const normalizedType = normalizeText(meeting.eventType);
  const normalizedReason = normalizeText(meeting.reason);

  if (normalizedType === "call_agendada" || normalizedType === "call_conversao" || normalizedType === "follow_up_ligacao") {
    return true;
  }
  if (normalizedType === "follow_up_whatsapp" || normalizedType === "follow_up_email") {
    return false;
  }

  return (
    normalizedReason === "apresentacao" ||
    normalizedReason === "acompanhamento" ||
    normalizedReason === "fechamento" ||
    normalizedReason === "follow-up" ||
    normalizedReason === "follow up"
  );
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

function isDecisionMakerWrapup(wrapup: PostCallWrapup): boolean {
  return normalizeText(wrapup.rightPerson) === "sim";
}

function isCallSchedulingWrapup(wrapup: PostCallWrapup): boolean {
  const normalized = normalizeText(wrapup.nextAction);
  if (!normalized) return false;
  if (normalized.includes("whatsapp") || normalized.includes("email") || normalized.includes("e-mail")) return false;

  return (
    normalized.includes("agendar") ||
    normalized.includes("ligacao") ||
    normalized.includes("ligar") ||
    normalized.includes("call") ||
    normalized.includes("video") ||
    normalized.includes("reuniao") ||
    normalized.includes("retorno")
  );
}

function isOutboundMeeting(meeting: Meeting, outboundLeads: Lead[], outboundLeadIds: Set<string>): boolean {
  const directLeadId = normalizeLeadId(meeting.leadId);
  if (directLeadId && outboundLeadIds.has(directLeadId)) return true;
  return outboundLeads.some((lead) => isAgendaEventLinkedToLead(meeting, lead));
}

function isOutboundFinalization(record: LeadFinalizationRecord): boolean {
  return record.channel === "outbound" && record.finalizationSource === "lead_profile";
}

function countLeadDesqualificado(leads: Lead[], finalizations: LeadFinalizationRecord[]): number {
  const lostLeadsCount = leads.filter((lead) => lead.channel === "outbound" && lead.status === "Perdido").length;
  const finalizedAsDeleted = finalizations.filter((record) => isOutboundFinalization(record) && record.reason === "apagar").length;
  return lostLeadsCount + finalizedAsDeleted;
}

function countVendasRealizadas(finalizations: LeadFinalizationRecord[]): number {
  return finalizations.filter((record) => isOutboundFinalization(record) && record.reason === "compra_efetuada").length;
}

function sumFaturamento(finalizations: LeadFinalizationRecord[]): number {
  return finalizations
    .filter(
      (record) =>
        isOutboundFinalization(record) &&
        record.reason === "compra_efetuada" &&
        Number.isFinite(record.saleValueCents) &&
        Number(record.saleValueCents) > 0,
    )
    .reduce((total, record) => total + Number(record.saleValueCents), 0);
}

async function readServerSnapshot() {
  const [leads, meetings, finalizations, wrapups] = await Promise.all([
    readLeadsCollection(),
    readDataFile<Meeting[]>(MEETINGS_FILE, []),
    readDataFile<LeadFinalizationRecord[]>(LEAD_FINALIZATIONS_FILE, []),
    readDataFile<PostCallWrapup[]>(WRAPUPS_FILE, []),
  ]);

  return {
    leads: asArray<Lead>(leads),
    meetings: asArray<Meeting>(meetings),
    finalizations: asArray<LeadFinalizationRecord>(finalizations),
    wrapups: asArray<PostCallWrapup>(wrapups),
  };
}

function buildPayload(params: {
  leads: Lead[];
  meetings: Meeting[];
  finalizations: LeadFinalizationRecord[];
  wrapups: PostCallWrapup[];
  referenceDate: Date;
  callLogs: CallLog[];
}): DashboardMetrics {
  const { leads, meetings, finalizations, wrapups, referenceDate, callLogs } = params;

  const outboundLeads = leads.filter((lead) => lead.channel === "outbound");
  const outboundLeadIds = new Set(outboundLeads.map((lead) => normalizeLeadId(lead.id)).filter(Boolean));
  const useOutboundScope = shouldUseOutboundScope(leads);

  const callsInScope = callLogs.filter((call) => isInOutboundScopeByLeadId(call.leadId, outboundLeadIds, useOutboundScope));
  const wrapsInScope = wrapups.filter((wrapup) =>
    isInOutboundScopeByLeadId(wrapup.leadId, outboundLeadIds, useOutboundScope),
  );
  const meetingsInScope = useOutboundScope
    ? meetings.filter((meeting) => isOutboundMeeting(meeting, outboundLeads, outboundLeadIds))
    : meetings;

  const ligacoes = callsInScope.length;
  const atendidas = callsInScope.filter((call) => isAnsweredCallStatus(call.status)).length;

  const decisorFromWrapups = wrapsInScope.filter((wrapup) => isDecisionMakerWrapup(wrapup)).length;
  const agendamentosFromWrapups = wrapsInScope.filter((wrapup) => isCallSchedulingWrapup(wrapup)).length;
  const agendamentosFromMeetings = meetingsInScope.filter((meeting) => isCallSchedulingMeeting(meeting)).length;

  const decisor = Math.max(decisorFromWrapups, 0);
  const agendamentos = Math.max(agendamentosFromWrapups, agendamentosFromMeetings, 0);

  const atendidasPercentual = safePercent(atendidas, ligacoes);
  const decisorPercentual = safePercent(decisor, atendidas);
  const agendamentosPercentual = safePercent(agendamentos, decisor);

  const totalLeadsCadastrados = useOutboundScope ? outboundLeads.length : leads.length;
  const vendasRealizadas = countVendasRealizadas(finalizations);
  const faturamento = sumFaturamento(finalizations) / 100;
  const leadDesqualificado = countLeadDesqualificado(leads, finalizations);

  const followUpsPendentes = meetingsInScope.filter((meeting) => isFutureActiveFollowup(meeting, referenceDate)).length;
  const noShow = meetingsInScope.filter((meeting) => isNoShowMeeting(meeting)).length;

  return {
    funnels: {
      absoluto: {
        ligacoes,
        atendidas,
        decisor,
        agendamentos,
      },
      conversao: {
        atendidasPercentual,
        decisorPercentual,
        agendamentosPercentual,
      },
    },
    cards: {
      acionamentoBase: safePercent(ligacoes, totalLeadsCadastrados),
      faturamento,
      vendasRealizadas,
      leadDesqualificado,
      followUpsPendentes,
      conversaoLigacao: safePercent(agendamentos, decisor),
      percentualAtendimento: atendidasPercentual,
      percentualCpc: safePercent(vendasRealizadas, atendidas),
      noShow,
    },
  };
}

async function resolveInputFromRequest(request?: NextRequest) {
  const fallback = await readServerSnapshot();
  if (!request) return fallback;

  try {
    const body = (await request.json()) as DashboardMetricsInput;

    const leads = asArray<Lead>(body?.leads);
    const meetings = asArray<Meeting>(body?.meetings);
    const finalizations = asArray<LeadFinalizationRecord>(body?.finalizations);
    const wrapups = asArray<PostCallWrapup>(body?.wrapups);

    return {
      leads: leads.length > 0 ? leads : fallback.leads,
      meetings: meetings.length > 0 ? meetings : fallback.meetings,
      finalizations: finalizations.length > 0 ? finalizations : fallback.finalizations,
      wrapups: wrapups.length > 0 ? wrapups : fallback.wrapups,
    };
  } catch {
    return fallback;
  }
}

export async function GET() {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  try {
    const [callLogs, snapshot] = await Promise.all([getCallLogs(), readServerSnapshot()]);
    const payload = buildPayload({
      ...snapshot,
      callLogs,
      referenceDate: new Date(),
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

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  try {
    const [callLogs, snapshot] = await Promise.all([getCallLogs(), resolveInputFromRequest(request)]);
    const payload = buildPayload({
      ...snapshot,
      callLogs,
      referenceDate: new Date(),
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
