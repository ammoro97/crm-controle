import { NextResponse } from "next/server";
import {
  getCallAnalysisObservationByRequestId,
  getCallAnalysisRequestById,
  saveCallAnalysisObservation,
  updateCallAnalysisRequest,
} from "@/lib/call-analysis-store";
import { getCallLogs, upsertCallLog } from "@/lib/calls-store";
import { getWebhookOutConfig } from "@/lib/webhook-out-config-store";
import { CALL_ANALYSIS_SECRET_HEADER } from "@/types/call-analysis";

type AnalysisCallbackBody = {
  event?: string;
  status?: string;
  error?: string;
  requestId?: string;
  request_id?: string;
  analysisRequestId?: string;
  callId?: string;
  leadId?: string;
  phone?: string;
  externalCallId?: string;
  sessionId?: string;
  analysisText?: string;
  analysis?: {
    text?: string;
    summary?: string;
    result?: string;
    output?: string;
    [key: string]: unknown;
  };
  call?: {
    id?: string;
    callId?: string;
    leadId?: string;
    phone?: string;
    externalCallId?: string;
    sessionId?: string;
  };
};

function normalizeDigits(value?: string | null) {
  return String(value || "").replace(/\D/g, "");
}

function extractRequestId(body: AnalysisCallbackBody) {
  return String(body.requestId || body.request_id || body.analysisRequestId || "").trim();
}

function extractCallId(body: AnalysisCallbackBody) {
  return String(body.call?.callId || body.call?.id || body.callId || "").trim();
}

function extractLeadId(body: AnalysisCallbackBody) {
  return String(body.call?.leadId || body.leadId || "").trim();
}

function extractPhoneDigits(body: AnalysisCallbackBody) {
  return normalizeDigits(body.call?.phone || body.phone || "");
}

function extractExternalCallId(body: AnalysisCallbackBody) {
  return String(body.call?.externalCallId || body.externalCallId || "").trim();
}

function extractSessionId(body: AnalysisCallbackBody) {
  return String(body.call?.sessionId || body.sessionId || "").trim();
}

function extractAnalysisText(body: AnalysisCallbackBody) {
  const candidates = [
    body.analysisText,
    body.analysis?.text,
    body.analysis?.summary,
    body.analysis?.result,
    body.analysis?.output,
  ];
  for (const candidate of candidates) {
    const text = String(candidate || "").trim();
    if (text) return text;
  }
  if (body.analysis && Object.keys(body.analysis).length > 0) {
    return JSON.stringify(body.analysis);
  }
  return "";
}

function nowDateTime() {
  const now = new Date();
  return {
    iso: now.toISOString(),
    date: now.toISOString().slice(0, 10),
    time: now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
  };
}

