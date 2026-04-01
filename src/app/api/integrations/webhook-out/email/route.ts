import { NextResponse } from "next/server";
import { getWebhookOutConfig, isWebhookOutConfigured } from "@/lib/webhook-out-config-store";
import { requireAuth } from "@/lib/require-auth";
import { CALL_ANALYSIS_SECRET_HEADER } from "@/types/call-analysis";
import {
  CALL_WRAPUP_EMAIL_EVENT,
  EmailDispatchPayload,
  EmailDispatchRequestBody,
  EmailDispatchResponse,
} from "@/types/call-finalization";

function normalizeObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  try {
    const body = (await request.json()) as EmailDispatchRequestBody;
    const finalization = normalizeObject(body?.finalization);
    const lead = normalizeObject(body?.lead);
    const email = normalizeObject(body?.email);

    const wrapupId = String(finalization.wrapupId || "").trim();
    const sessionId = String(finalization.sessionId || "").trim();
    const to = String(email.to || "").trim();
    const content = String(email.content || "").trim();

    if (!wrapupId || !sessionId) {
      return NextResponse.json<EmailDispatchResponse>(
        {
          success: false,
          message: "Dados de finalizacao invalidos para envio de email.",
        },
        { status: 400 },
      );
    }

    if (!to || !content) {
      return NextResponse.json<EmailDispatchResponse>(
        {
          success: false,
          message: "Email e mensagem sao obrigatorios para disparo do webhook.",
        },
        { status: 400 },
      );
    }

    const config = await getWebhookOutConfig();
    if (!isWebhookOutConfigured(config)) {
      return NextResponse.json<EmailDispatchResponse>(
        {
          success: false,
          message: "Webhook de saida nao configurado. Configure em Configuracoes > Integracoes.",
        },
        { status: 400 },
      );
    }

    const payload: EmailDispatchPayload = {
      event: CALL_WRAPUP_EMAIL_EVENT,
      triggeredAt: new Date().toISOString(),
      source: "crm",
      finalization: {
        wrapupId,
        sessionId,
        callId: String(finalization.callId || "").trim() || null,
        externalCallId: String(finalization.externalCallId || "").trim() || null,
        leadId: String(finalization.leadId || "").trim() || null,
        result: String(finalization.result || "").trim(),
        reason: String(finalization.reason || "").trim() || null,
        observations: String(finalization.observations || "").trim() || null,
        nextAction: String(finalization.nextAction || "").trim() || null,
        followUpDate: String(finalization.followUpDate || "").trim() || null,
        followUpTime: String(finalization.followUpTime || "").trim() || null,
        savedAt: String(finalization.savedAt || "").trim() || new Date().toISOString(),
        userId: String(finalization.userId || "").trim() || null,
        responsavelId: String(finalization.responsavelId || "").trim() || null,
        atendenteNome: String(finalization.atendenteNome || "").trim() || null,
      },
      lead: {
        id: String(lead.id || "").trim() || null,
        name: String(lead.name || "").trim() || null,
        company: String(lead.company || "").trim() || null,
        phone: String(lead.phone || "").trim() || null,
        email: String(lead.email || "").trim() || null,
        phones: Array.isArray(lead.phones) ? lead.phones : [],
        emails: Array.isArray(lead.emails) ? lead.emails : [],
      },
      email: {
        to,
        content,
      },
      metadata: body?.metadata && typeof body.metadata === "object" ? body.metadata : {},
    };

    const response = await fetch(config.url, {
      method: config.method,
      headers: {
        "Content-Type": "application/json",
        "x-crm-event": CALL_WRAPUP_EMAIL_EVENT,
        ...(config.secret ? { [CALL_ANALYSIS_SECRET_HEADER]: config.secret } : {}),
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    if (!response.ok) {
      const detail = await response.text();
      return NextResponse.json<EmailDispatchResponse>(
        {
          success: false,
          message: "Falha ao disparar webhook de email da finalizacao.",
          status: response.status,
          detail: detail || null,
        },
        { status: 502 },
      );
    }

    return NextResponse.json<EmailDispatchResponse>({
      success: true,
      message: "Webhook de email disparado com sucesso.",
    });
  } catch {
    return NextResponse.json<EmailDispatchResponse>(
      {
        success: false,
        message: "Nao foi possivel processar envio de email da finalizacao.",
      },
      { status: 500 },
    );
  }
}
