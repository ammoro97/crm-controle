import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getUserBySessionToken } from "@/lib/auth-store";
import { getCallLogs, upsertCallLog } from "@/lib/calls-store";
import { getWebhookOutConfig, isWebhookOutConfigured } from "@/lib/webhook-out-config-store";
import {
  CALL_ANALYSIS_EVENT,
  CALL_ANALYSIS_SECRET_HEADER,
  CallAnalysisCallPayload,
  CallAnalysisRequestedPayload,
} from "@/types/call-analysis";

const SESSION_COOKIE = "crm_auth_token";

type GenerateAnalysisBody = {
  triggeredByUserId?: string;
  triggeredByName?: string;
  triggeredByEmail?: string;
  call?: CallAnalysisCallPayload;
};

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
  try {
    const config = await getWebhookOutConfig();
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

    const body = (await request.json()) as GenerateAnalysisBody;
    const normalizedCall = normalizeCallPayload(body.call);
    if (!normalizedCall) {
      return NextResponse.json(
        { success: false, message: "Ligacao invalida para gerar analise." },
        { status: 400 },
      );
    }

    const allCalls = await getCallLogs();
    const matchedCallLog = allCalls.find((entry) => entry.id === normalizedCall.id);

    const recordingUrl = normalizedCall.recordingUrl || matchedCallLog?.recordUrl || null;
    const leadId = normalizedCall.leadId || matchedCallLog?.leadId || null;
    const externalCallId = normalizedCall.externalCallId || matchedCallLog?.externalCallId || null;
    const sessionId = normalizedCall.sessionId || matchedCallLog?.sessionId || null;
    const ramal = normalizedCall.ramal || matchedCallLog?.gateway || null;

    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value || "";
    const sessionUser = token ? await getUserBySessionToken(token) : null;

    const triggeredByUserId = sessionUser?.id || body.triggeredByUserId || undefined;
    const triggeredByName = sessionUser?.nome || body.triggeredByName || undefined;
    const triggeredByEmail = sessionUser?.email || body.triggeredByEmail || undefined;

    const payload: CallAnalysisRequestedPayload = {
      event: CALL_ANALYSIS_EVENT,
      triggeredAt: new Date().toISOString(),
      triggeredByUserId,
      triggeredByName,
      triggeredByEmail,
      call: {
        ...normalizedCall,
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

    if (matchedCallLog) {
      await upsertCallLog({
        id: matchedCallLog.id,
        processingStatus: "processing",
      });
    }

    return NextResponse.json({
      success: true,
      message: "Solicitacao de analise enviada com sucesso.",
      event: CALL_ANALYSIS_EVENT,
      callId: normalizedCall.id,
      triggeredAt: payload.triggeredAt,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: "Nao foi possivel gerar analise da ligacao.",
        detail: error instanceof Error ? error.message : "Erro desconhecido",
      },
      { status: 500 },
    );
  }
}
