import { NextResponse } from "next/server";
import { getCallLogs } from "@/lib/calls-store";
import { getCallAnalysisObservations, getCallAnalysisRequests } from "@/lib/call-analysis-store";
import { CallAnalysisObservationRecord, CallAnalysisRequestRecord } from "@/types/call-analysis";

function buildRequestByIdMap(requests: CallAnalysisRequestRecord[]) {
  const map = new Map<string, CallAnalysisRequestRecord>();
  for (const request of requests) {
    const requestId = String(request.requestId || "").trim();
    if (!requestId) continue;
    map.set(requestId, request);
  }
  return map;
}

function buildLatestObservationByRequestIdMap(observations: CallAnalysisObservationRecord[]) {
  const map = new Map<string, CallAnalysisObservationRecord>();
  const ordered = [...observations].sort((a, b) => {
    const first = String(a.createdAt || "");
    const second = String(b.createdAt || "");
    return second.localeCompare(first);
  });
  for (const observation of ordered) {
    const requestId = String(observation.requestId || "").trim();
    if (!requestId || map.has(requestId)) continue;
    map.set(requestId, observation);
  }
  return map;
}

function latestBy<T>(items: T[], selector: (item: T) => string) {
  if (items.length === 0) return null;
  const ordered = [...items].sort((a, b) => selector(b).localeCompare(selector(a)));
  return ordered[0] || null;
}

function matchObservationForCall(
  callId: string,
  externalCallId: string,
  sessionId: string,
  observations: CallAnalysisObservationRecord[],
  requestById: Map<string, CallAnalysisRequestRecord>,
) {
  const candidates = observations.filter((item) => {
    const itemCallId = String(item.callId || "").trim();
    const request = requestById.get(String(item.requestId || "").trim());
    const requestCallId = String(request?.callId || "").trim();
    const requestExternalCallId = String(request?.externalCallId || "").trim();
    const requestSessionId = String(request?.sessionId || "").trim();

    const callMatches =
      (itemCallId && (itemCallId === callId || (externalCallId && itemCallId === externalCallId))) ||
      (requestCallId && (requestCallId === callId || (externalCallId && requestCallId === externalCallId))) ||
      (requestExternalCallId && (requestExternalCallId === callId || (externalCallId && requestExternalCallId === externalCallId))) ||
      (sessionId && requestSessionId === sessionId);

    return callMatches;
  });
  return latestBy(candidates, (item) => String(item.createdAt || ""));
}

function matchRequestForCall(
  callId: string,
  externalCallId: string,
  sessionId: string,
  requests: CallAnalysisRequestRecord[],
) {
  const candidates = requests.filter((item) => {
    const requestCallId = String(item.callId || "").trim();
    const requestExternalCallId = String(item.externalCallId || "").trim();
    const requestSessionId = String(item.sessionId || "").trim();
    if (!requestCallId && !requestExternalCallId && !requestSessionId) return false;
    return (
      requestCallId === callId ||
      (externalCallId && requestCallId === externalCallId) ||
      requestExternalCallId === callId ||
      (externalCallId && requestExternalCallId === externalCallId) ||
      (sessionId && requestSessionId === sessionId)
    );
  });
  return latestBy(candidates, (item) => String(item.triggeredAt || ""));
}