export async function POST(request: Request) {
  try {
    const config = await getWebhookOutConfig();
    const expectedSecret = String(config.secret || "").trim();
    const receivedSecret = String(request.headers.get(CALL_ANALYSIS_SECRET_HEADER) || "").trim();
    if (expectedSecret && receivedSecret !== expectedSecret) {
      return NextResponse.json(
        {
          success: false,
          message: "Assinatura invalida no retorno da analise.",
          code: "CALL_ANALYSIS_INVALID_SECRET",
        },
        { status: 401 },
      );
    }

    const body = (await request.json()) as AnalysisCallbackBody;
    const requestId = extractRequestId(body);
    const callbackCallId = extractCallId(body);
    const callbackLeadId = extractLeadId(body);
    const callbackPhoneDigits = extractPhoneDigits(body);
    const callbackExternalCallId = extractExternalCallId(body);
    const callbackSessionId = extractSessionId(body);
    const callbackStatus = String(body.status || "").trim().toLowerCase();
    const isErrorStatus = callbackStatus === "error" || callbackStatus === "failed";
    const callbackError = String(body.error || "").trim();
    const analysisText = extractAnalysisText(body);
    console.log("[ANALISE_IA] CALLBACK_RECEIVED", {
      requestId: requestId || null,
      callId: callbackCallId || null,
      leadId: callbackLeadId || null,
      phoneDigits: callbackPhoneDigits || null,
      status: callbackStatus || "done",
    });

    if (!requestId || !callbackCallId || !callbackLeadId || !callbackPhoneDigits) {
      return NextResponse.json(
        {
          success: false,
          message: "Retorno de analise sem dados obrigatorios de correlacao (requestId/callId/leadId/phone).",
          code: "CALL_ANALYSIS_MISSING_CORRELATION_FIELDS",
        },
        { status: 400 },
      );
    }

    const requestRecord = await getCallAnalysisRequestById(requestId);
    if (!requestRecord) {
      return NextResponse.json(
        {
          success: false,
          message: "Solicitacao de analise nao encontrada para o requestId informado.",
          code: "CALL_ANALYSIS_REQUEST_NOT_FOUND",
        },
        { status: 404 },
      );
    }

    if (requestRecord.status === "done") {
      const existingObservation = await getCallAnalysisObservationByRequestId(requestId);
      return NextResponse.json({
        success: true,
        message: "Retorno de analise ja processado anteriormente.",
        requestId,
        leadId: requestRecord.leadId,
        callId: requestRecord.callId,
        observationId: existingObservation?.id || requestRecord.observationId || null,
        alreadyProcessed: true,
      });
    }

    const mismatches: string[] = [];
    if (requestRecord.callId !== callbackCallId) mismatches.push("callId");
    if (requestRecord.leadId !== callbackLeadId) mismatches.push("leadId");
    if (requestRecord.phoneDigits !== callbackPhoneDigits) mismatches.push("phone");
    if (
      requestRecord.externalCallId &&
      callbackExternalCallId &&
      requestRecord.externalCallId !== callbackExternalCallId
    ) {
      mismatches.push("externalCallId");
    }
    if (requestRecord.sessionId && callbackSessionId && requestRecord.sessionId !== callbackSessionId) {
      mismatches.push("sessionId");
    }

    const callLogs = await getCallLogs();
    const callLog = callLogs.find((entry) => entry.id === requestRecord.callId) || null;
    if (!callLog) {
      mismatches.push("callLogNotFound");
    } else {
      const callLogLeadId = String(callLog.leadId || "").trim();
      const callLogPhoneDigits = normalizeDigits(callLog.telefone || callLog.called || callLog.caller || "");
      if (callLogLeadId && callLogLeadId !== requestRecord.leadId) mismatches.push("callLogLeadMismatch");
      if (callLogPhoneDigits && callLogPhoneDigits !== requestRecord.phoneDigits) mismatches.push("callLogPhoneMismatch");
    }

    if (mismatches.length > 0) {
      await updateCallAnalysisRequest(requestId, {
        status: "error",
        errorMessage: `Falha de correlacao: ${mismatches.join(", ")}`,
        completedAt: new Date().toISOString(),
      });
      await upsertCallLog({
        id: requestRecord.callId,
        processingStatus: "error",
        analysisRequestId: requestId,
        analysisError: `Falha de correlacao: ${mismatches.join(", ")}`,
      });
      return NextResponse.json(
        {
          success: false,
          message: "Correlacao invalida entre ligacao e retorno da analise.",
          code: "CALL_ANALYSIS_CORRELATION_MISMATCH",
          mismatches,
        },
        { status: 409 },
      );
    }

    if (isErrorStatus) {
      const errorMessage = callbackError || "Processamento externo retornou erro.";
      await updateCallAnalysisRequest(requestId, {
        status: "error",
        errorMessage,
        completedAt: new Date().toISOString(),
      });
      await upsertCallLog({
        id: requestRecord.callId,
        processingStatus: "error",
        analysisRequestId: requestId,
        analysisError: errorMessage,
      });
      return NextResponse.json({
        success: true,
        message: "Erro de processamento registrado com sucesso.",
        requestId,
      });
    }

    if (!analysisText.trim()) {
      return NextResponse.json(
        {
          success: false,
          message: "Retorno sem texto de analise.",
          code: "CALL_ANALYSIS_EMPTY_CONTENT",
        },
        { status: 400 },
      );
    }

    const stamp = nowDateTime();
    const observation = await saveCallAnalysisObservation({
      id: `OBS-IA-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      requestId,
      callId: requestRecord.callId,
      leadId: requestRecord.leadId,
      owner: "Analise da IA",
      type: "analise ia",
      content: analysisText,
      date: stamp.date,
      time: stamp.time,
      createdAt: stamp.iso,
      updatedAt: stamp.iso,
    });

    await updateCallAnalysisRequest(requestId, {
      status: "done",
      observationId: observation.id,
      analysisText,
      errorMessage: null,
      completedAt: stamp.iso,
    });

    await upsertCallLog({
      id: requestRecord.callId,
      processingStatus: "done",
      aiAnalysis: analysisText,
      analysisRequestId: requestId,
      analysisObservationId: observation.id,
      analysisError: null,
    });
    console.log("[ANALISE_IA] CALLBACK_SAVED", {
      requestId,
      callId: requestRecord.callId,
      leadId: requestRecord.leadId,
      observationId: observation.id,
    });

    return NextResponse.json({
      success: true,
      message: "Analise recebida e vinculada ao lead com sucesso.",
      requestId,
      callId: requestRecord.callId,
      leadId: requestRecord.leadId,
      observationId: observation.id,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: "Nao foi possivel processar retorno da analise.",
        detail: error instanceof Error ? error.message : "Erro desconhecido",
      },
      { status: 500 },
    );
  }
}
