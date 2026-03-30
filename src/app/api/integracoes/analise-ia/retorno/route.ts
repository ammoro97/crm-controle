import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import {
  getCallAnalysisObservationByRequestId,
  getCallAnalysisRequests,
  getCallAnalysisRequestById,
  saveCallAnalysisRequest,
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
  callid?: string;
  leadId?: string;
  phone?: string;
  telefone?: string;
  externalCallId?: string;
  sessionId?: string;
  analysisText?: string;
  analise?: string;
  analysis?: string | {
    text?: string;
    summary?: string;
    result?: string;
    output?: string;
    [key: string]: unknown;
  };
  call?: {
    id?: string;
    callId?: string;
    callid?: string;
    leadId?: string;
    phone?: string;
    telefone?: string;
    externalCallId?: string;
    sessionId?: string;
  };
};

type CallbackCorrelationContext = {
  requestId: string;
  callId: string;
  leadId: string;
  phoneDigits: string;
  externalCallId?: string | null;
  sessionId?: string | null;
  triggeredAt?: string;
};

type CallLogLookupContext = {
  requestCallId: string;
  requestExternalCallId?: string | null;
  requestSessionId?: string | null;
  requestLeadId: string;
  requestPhoneDigits: string;
  callbackCallId: string;
  callbackExternalCallId?: string | null;
  callbackSessionId?: string | null;
};

function normalizeDigits(value?: string | null) {
  return String(value || "").replace(/\D/g, "");
}

function extractRequestId(body: AnalysisCallbackBody) {
  return String(body.requestId || body.request_id || body.analysisRequestId || "").trim();
}

function extractCallId(body: AnalysisCallbackBody) {
  return String(body.call?.callId || body.call?.callid || body.call?.id || body.callId || body.callid || "").trim();
}

function extractLeadId(body: AnalysisCallbackBody) {
  return String(body.call?.leadId || body.leadId || "").trim();
}

function extractPhoneDigits(body: AnalysisCallbackBody) {
  return normalizeDigits(body.call?.phone || body.call?.telefone || body.phone || body.telefone || "");
}

function extractExternalCallId(body: AnalysisCallbackBody) {
  return String(body.call?.externalCallId || body.externalCallId || "").trim();
}

function extractSessionId(body: AnalysisCallbackBody) {
  return String(body.call?.sessionId || body.sessionId || "").trim();
}

function buildCallbackSigningSecret(configSecret?: string | null) {
  const fromConfig = String(configSecret || "").trim();
  if (fromConfig) return fromConfig;
  return String(process.env.CALL_ANALYSIS_CALLBACK_SECRET || "").trim();
}

function signCallbackContext(encodedContext: string, secret: string) {
  return createHmac("sha256", secret).update(encodedContext).digest("hex");
}

