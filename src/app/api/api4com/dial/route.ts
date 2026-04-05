import { NextResponse } from "next/server";
import { resolveApi4ComIntegracaoForResponsavel } from "@/lib/api4com-config-store";
import { requireAuth } from "@/lib/require-auth";

type DialRequestBody = {
  phone?: string;
  leadId?: string;
  sessionId?: string;
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

function extractApi4ComCallId(payload: unknown): string | null {
  const read = (value: unknown): string | null => {
    if (!value || typeof value !== "object") return null;
    const source = value as Record<string, unknown>;
    const direct = String(
      source.externalCallId || source.id || source.call_id || source.callId || source.uniqueid || "",
    ).trim();
    return direct || null;
  };

  const walk = (value: unknown, depth: number): string | null => {
    if (depth > 5) return null;
    const direct = read(value);
    if (direct) return direct;
    if (!value || typeof value !== "object") return null;
    const source = value as Record<string, unknown>;
    for (const nested of Object.values(source)) {
      if (!nested || typeof nested !== "object") continue;
      const found = walk(nested, depth + 1);
      if (found) return found;
    }
    return null;
  };

  return walk(payload, 0);
}

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  try {
    const body = (await request.json()) as DialRequestBody;
    const responsavelId = (body.responsavelId || "").trim();
    const atendenteNome = (body.atendenteNome || "").trim();
    const integration = await resolveApi4ComIntegracaoForResponsavel(responsavelId || null);

    if (!integration) {
      return NextResponse.json(
        {
          success: false,
          message: "Nenhum ramal da API4COM foi cadastrado. Acesse Configuracoes > Integracoes > API4.",
        },
        { status: 400 },
      );
    }

    const token = String(integration.token || "").trim();
    const extension = String(integration.ramal || "").trim();
    const gateway = String(integration.gateway || "").trim();

    if (!token) {
      return NextResponse.json(
        {
          success: false,
          message: "Token da API4COM nao configurado. Acesse Configuracoes > Integracoes > API4.",
        },
        { status: 400 },
      );
    }

    if (!extension) {
      return NextResponse.json(
        {
          success: false,
          message: "Ramal da API4COM nao configurado. Acesse Configuracoes > Integracoes > API4.",
        },
        { status: 400 },
      );
    }

    const rawPhone = (body.phone || "").trim();
    const normalizedPhone = normalizePhone(rawPhone);
    const leadId = (body.leadId || "").trim();
    const sessionId = (body.sessionId || "").trim();
    const nome = (body.nome || body.name || "").trim();
    const empresa = (body.empresa || body.company || "").trim();
    const userId = (body.userId || "").trim();

    if (!normalizedPhone || !leadId || !nome) {
      return NextResponse.json(
        {
          success: false,
          message: "Campos obrigatorios: phone, leadId, nome.",
        },
        { status: 400 },
      );
    }

    if (!responsavelId || !atendenteNome) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Seu usuario ainda nao esta cadastrado em Responsaveis. Faca esse cadastro antes de realizar ligacoes.",
        },
        { status: 400 },
      );
    }

    const payload = {
      extension,
      phone: normalizedPhone,
      metadata: {
        gateway: gateway || "",
        sessionId,
        leadId,
        nome,
        empresa,
        telefone: normalizedPhone,
        userId,
        responsavelId,
        atendenteNome,
      },
    };

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

    const externalCallId = extractApi4ComCallId(responseBody);

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
        },
        { status: response.status },
      );
    }

    return NextResponse.json({
      success: true,
      message: "Ligacao disparada com sucesso.",
      externalCallId,
      data: responseBody,
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        message: "Erro interno ao disparar ligacao.",
      },
      { status: 500 },
    );
  }
}
