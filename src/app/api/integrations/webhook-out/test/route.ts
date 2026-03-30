import { NextResponse } from "next/server";
import { getWebhookOutConfig, isWebhookOutConfigured } from "@/lib/webhook-out-config-store";

export async function POST() {
  try {
    const config = await getWebhookOutConfig();
    if (!isWebhookOutConfigured(config)) {
      return NextResponse.json(
        {
          success: false,
          message: "Webhook de saida nao configurado.",
        },
        { status: 400 },
      );
    }

    const payload = {
      event: "integration.webhook_out.test",
      triggeredAt: new Date().toISOString(),
      source: "crm",
      message: "Teste de webhook de saida",
    };

    const response = await fetch(config.url, {
      method: config.method,
      headers: {
        "Content-Type": "application/json",
        "x-crm-event": "integration.webhook_out.test",
        ...(config.secret ? { "x-webhook-secret": config.secret } : {}),
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    if (!response.ok) {
      const detail = await response.text();
      return NextResponse.json(
        {
          success: false,
          message: "Webhook respondeu com erro no teste.",
          status: response.status,
          detail: detail || null,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      message: "Teste enviado com sucesso.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: "Nao foi possivel enviar teste para webhook de saida.",
        detail: error instanceof Error ? error.message : "Erro desconhecido",
      },
      { status: 500 },
    );
  }
}
