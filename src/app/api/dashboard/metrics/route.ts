import { NextRequest, NextResponse } from "next/server";
import { getCallLogs } from "@/lib/calls-store";
import { buildOutboundDashboardMetrics } from "@/lib/leads-outbound-dashboard";
import { isAgendaEventLinkedToLead, normalizeText } from "@/lib/agenda-events";
import { readDataFile } from "@/lib/storage-paths";
import { requireAuth } from "@/lib/require-auth";
import type { DashboardMetrics } from "@/types/dashboard";
import type { Lead, LeadFinalizationRecord, Meeting } from "@/types/crm";
import type { PostCallWrapup } from "@/lib/post-call-flow";

type DashboardMetricsInput = {
  leads?: Lead[];
  meetings?: Meeting[];
  finalizations?: LeadFinalizationRecord[];
  wrapups?: PostCallWrapup[];
};

const LEADS_FILE = "crm.leads.v1.json";
const MEETINGS_FILE = "crm.agenda.meetings.v1.json";
const LEAD_FINALIZATIONS_FILE = "crm.leads.finalizations.v1.json";
const WRAPUPS_FILE = "crm.calls.wrapups.v1.json";

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
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

function isOutboundMeeting(meeting: Meeting, outboundLeads: Lead[], outboundLeadIds: Set<string>): boolean {
  const directLeadId = String(meeting.leadId || "").trim();
  if (directLeadId && outboundLeadIds.has(directLeadId)) return true;
  return outboundLeads.some((lead) => isAgendaEventLinkedToLead(meeting, lead));
}

async function readServerSnapshot() {
  const [leads, meetings, finalizations, wrapups] = await Promise.all([
    readDataFile<Lead[]>(LEADS_FILE, []),
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
  callLogs: Awaited<ReturnType<typeof getCallLogs>>;
}): DashboardMetrics {
  const { leads, meetings, finalizations, wrapups, referenceDate, callLogs } = params;

  const metrics = buildOutboundDashboardMetrics({
    leads,
    meetings,
    callLogs,
    wrapups,
    finalizations,
    referenceDate,
  });

  const outboundLeads = leads.filter((lead) => lead.channel === "outbound");
  const outboundLeadIds = new Set(outboundLeads.map((lead) => lead.id));

  const percentualAtendimento =
    metrics.totalLigacoesFeitas > 0 ? (metrics.totalLigacoesAtendidas / metrics.totalLigacoesFeitas) * 100 : 0;
  const percentualCpc =
    metrics.totalCallsAgendadas > 0 ? (metrics.totalComprasEfetuadas / metrics.totalCallsAgendadas) * 100 : 0;

  const leadDesqualificado = leads.filter((lead) => lead.channel === "outbound" && lead.status === "Perdido").length;
  const noShow = meetings.filter((meeting) => isNoShowMeeting(meeting) && isOutboundMeeting(meeting, outboundLeads, outboundLeadIds)).length;

  return {
    funnel: {
      ligacoes: metrics.totalLigacoesFeitas,
      atendidas: metrics.totalLigacoesAtendidas,
      decisor: metrics.totalContatosDecisor,
      agendamentos: metrics.totalCallsAgendadas,
    },
    cards: {
      acionamentoBase: metrics.coberturaBasePercent,
      faturamento: metrics.valorTotalFeitoCents / 100,
      vendasRealizadas: metrics.totalComprasEfetuadas,
      leadDesqualificado,
      followUpsPendentes: metrics.totalFollowupsPendentes,
      conversaoLigacao: metrics.taxaConversao,
      percentualAtendimento,
      percentualCpc,
      noShow,
    },
  };
}

async function resolveInputFromRequest(request?: NextRequest) {
  const fallback = await readServerSnapshot();
  if (!request) return fallback;

  try {
    const body = (await request.json()) as DashboardMetricsInput;
    return {
      leads: asArray<Lead>(body?.leads),
      meetings: asArray<Meeting>(body?.meetings),
      finalizations: asArray<LeadFinalizationRecord>(body?.finalizations),
      wrapups: asArray<PostCallWrapup>(body?.wrapups),
    };
  } catch {
    return fallback;
  }
}

export async function GET() {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  try {
    const callLogs = await getCallLogs();
    const snapshot = await readServerSnapshot();
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
    const callLogs = await getCallLogs();
    const snapshot = await resolveInputFromRequest(request);
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
