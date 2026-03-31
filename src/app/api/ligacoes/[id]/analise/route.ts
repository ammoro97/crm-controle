import { NextResponse } from "next/server";
import { getCallAnalysisObservations } from "@/lib/call-analysis-store";
import { getCallLogs } from "@/lib/calls-store";

type ResolvedCallAnalysis = {
  leadId: string;
  observationId: string;
  callId: string;
};

function normalizeLookup(value?: string | null) {
  return String(value || "").trim();
}

function normalizeDigits(value?: string | null) {
  return String(value || "").replace(/\D/g, "");
}

function getMinuteKey(value?: string | null) {
  const raw = normalizeLookup(value);
  if (!raw) return "";
  return raw.slice(0, 16);
}

function toIsoDate(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString();
}

function sortByNewest<T>(items: T[], getDate: (item: T) => string) {
  return [...items].sort((a, b) => getDate(b).localeCompare(getDate(a)));
}

function buildCallCandidates(input: {
  routeCallId: string;
  externalCallId?: string | null;
  sessionId?: string | null;
}) {
  return Array.from(
    new Set(
      [input.routeCallId, input.externalCallId, input.sessionId]
        .map((value) => normalizeLookup(value))
        .filter(Boolean),
    ),
  );
}

function resolveCallByCandidates(
  calls: Awaited<ReturnType<typeof getCallLogs>>,
  candidates: string[],
) {
  const matches = calls.filter((call) => {
    const callId = normalizeLookup(call.id);
    const externalCallId = normalizeLookup(call.externalCallId);
    const sessionId = normalizeLookup(call.sessionId);
    return (
      candidates.includes(callId) ||
      (externalCallId && candidates.includes(externalCallId)) ||
      (sessionId && candidates.includes(sessionId))
    );
  });

  if (matches.length <= 1) return matches[0] || null;

  const ordered = sortByNewest(matches, (call) =>
    toIsoDate(call.analysisUpdatedAt || call.updatedAt || call.endedAt || call.startedAt || call.createdAt),
  );
  return ordered[0] || null;
}

function resolveCallByPhoneMinute(params: {
  calls: Awaited<ReturnType<typeof getCallLogs>>;
  phoneDigits: string;
  startedAtMinute: string;
  fallbackLeadId?: string | null;
}) {
  const leadLookup = normalizeLookup(params.fallbackLeadId);
  const matches = params.calls.filter((call) => {
    const callPhone = normalizeDigits(call.telefone || call.called || call.caller || "");
    const callMinute = getMinuteKey(call.startedAt || call.createdAt || "");
    if (!callPhone || !callMinute) return false;
    if (callPhone !== params.phoneDigits || callMinute !== params.startedAtMinute) return false;

    if (!leadLookup) return true;
    const callLeadId = normalizeLookup(call.analysisLeadId || call.leadId || "");
    return Boolean(callLeadId) && callLeadId === leadLookup;
  });

  if (matches.length <= 1) return matches[0] || null;
  return sortByNewest(matches, (call) =>
    toIsoDate(call.analysisUpdatedAt || call.updatedAt || call.endedAt || call.startedAt || call.createdAt),
  )[0];
}

function resolveObservationForCall(params: {
  leadId: string;
  callCandidates: string[];
  analysisObservationId?: string | null;
  analysisRequestId?: string | null;
  observations: Awaited<ReturnType<typeof getCallAnalysisObservations>>;
}) {
  const leadScoped = params.observations.filter((item) => item.leadId === params.leadId);
  const byCall = leadScoped.filter((item) => params.callCandidates.includes(normalizeLookup(item.callId)));
  if (byCall.length > 0) {
    return sortByNewest(byCall, (item) => toIsoDate(item.updatedAt || item.createdAt))[0];
  }

  const preferredObservationId = normalizeLookup(params.analysisObservationId);
  if (preferredObservationId) {
    const byId = leadScoped.find((item) => normalizeLookup(item.id) === preferredObservationId);
    if (byId) return byId;
  }

  const preferredRequestId = normalizeLookup(params.analysisRequestId);
  if (preferredRequestId) {
    const byRequest = leadScoped.find((item) => normalizeLookup(item.requestId) === preferredRequestId);
    if (byRequest) return byRequest;
  }

  return null;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const params = await context.params;
    const routeCallId = normalizeLookup(params.id);
    if (!routeCallId) {
      return NextResponse.json(
        { success: false, message: "ID da ligacao e obrigatorio." },
        { status: 400 },
      );
    }

    const { searchParams } = new URL(request.url);
    const externalCallId = normalizeLookup(searchParams.get("externalCallId"));
    const sessionId = normalizeLookup(searchParams.get("sessionId"));
    const fallbackLeadId = normalizeLookup(searchParams.get("leadId"));
    const phoneDigits = normalizeDigits(searchParams.get("phone"));
    const startedAtMinute = getMinuteKey(searchParams.get("startedAt"));

    const calls = await getCallLogs();
    const callCandidates = buildCallCandidates({
      routeCallId,
      externalCallId,
      sessionId,
    });
    const resolvedCall =
      resolveCallByCandidates(calls, callCandidates) ||
      (phoneDigits && startedAtMinute
        ? resolveCallByPhoneMinute({
            calls,
            phoneDigits,
            startedAtMinute,
            fallbackLeadId,
          })
        : null);

    if (!resolvedCall) {
      return NextResponse.json(
        {
          success: false,
          available: false,
          message: "Ligacao nao encontrada para resolver analise.",
          code: "CALL_ANALYSIS_CALL_NOT_FOUND",
        },
        { status: 404 },
      );
    }

    const resolvedLeadId =
      normalizeLookup(resolvedCall.analysisLeadId) ||
      normalizeLookup(resolvedCall.leadId) ||
      fallbackLeadId;

    if (!resolvedLeadId) {
      return NextResponse.json({
        success: true,
        available: false,
        message: "Analise ainda nao disponivel para esta ligacao.",
        code: "CALL_ANALYSIS_LEAD_NOT_RESOLVED",
      });
    }

    const observationCandidates = buildCallCandidates({
      routeCallId: resolvedCall.id,
      externalCallId: resolvedCall.externalCallId,
      sessionId: resolvedCall.sessionId,
    });
    const observations = await getCallAnalysisObservations();
    const resolvedObservation = resolveObservationForCall({
      leadId: resolvedLeadId,
      callCandidates: observationCandidates,
      analysisObservationId: resolvedCall.analysisObservationId,
      analysisRequestId: resolvedCall.analysisRequestId,
      observations,
    });

    const observationId =
      normalizeLookup(resolvedObservation?.id) ||
      normalizeLookup(resolvedCall.analysisObservationId);

    if (!observationId) {
      return NextResponse.json({
        success: true,
        available: false,
        message: "Analise ainda nao disponivel para esta ligacao.",
        code: "CALL_ANALYSIS_OBSERVATION_NOT_FOUND",
      });
    }

    const payload: ResolvedCallAnalysis = {
      leadId: resolvedLeadId,
      observationId,
      callId: resolvedCall.id,
    };

    return NextResponse.json({
      success: true,
      available: true,
      analysis: payload,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        available: false,
        message: "Nao foi possivel resolver analise da ligacao.",
        detail: error instanceof Error ? error.message : "Erro desconhecido",
      },
      { status: 500 },
    );
  }
}
