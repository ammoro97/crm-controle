import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createHmac } from "crypto";
import { getUserBySessionToken } from "@/lib/auth-store";
import { saveCallAnalysisRequest, updateCallAnalysisRequest } from "@/lib/call-analysis-store";
import { getCallLogs, upsertCallLog } from "@/lib/calls-store";
import { getWebhookOutConfig, isWebhookOutConfigured } from "@/lib/webhook-out-config-store";
import { requireAuth } from "@/lib/require-auth";
import {
  CALL_ANALYSIS_EVENT,
  CALL_ANALYSIS_RESULT_EVENT,
  CALL_ANALYSIS_SECRET_HEADER,
  CallAnalysisCallPayload,
  CallAnalysisRequestedPayload,
} from "@/types/call-analysis";

const SESSION_COOKIE = "crm_auth_token";

type GenerateAnalysisBody = {
  triggeredByUserId?: string;
  triggeredByName?: string;
  triggeredByEmail?: string;
  webhook?: {
    url?: string;
    secret?: string;
    method?: "POST";
  };
  call?: CallAnalysisCallPayload;
};

function normalizeWebhookUrl(value?: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^ps:\/\//i.test(raw)) return `https://${raw.slice(5)}`;
  if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(raw)) return `https://${raw}`;
  return raw;
}

function normalizeDigits(value?: string | null) {
  const digits = String(value || "").replace(/\D/g, "");
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    return digits.slice(2);
  }
  return digits;
}

