import { NextResponse } from "next/server";
import {
  getWebhookOutConfig,
  isWebhookOutConfigured,
  saveWebhookOutConfig,
  toPublicWebhookOutConfig,
} from "@/lib/webhook-out-config-store";

type SaveWebhookOutBody = {
  url?: string;
  secret?: string;
  method?: string;
  enabled?: boolean;
};

export async function GET() {
  try {
    const config = await getWebhookOutConfig();
    return NextResponse.json({
      success: true,
      configured: isWebhookOutConfigured(config),
      config: toPublicWebhookOutConfig(config),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Nao foi possivel carregar configuracao do webhook de saida.",
        detail: error instanceof Error ? error.message : "Erro desconhecido",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SaveWebhookOutBody;
    const url = String(body.url || "").trim();

    if (!url) {
      const disabled = await saveWebhookOutConfig({
        url: "",
        enabled: false,
        secret: typeof body.secret === "string" ? body.secret : undefined,
        method: body.method,
      });
      return NextResponse.json({
        success: true,
        message: "Webhook de saida desativado.",
        configured: false,
        config: toPublicWebhookOutConfig(disabled),
      });
    }

    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("invalid protocol");
      }
    } catch {
      return NextResponse.json(
        { success: false, error: "Informe uma URL valida (http/https)." },
        { status: 400 },
      );
    }

    const next = await saveWebhookOutConfig({
      url,
      secret: typeof body.secret === "string" ? body.secret : undefined,
      method: body.method,
      enabled: typeof body.enabled === "boolean" ? body.enabled : true,
    });

    return NextResponse.json({
      success: true,
      message: "Webhook de saida salvo com sucesso.",
      configured: isWebhookOutConfigured(next),
      config: toPublicWebhookOutConfig(next),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Falha ao salvar webhook de saida.",
        detail: error instanceof Error ? error.message : "Erro desconhecido",
      },
      { status: 500 },
    );
  }
}