function safeEqualHexSignature(left: string, right: string) {
  const a = Buffer.from(String(left || "").trim().toLowerCase(), "utf8");
  const b = Buffer.from(String(right || "").trim().toLowerCase(), "utf8");
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function parseCorrelationContextFromRequest(request: Request, signingSecret: string): CallbackCorrelationContext | null {
  const url = new URL(request.url);
  const encoded = String(url.searchParams.get("ctx") || "").trim();
  if (!encoded) return null;

  const receivedSignature = String(url.searchParams.get("sig") || "").trim();
  if (signingSecret) {
    if (!receivedSignature) {
      throw new Error("CALL_ANALYSIS_CALLBACK_SIGNATURE_REQUIRED");
    }
    const expected = signCallbackContext(encoded, signingSecret);
    if (!safeEqualHexSignature(expected, receivedSignature)) {
      throw new Error("CALL_ANALYSIS_CALLBACK_SIGNATURE_MISMATCH");
    }
  }

  let parsed: unknown;
  try {
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    parsed = JSON.parse(decoded);
  } catch {
    throw new Error("CALL_ANALYSIS_CALLBACK_CONTEXT_INVALID");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("CALL_ANALYSIS_CALLBACK_CONTEXT_INVALID");
  }

  const candidate = parsed as Record<string, unknown>;
  const requestId = String(candidate.requestId || "").trim();
  const callId = String(candidate.callId || "").trim();
  const leadId = String(candidate.leadId || "").trim();
  const phoneDigits = normalizeDigits(String(candidate.phoneDigits || ""));
  const externalCallId = String(candidate.externalCallId || "").trim() || null;
  const sessionId = String(candidate.sessionId || "").trim() || null;
  const triggeredAt = String(candidate.triggeredAt || "").trim() || undefined;

  if (!requestId || !callId || !leadId || !phoneDigits) {
    throw new Error("CALL_ANALYSIS_CALLBACK_CONTEXT_MISSING_FIELDS");
  }

  return {
    requestId,
    callId,
    leadId,
    phoneDigits,
    externalCallId,
    sessionId,
    triggeredAt,
  };
}

function extractAnalysisText(body: AnalysisCallbackBody) {
  const candidates = [
    body.analysisText,
    body.analise,
    typeof body.analysis === "string" ? body.analysis : undefined,
    typeof body.analysis === "object" ? body.analysis?.text : undefined,
    typeof body.analysis === "object" ? body.analysis?.summary : undefined,
    typeof body.analysis === "object" ? body.analysis?.result : undefined,
    typeof body.analysis === "object" ? body.analysis?.output : undefined,
  ];
  for (const candidate of candidates) {
    const text = String(candidate || "").trim();
    if (text) return text;
  }
  if (body.analysis && typeof body.analysis === "object" && Object.keys(body.analysis).length > 0) {
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

function createSyntheticRequestId(callId: string) {
  const safeCallId = String(callId || "SEM_CALL").replace(/[^0-9A-Za-z_-]/g, "").slice(0, 32) || "SEM_CALL";
  return `ANL-CB-${safeCallId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function buildUniqueValues(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function resolveDeterministicCallLog(
  callLogs: Awaited<ReturnType<typeof getCallLogs>>,
  context: CallLogLookupContext,
) {
  const idCandidates = buildUniqueValues([
    context.requestCallId,
    context.requestExternalCallId,
    context.callbackCallId,
    context.callbackExternalCallId,
  ]);
  const sessionCandidates = buildUniqueValues([context.requestSessionId, context.callbackSessionId]);

  const byStrongId = callLogs.filter((entry) => {
    const entryId = String(entry.id || "").trim();
    const entryExternal = String(entry.externalCallId || "").trim();
    const entrySession = String(entry.sessionId || "").trim();
    return (
      (entryId && idCandidates.includes(entryId)) ||
      (entryExternal && idCandidates.includes(entryExternal)) ||
      (entrySession && sessionCandidates.includes(entrySession))
    );
  });

  const filteredByLeadAndPhone = byStrongId.filter((entry) => {
    const entryLeadId = String(entry.leadId || "").trim();
    const entryPhoneDigits = normalizeDigits(entry.telefone || entry.called || entry.caller || "");
    const leadMatches = !entryLeadId || entryLeadId === context.requestLeadId;
    const phoneMatches = !entryPhoneDigits || entryPhoneDigits === context.requestPhoneDigits;
    return leadMatches && phoneMatches;
  });

  const ordered = [...filteredByLeadAndPhone].sort((a, b) => {
    const first = String(a.startedAt || a.createdAt || "");
    const second = String(b.startedAt || b.createdAt || "");
    return second.localeCompare(first);
  });

  return {
    idCandidates,
    sessionCandidates,
    strongCandidates: byStrongId,
    filteredCandidates: filteredByLeadAndPhone,
    selected: ordered[0] || null,
    ambiguous: ordered.length > 1,
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

    const callbackSigningSecret = buildCallbackSigningSecret(config.secret);
    let correlationContext: CallbackCorrelationContext | null = null;
    try {
      correlationContext = parseCorrelationContextFromRequest(request, callbackSigningSecret);
    } catch (contextError) {
      const code =
        contextError instanceof Error ? contextError.message : "CALL_ANALYSIS_CALLBACK_CONTEXT_INVALID";
      if (
        code === "CALL_ANALYSIS_CALLBACK_SIGNATURE_REQUIRED" ||
        code === "CALL_ANALYSIS_CALLBACK_SIGNATURE_MISMATCH"
      ) {
        return NextResponse.json(
          {
            success: false,
            message: "Assinatura invalida no contexto do callback de analise.",
            code,
          },
          { status: 401 },
        );
      }
      return NextResponse.json(
        {
          success: false,
          message: "Contexto de callback invalido para correlacao da analise.",
          code,
        },
        { status: 400 },
      );
    }
    const body = (await request.json()) as AnalysisCallbackBody;
    let requestId = extractRequestId(body) || correlationContext?.requestId || "";
    const callbackCallId = extractCallId(body) || correlationContext?.callId || "";
    let callbackLeadId = extractLeadId(body) || correlationContext?.leadId || "";
    const callbackPhoneDigits = extractPhoneDigits(body) || correlationContext?.phoneDigits || "";
    const callbackExternalCallId =
      extractExternalCallId(body) || String(correlationContext?.externalCallId || "").trim();
    const callbackSessionId = extractSessionId(body) || String(correlationContext?.sessionId || "").trim();
    const callbackStatus = String(body.status || "").trim().toLowerCase();
    const isErrorStatus = callbackStatus === "error" || callbackStatus === "failed";
    const callbackError = String(body.error || "").trim();
    const analysisText = extractAnalysisText(body);

    if (correlationContext) {
      const mismatchReasons: string[] = [];
      if (requestId && requestId !== correlationContext.requestId) mismatchReasons.push("requestId");
      if (callbackCallId && callbackCallId !== correlationContext.callId) mismatchReasons.push("callId");
      if (callbackPhoneDigits && callbackPhoneDigits !== correlationContext.phoneDigits) mismatchReasons.push("phoneDigits");
      if (callbackLeadId && callbackLeadId !== correlationContext.leadId) mismatchReasons.push("leadId");
      if (mismatchReasons.length > 0) {
        return NextResponse.json(
          {
            success: false,
            message: "Retorno inconsistente com contexto assinado da solicitacao.",
            code: "CALL_ANALYSIS_CALLBACK_CONTEXT_MISMATCH",
            mismatches: mismatchReasons,
          },
          { status: 409 },
        );
      }
    }

    console.log("[ANALISE_IA] CALLBACK_RECEIVED", {
      requestId: requestId || null,
      callId: callbackCallId || null,
      leadId: callbackLeadId || null,
      phoneDigits: callbackPhoneDigits || null,
      status: callbackStatus || "done",
      hasSignedContext: Boolean(correlationContext),
    });

    if (!requestId || !callbackCallId || !callbackPhoneDigits) {
      return NextResponse.json(
        {
          success: false,
          message: "Retorno de analise sem dados obrigatorios de correlacao (requestId/callId/phone).",
          code: "CALL_ANALYSIS_MISSING_CORRELATION_FIELDS",
        },
        { status: 400 },
      );
    }

    const allRequests = await getCallAnalysisRequests();
    let requestRecord = requestId ? await getCallAnalysisRequestById(requestId) : null;

    if (!requestRecord && correlationContext) {
      requestRecord = await saveCallAnalysisRequest({
        requestId: correlationContext.requestId,
        callId: correlationContext.callId,
        leadId: correlationContext.leadId,
        phoneDigits: correlationContext.phoneDigits,
        externalCallId: correlationContext.externalCallId || null,
        sessionId: correlationContext.sessionId || null,
        triggeredAt: correlationContext.triggeredAt || new Date().toISOString(),
        status: "processing",
        observationId: null,
        analysisText: null,
        errorMessage: null,
        completedAt: null,
      });
      requestId = correlationContext.requestId;
      console.warn("[ANALISE_IA] CALLBACK_REQUEST_RECREATED_FROM_CONTEXT", {
        requestId,
        callId: correlationContext.callId,
        leadId: correlationContext.leadId,
      });
    }

    if (!requestRecord) {
      const correlatedByCallAndPhone = allRequests.filter((item) => {
        if (item.callId !== callbackCallId && String(item.externalCallId || "").trim() !== callbackCallId) return false;
        if (item.phoneDigits !== callbackPhoneDigits) return false;
        if (callbackLeadId && item.leadId !== callbackLeadId) return false;
        return true;
      });
      if (correlatedByCallAndPhone.length === 1) {
        requestRecord = correlatedByCallAndPhone[0];
        requestId = requestRecord.requestId;
      } else if (correlatedByCallAndPhone.length > 1) {
        return NextResponse.json(
          {
            success: false,
            message: "Retorno ambiguo: mais de uma solicitacao para callId+telefone.",
            code: "CALL_ANALYSIS_AMBIGUOUS_REQUEST",
          },
          { status: 409 },
        );
      }
    }

    const allCallLogs = await getCallLogs();
    const matchedCallLogs = allCallLogs.filter((entry) => {
      const entryExternalCallId = String(entry.externalCallId || "").trim();
      if (entry.id !== callbackCallId && entryExternalCallId !== callbackCallId) return false;
      const entryDigits = normalizeDigits(entry.telefone || entry.called || entry.caller || "");
      if (entryDigits && entryDigits !== callbackPhoneDigits) return false;
      if (callbackLeadId && String(entry.leadId || "").trim() !== callbackLeadId) return false;
      return true;
    });

    if (!requestRecord && matchedCallLogs.length === 1) {
      const callLog = matchedCallLogs[0];
      const resolvedLeadId = String(callbackLeadId || callLog.leadId || "").trim();
      const resolvedPhoneDigits = callbackPhoneDigits || normalizeDigits(callLog.telefone || callLog.called || callLog.caller || "");
      if (!resolvedLeadId || !resolvedPhoneDigits) {
        return NextResponse.json(
          {
            success: false,
            message: "Ligacao localizada, mas sem lead/telefone suficientes para vinculo seguro.",
            code: "CALL_ANALYSIS_MISSING_SAFE_BINDING",
          },
          { status: 409 },
        );
      }

      const syntheticRequestId = requestId || createSyntheticRequestId(callLog.id);
      requestRecord = await saveCallAnalysisRequest({
        requestId: syntheticRequestId,
        callId: callLog.id,
        leadId: resolvedLeadId,
        phoneDigits: resolvedPhoneDigits,
        externalCallId: String(callLog.externalCallId || "").trim() || null,
        sessionId: String(callLog.sessionId || "").trim() || null,
        triggeredAt: new Date().toISOString(),
        status: "processing",
        observationId: null,
        analysisText: null,
        errorMessage: null,
        completedAt: null,
      });
      requestId = syntheticRequestId;
      console.warn("[ANALISE_IA] CALLBACK_SYNTHETIC_REQUEST_CREATED", {
        requestId,
        callId: callLog.id,
        leadId: resolvedLeadId,
        reason: "requestId-not-found-fallback-by-call",
      });
    } else if (!requestRecord && matchedCallLogs.length > 1) {
      return NextResponse.json(
        {
          success: false,
          message: "Retorno ambiguo: mais de uma ligacao candidata para callId+telefone.",
          code: "CALL_ANALYSIS_AMBIGUOUS_CALLLOG",
        },
        { status: 409 },
      );
    }

    if (!requestRecord) {
      return NextResponse.json(
        {
          success: false,
          message: "Solicitacao de analise nao encontrada para os dados de correlacao informados.",
          code: "CALL_ANALYSIS_REQUEST_NOT_FOUND",
        },
        { status: 404 },
      );
    }

    if (!callbackLeadId) {
      callbackLeadId = requestRecord.leadId;
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

    console.log("[ANALISE_IA] CALLBACK_LOOKUP_INPUT", {
      requestId,
      callbackCallId: callbackCallId || null,
      callbackExternalCallId: callbackExternalCallId || null,
      callbackSessionId: callbackSessionId || null,
      requestCallId: requestRecord.callId,
      requestExternalCallId: requestRecord.externalCallId || null,
      requestSessionId: requestRecord.sessionId || null,
      requestLeadId: requestRecord.leadId,
      requestPhoneDigits: requestRecord.phoneDigits,
    });

    const mismatches: string[] = [];
    if (requestRecord.callId !== callbackCallId && requestRecord.externalCallId !== callbackCallId) {
      mismatches.push("callId");
    }
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

    const resolvedCallLog = resolveDeterministicCallLog(allCallLogs, {
      requestCallId: requestRecord.callId,
      requestExternalCallId: requestRecord.externalCallId || null,
      requestSessionId: requestRecord.sessionId || null,
      requestLeadId: requestRecord.leadId,
      requestPhoneDigits: requestRecord.phoneDigits,
      callbackCallId,
      callbackExternalCallId: callbackExternalCallId || null,
      callbackSessionId: callbackSessionId || null,
    });

    console.log("[ANALISE_IA] CALLBACK_CALLLOG_SEARCH", {
      requestId,
      idCandidates: resolvedCallLog.idCandidates,
      sessionCandidates: resolvedCallLog.sessionCandidates,
      strongCandidatesCount: resolvedCallLog.strongCandidates.length,
      filteredCandidatesCount: resolvedCallLog.filteredCandidates.length,
      ambiguous: resolvedCallLog.ambiguous,
      selectedCallLogId: resolvedCallLog.selected?.id || null,
    });

    if (resolvedCallLog.ambiguous) {
      mismatches.push("callLogAmbiguous");
    }

    let callLog = resolvedCallLog.selected;
    if (!callLog) {
      const repaired = await upsertCallLog({
        id: requestRecord.callId,
        externalCallId: requestRecord.externalCallId || callbackExternalCallId || null,
        sessionId: requestRecord.sessionId || callbackSessionId || null,
        leadId: requestRecord.leadId,
        telefone: callbackPhoneDigits,
        processingStatus: "processing",
        analysisRequestId: requestId,
        analysisError: null,
      });
      callLog = repaired.record;
      console.warn("[ANALISE_IA] CALLBACK_CALLLOG_REPAIRED", {
        requestId,
        repairedCallLogId: callLog.id,
        externalCallId: callLog.externalCallId || null,
        sessionId: callLog.sessionId || null,
      });
    }

    if (callLog) {
      const callLogLeadId = String(callLog.leadId || "").trim();
      const callLogPhoneDigits = normalizeDigits(callLog.telefone || callLog.called || callLog.caller || "");
      if (callLogLeadId && callLogLeadId !== requestRecord.leadId) mismatches.push("callLogLeadMismatch");
      if (callLogPhoneDigits && callLogPhoneDigits !== requestRecord.phoneDigits) mismatches.push("callLogPhoneMismatch");
      console.log("[ANALISE_IA] CALLBACK_CALLLOG_RESOLVED", {
        requestId,
        callLogId: callLog.id,
        callLogExternalCallId: callLog.externalCallId || null,
        callLogSessionId: callLog.sessionId || null,
        callLogLeadId: callLogLeadId || null,
        callLogPhoneDigits: callLogPhoneDigits || null,
      });
    } else {
      mismatches.push("callLogNotFound");
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
      console.error("[ANALISE_IA] CALLBACK_CORRELATION_MISMATCH", {
        requestId,
        callId: requestRecord.callId,
        leadId: requestRecord.leadId,
        phoneDigits: requestRecord.phoneDigits,
        mismatches,
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
