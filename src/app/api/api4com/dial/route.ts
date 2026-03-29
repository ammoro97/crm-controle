import { NextResponse } from "next/server";
import { getApi4ComConfig } from "@/lib/api4com-config-store";

type DialRequestBody = {
  phone?: string;
  leadId?: string;
  nome?: string;
  name?: string;
  empresa?: string;
  company?: string;
  userId?: string;
  responsavelId?: string;
  atendenteNome?: string;
};

function normalizePhone(input: string) {
  const onlyDigits = input.replace(/\D/g, "");
  if (!onlyDigits) return "";
  const withCountry = onlyDigits.startsWith("55") ? onlyDigits : `55${onlyDigits}`;
  return `+${withCountry}`;
}

export async function POST(request: Request) {
  console.log("[API4COM][DIAL] Inicio da rota de discagem");

  try {
    const body = (await request.json()) as DialRequestBody;
    const config = await getApi4ComConfig();

    const token = config.token.trim();
    const extension = config.extension.trim();
    const gateway = config.gateway.trim();

    console.log("TOKEN:", token ? "OK" : "AUSENTE");
    console.log("EXTENSION:", extension);
    console.log("PHONE ORIGINAL:", body.phone || "");

    if (!token) {
      return NextResponse.json(
        {
          success: false,
          message: "Token da API4COM nao configurado. Acesse Configuracoes > Integracoes.",
        },
        { status: 400 },
      );
    }

    if (!extension) {
      return NextResponse.json(
        {
          success: false,
          message: "Ramal da API4COM nao configurado. Acesse Configuracoes > Integracoes.",
        },
        { status: 400 },
      );
    }

    const rawPhone = (body.phone || "").trim();
    const normalizedPhone = normalizePhone(rawPhone);
    const leadId = (body.leadId || "").trim();
    const nome = (body.nome || body.name || "").trim();
    const empresa = (body.empresa || body.company || "").trim();
    const userId = (body.userId || "").trim();
    const responsavelId = (body.responsavelId || "").trim();
    const atendenteNome = (body.atendenteNome || "").trim();

    console.log("PHONE NORMALIZADO:", normalizedPhone);

    if (!normalizedPhone || !leadId || !nome) {
      return NextResponse.json(
        {
          success: false,
          message: "Campos obrigatorios: phone, leadId, nome.",
          debug: {
            phone: rawPhone,
            normalizedPhone,
            leadId,
            nome,
          },
        },
        { status: 400 },
      );
    }

    const payload = {
      extension,
      phone: normalizedPhone,
      metadata: {
        gateway: gateway || "",
        leadId,
        nome,
        empresa,
        telefone: normalizedPhone,
        userId,
        responsavelId,
        atendenteNome,
      },
    };

    console.log("[API4COM][DIAL] Payload enviado:", payload);

    const response = await fetch("https://api.api4com.com/api/v1/dialer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: token,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    const responseText = await response.text();
    let responseBody: unknown = null;
    try {
      responseBody = responseText ? JSON.parse(responseText) : null;
    } catch {
      responseBody = responseText || null;
    }

    console.log("[API4COM][DIAL] Status API4COM:", response.status);
    console.log("[API4COM][DIAL] Body API4COM:", responseBody);

    if (response.status !== 200) {
      const apiMessage =
        (responseBody && typeof responseBody === "object" && "message" in responseBody &&
          typeof (responseBody as { message?: unknown }).message === "string" &&
          (responseBody as { message: string }).message) ||
        "Falha ao disparar ligacao na API4COM";

      return NextResponse.json(
        {
          success: false,
          message: apiMessage,
          status: response.status,
          data: responseBody,
        },
        { status: response.status },
      );
    }

    return NextResponse.json({
      success: true,
      message: "Ligacao disparada com sucesso.",
      data: responseBody,
    });
  } catch (error) {
    console.error("[API4COM][DIAL] Erro interno:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Erro interno ao disparar ligacao.",
        detail: error instanceof Error ? error.message : "Erro desconhecido",
      },
      { status: 500 },
    );
  }
}
