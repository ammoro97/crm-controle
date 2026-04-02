import { NextResponse } from "next/server";
import { initialLeads, initialMeetings } from "@/lib/mock-data";
import { getCallLogs } from "@/lib/calls-store";
import { buildOutboundDashboardMetrics } from "@/lib/leads-outbound-dashboard";
import { normalizeText } from "@/lib/agenda-events";
import { requireAuth } from "@/lib/require-auth";
import type { DashboardMetrics } from "@/types/dashboard";
import type { Meeting } from "@/types/crm";

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

export async function GET() {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  try {
    const callLogs = await getCallLogs();
    const metrics = buildOutboundDashboardMetrics({
      leads: initialLeads,
      meetings: initialMeetings,
      callLogs,
      wrapups: [],
      finalizations: [],
      referenceDate: new Date(),
    });

    const percentualAtendimento =
      metrics.totalLigacoesFeitas > 0 ? (metrics.totalLigacoesAtendidas / metrics.totalLigacoesFeitas) * 100 : 0;
    const percentualCpc =
      metrics.totalCallsAgendadas > 0 ? (metrics.totalComprasEfetuadas / metrics.totalCallsAgendadas) * 100 : 0;
    const noShow = initialMeetings.filter((meeting) => isNoShowMeeting(meeting)).length;

    const payload: DashboardMetrics = {
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
        leadDesqualificado: initialLeads.filter((lead) => lead.channel === "outbound" && lead.status === "Perdido").length,
        followUpsPendentes: metrics.totalFollowupsPendentes,
        conversaoLigacao: metrics.taxaConversao,
        percentualAtendimento,
        percentualCpc,
        noShow,
      },
    };

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