export async function GET() {
  try {
    const [calls, analysisObservations, analysisRequests] = await Promise.all([
      getCallLogs(),
      getCallAnalysisObservations(),
      getCallAnalysisRequests(),
    ]);
    const requestById = buildRequestByIdMap(analysisRequests);
    const latestObservationByRequestId = buildLatestObservationByRequestIdMap(analysisObservations);

    const enriched = calls.map((call) => {
      const callId = String(call.id || "").trim();
      const externalCallId = String(call.externalCallId || "").trim();
      const sessionId = String(call.sessionId || "").trim();
      const latestObservation = matchObservationForCall(
        callId,
        externalCallId,
        sessionId,
        analysisObservations,
        requestById,
      );
      const latestRequest = matchRequestForCall(callId, externalCallId, sessionId, analysisRequests);
      const requestLinkedToObservation = latestObservation
        ? requestById.get(String(latestObservation.requestId || "").trim())
        : null;

      const merged = { ...call };
      const legacyProcessing = String(merged.processingStatus || "").trim().toLowerCase();
      if (!merged.analysisStatus) {
        if (legacyProcessing === "processing") merged.analysisStatus = "processing";
        else if (legacyProcessing === "done") merged.analysisStatus = "done";
        else if (legacyProcessing === "error") merged.analysisStatus = "error";
        else if (String(merged.analysisObservationId || "").trim() || String(merged.aiAnalysis || "").trim()) {
          merged.analysisStatus = "done";
        } else {
          merged.analysisStatus = "idle";
        }
      }
      merged.analysisLeadId = merged.analysisLeadId || merged.leadId || null;
      merged.analysisUpdatedAt = merged.analysisUpdatedAt || merged.updatedAt || merged.createdAt || null;
      if (!merged.analysisPreview && String(merged.aiAnalysis || "").trim()) {
        merged.analysisPreview = String(merged.aiAnalysis).slice(0, 280);
      }

      if (latestObservation) {
        merged.leadId = merged.leadId || latestObservation.leadId;
        merged.analysisObservationId = merged.analysisObservationId || latestObservation.id;
        merged.aiAnalysis = merged.aiAnalysis || latestObservation.content;
        merged.analysisPreview = merged.analysisPreview || String(latestObservation.content || "").slice(0, 280);
        merged.analysisRequestId = merged.analysisRequestId || latestObservation.requestId;
        merged.analysisLeadId = merged.analysisLeadId || latestObservation.leadId;
        merged.externalCallId =
          merged.externalCallId ||
          String(requestLinkedToObservation?.externalCallId || "").trim() ||
          merged.externalCallId;
        merged.sessionId =
          merged.sessionId ||
          String(requestLinkedToObservation?.sessionId || "").trim() ||
          merged.sessionId;
        merged.analysisStatus = "done";
        merged.analysisUpdatedAt =
          merged.analysisUpdatedAt || String(latestObservation.updatedAt || latestObservation.createdAt || "").trim() || null;
        merged.processingStatus = "done";
        merged.analysisError = null;
        return merged;
      }

      if (latestRequest) {
        merged.analysisRequestId = merged.analysisRequestId || latestRequest.requestId;
        merged.externalCallId =
          merged.externalCallId ||
          String(latestRequest.externalCallId || "").trim() ||
          merged.externalCallId;
        merged.sessionId =
          merged.sessionId ||
          String(latestRequest.sessionId || "").trim() ||
          merged.sessionId;
        if (latestRequest.status === "processing") {
          merged.analysisStatus = "processing";
          merged.processingStatus = "processing";
          merged.analysisUpdatedAt = merged.analysisUpdatedAt || latestRequest.triggeredAt || null;
        } else if (latestRequest.status === "error") {
          merged.analysisStatus = "error";
          merged.processingStatus = "error";
          merged.analysisError = merged.analysisError || latestRequest.errorMessage || null;
          merged.analysisUpdatedAt = merged.analysisUpdatedAt || latestRequest.completedAt || latestRequest.triggeredAt || null;
        } else if (latestRequest.status === "done") {
          const observationForRequest = latestObservationByRequestId.get(latestRequest.requestId);
          merged.analysisStatus = "done";
          merged.processingStatus = "done";
          merged.analysisObservationId =
            merged.analysisObservationId ||
            latestRequest.observationId ||
            observationForRequest?.id ||
            null;
          merged.analysisLeadId = merged.analysisLeadId || latestRequest.leadId || merged.leadId || null;
          merged.aiAnalysis =
            merged.aiAnalysis ||
            latestRequest.analysisText ||
            observationForRequest?.content ||
            null;
          merged.analysisPreview =
            merged.analysisPreview ||
            (merged.aiAnalysis ? String(merged.aiAnalysis).slice(0, 280) : null);
          merged.analysisUpdatedAt = merged.analysisUpdatedAt || latestRequest.completedAt || latestRequest.triggeredAt || null;
          merged.analysisError = null;
        }
      }

      return merged;
    });

    const ordered = [...enriched].sort((a, b) => {
      const first = a.startedAt || a.createdAt;
      const second = b.startedAt || b.createdAt;
      return second.localeCompare(first);
    });

    console.log("[POSTCALL_DEBUG][API_LIGACOES] GET /api/ligacoes", {
      total: ordered.length,
      latest: ordered[0]
        ? {
            id: ordered[0].id,
            leadId: ordered[0].leadId,
            status: ordered[0].status,
            eventType: ordered[0].eventType,
            startedAt: ordered[0].startedAt,
            endedAt: ordered[0].endedAt,
            durationSeconds: ordered[0].durationSeconds,
            telefone: ordered[0].telefone,
            analysisStatus: ordered[0].analysisStatus || null,
            processingStatus: ordered[0].processingStatus || null,
            analysisRequestId: ordered[0].analysisRequestId || null,
            analysisObservationId: ordered[0].analysisObservationId || null,
          }
        : null,
    });

    return NextResponse.json({
      success: true,
      calls: ordered,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: "Nao foi possivel carregar ligacoes.",
        detail: error instanceof Error ? error.message : "Erro desconhecido",
      },
      { status: 500 },
    );
  }
}