function generateAnalysisRequestId() {
  return `ANL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

type CallbackCorrelationContext = {
  requestId: string;
  callId: string;
  leadId: string;
  phoneDigits: string;
  externalCallId?: string | null;
  sessionId?: string | null;
  triggeredAt: string;
};

function buildCallbackSigningSecret(configSecret?: string | null) {
  const fromConfig = String(configSecret || "").trim();
  if (fromConfig) return fromConfig;
  return String(process.env.CALL_ANALYSIS_CALLBACK_SECRET || "").trim();
}

function encodeCallbackContext(context: CallbackCorrelationContext) {
  return Buffer.from(JSON.stringify(context), "utf8").toString("base64url");
}

function signCallbackContext(encodedContext: string, secret: string) {
  return createHmac("sha256", secret).update(encodedContext).digest("hex");
}

function normalizeCallPayload(input?: CallAnalysisCallPayload): CallAnalysisCallPayload | null {
  if (!input) return null;
  const id = String(input.id || "").trim();
  if (!id) return null;

  return {
    ...input,
    id,
    callId: String(input.callId || id).trim(),
    leadId: input.leadId || null,
    externalCallId: input.externalCallId || null,
    sessionId: input.sessionId || null,
    recordingUrl: input.recordingUrl || null,
  };
}

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  let createdRequestId = "";
  let createdCallId = "";
  try {
    const body = (await request.json()) as GenerateAnalysisBody;
    let config = await getWebhookOutConfig();
    const overrideUrl = normalizeWebhookUrl(body.webhook?.url);
    if (overrideUrl) {
      config = {
        ...config,
        url: overrideUrl,
        method: "POST",
        secret: String(body.webhook?.secret || "").trim() || config.secret,
        enabled: true,
      };
    }

    if (!isWebhookOutConfigured(config)) {
      return NextResponse.json(
        {
          success: false,
          message: "Webhook de saida nao configurado. Configure em Configuracoes > Integracoes.",
          code: "WEBHOOK_OUT_NOT_CONFIGURED",
        },
        { status: 400 },
      );
    }

    const normalizedCall = normalizeCallPayload(body.call);
    if (!normalizedCall) {
      return NextResponse.json(
        { success: false, message: "Ligacao invalida para gerar analise." },
        { status: 400 },
      );
    }

    const allCalls = await getCallLogs();
    const requestedId = String(normalizedCall.id || "").trim();
    const requestedCallId = String(normalizedCall.callId || "").trim();
    const requestedExternalCallId = String(normalizedCall.externalCallId || "").trim();
    const requestedSessionId = String(normalizedCall.sessionId || "").trim();

    const matchedCallLog =
      allCalls.find((entry) => entry.id === requestedCallId) ||
      allCalls.find((entry) => entry.id === requestedId) ||
      allCalls.find((entry) => String(entry.externalCallId || "").trim() === requestedCallId) ||
      allCalls.find((entry) => String(entry.externalCallId || "").trim() === requestedId) ||
      allCalls.find((entry) => String(entry.externalCallId || "").trim() === requestedExternalCallId) ||
      allCalls.find((entry) => String(entry.sessionId || "").trim() === requestedSessionId) ||
      null;

    const canonicalCallId = String(matchedCallLog?.id || normalizedCall.id).trim();
    const recordingUrl = normalizedCall.recordingUrl || matchedCallLog?.recordUrl || null;
    const leadId = String(normalizedCall.leadId || matchedCallLog?.leadId || "").trim();
    const externalCallId = String(normalizedCall.externalCallId || matchedCallLog?.externalCallId || "").trim() || null;
    const sessionId = String(normalizedCall.sessionId || matchedCallLog?.sessionId || "").trim() || null;
    const ramal = normalizedCall.ramal || matchedCallLog?.gateway || null;
    const phoneDigits = normalizeDigits(normalizedCall.phone || matchedCallLog?.telefone || matchedCallLog?.called || "");

    if (!canonicalCallId || !leadId || !phoneDigits) {
      return NextResponse.json(
        {
          success: false,
          message: "Ligacao sem vinculo deterministico para analise. Verifique callId, leadId e telefone.",
          code: "CALL_ANALYSIS_CORRELATION_REQUIRED",
        },
        { status: 400 },
      );
    }

    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value || "";
    const sessionUser = token ? await getUserBySessionToken(token) : null;

    const triggeredByUserId = sessionUser?.id || body.triggeredByUserId || undefined;
    const triggeredByName = sessionUser?.nome || body.triggeredByName || undefined;
    const triggeredByEmail = sessionUser?.email || body.triggeredByEmail || undefined;
    const requestId = generateAnalysisRequestId();
    const triggeredAt = new Date().toISOString();
    const callbackContext: CallbackCorrelationContext = {
      requestId,
      callId: canonicalCallId,
      leadId,
      phoneDigits,
      externalCallId,
      sessionId,
      triggeredAt,
    };
    const encodedCallbackContext = encodeCallbackContext(callbackContext);
    const callbackSigningSecret = buildCallbackSigningSecret(config.secret);
    const callbackSignature = callbackSigningSecret
      ? signCallbackContext(encodedCallbackContext, callbackSigningSecret)
      : "";
    const callbackBaseUrl = `${new URL(request.url).origin}/api/integracoes/analise-ia/retorno`;
    const callbackParams = new URLSearchParams();
    callbackParams.set("ctx", encodedCallbackContext);
    if (callbackSignature) callbackParams.set("sig", callbackSignature);
    const callbackUrl = `${callbackBaseUrl}?${callbackParams.toString()}`;
    createdRequestId = requestId;
    createdCallId = canonicalCallId;

    await saveCallAnalysisRequest({
      requestId,
      callId: canonicalCallId,
      leadId,
      phoneDigits,
      externalCallId,
      sessionId,
      triggeredAt,
      triggeredByUserId,
      triggeredByName,
      triggeredByEmail,
      status: "processing",
      observationId: null,
      analysisText: null,
      errorMessage: null,
      completedAt: null,
    });

    await upsertCallLog({
      id: canonicalCallId,
      externalCallId,
      sessionId,
      leadId,
      telefone: normalizedCall.phone || matchedCallLog?.telefone || "",
      nome: normalizedCall.contactName || matchedCallLog?.nome || "",
      empresa: normalizedCall.companyName || matchedCallLog?.empresa || "",
      startedAt: normalizedCall.startedAt || matchedCallLog?.startedAt || null,
      endedAt: normalizedCall.endedAt || matchedCallLog?.endedAt || null,
      durationSeconds: Number(normalizedCall.durationSeconds || matchedCallLog?.durationSeconds || 0),
      status: normalizedCall.status || matchedCallLog?.status || "Nao atendida",
      gateway: normalizedCall.ramal || matchedCallLog?.gateway || null,
      recordUrl: recordingUrl,
      analysisStatus: "processing",
      processingStatus: "processing",
      analysisRequestId: requestId,
      analysisLeadId: leadId,
      analysisUpdatedAt: triggeredAt,
      analysisObservationId: null,
      analysisPreview: null,
      aiAnalysis: null,
      analysisError: null,
    });

    const payload: CallAnalysisRequestedPayload = {
      event: CALL_ANALYSIS_EVENT,
      triggeredAt,
      triggeredByUserId,
      triggeredByName,
      triggeredByEmail,
      requestId,
      callbackUrl,
      call: {
        ...normalizedCall,
        id: canonicalCallId,
        callId: canonicalCallId,
        leadId,
        externalCallId,
        sessionId,
        ramal: ramal || undefined,
        recordingUrl,
      },
    };

    const webhookResponse = await fetch(config.url, {
      method: config.method,
      headers: {
        "Content-Type": "application/json",
        "x-crm-event": CALL_ANALYSIS_EVENT,
        ...(config.secret ? { [CALL_ANALYSIS_SECRET_HEADER]: config.secret } : {}),
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    if (!webhookResponse.ok) {
      const detail = await webhookResponse.text();
      await updateCallAnalysisRequest(requestId, {
        status: "error",
        errorMessage: `Webhook status ${webhookResponse.status}`,
        completedAt: new Date().toISOString(),
      });
      await upsertCallLog({
        id: canonicalCallId,
        analysisStatus: "error",
        processingStatus: "error",
        analysisRequestId: requestId,
        analysisLeadId: leadId,
        analysisUpdatedAt: new Date().toISOString(),
        analysisError: "Falha no envio ao processamento externo",
      });
      return NextResponse.json(
        {
          success: false,
          message: "Falha ao enviar solicitacao de analise ao processamento externo.",
          status: webhookResponse.status,
          detail: detail || null,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      message: "Solicitacao de analise enviada com sucesso.",
      event: CALL_ANALYSIS_EVENT,
      callbackEvent: CALL_ANALYSIS_RESULT_EVENT,
      callId: canonicalCallId,
      requestId,
      triggeredAt,
    });
  } catch (error) {
    if (createdRequestId && createdCallId) {
      await updateCallAnalysisRequest(createdRequestId, {
        status: "error",
        errorMessage: error instanceof Error ? error.message : "Erro desconhecido",
        completedAt: new Date().toISOString(),
      });
      await upsertCallLog({
        id: createdCallId,
        analysisStatus: "error",
        processingStatus: "error",
        analysisRequestId: createdRequestId,
        analysisUpdatedAt: new Date().toISOString(),
        analysisError: "Erro interno ao iniciar analise",
      });
    }
    console.error("[ANALISE_IA] REQUEST_FAILED", {
      requestId: createdRequestId || null,
      message: error instanceof Error ? error.message : "Erro desconhecido",
    });
    return NextResponse.json(
      { success: false, message: "Nao foi possivel gerar analise da ligacao." },
      { status: 500 },
    );
  }
}
