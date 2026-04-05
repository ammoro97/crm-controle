import { randomUUID } from "crypto";
import { upsertCallLog } from "@/lib/calls-store";
import { getApi4ComIntegracaoByRamal } from "@/lib/api4com-config-store";
import { assertUserHasActiveExtension } from "@/lib/ramais/get-user-extension";
import type { Api4StartCallPayload, ResolvedCallContext, StartCallInput } from "@/types/ligacoes";

const API4_DIALER_ENDPOINT = "https://api.api4com.com/api/v1/dialer";

export class StartCallError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly detail?: string;

  constructor(status: number, code: string, message: string, detail?: string) {
    super(message);
    this.name = "StartCallError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

type StartCallResult = {
  success: true;
  message: string;
  externalCallId: string | null;
  data: unknown;
  context: ResolvedCallContext;
};

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

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
    if (depth > 6) return null;
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

function resolveApi4ErrorMessage(responseBody: unknown): string {
  let apiMessage = "Falha ao disparar ligacao na API4COM";
  if (responseBody && typeof responseBody === "object") {
    const source = responseBody as Record<string, unknown>;
    const messageCandidates = [source.message, source.error, source.detail, source.reason, source.status];
    const resolvedMessage = messageCandidates.find(
      (candidate) => typeof candidate === "string" && String(candidate).trim().length > 0,
    );
    if (typeof resolvedMessage === "string") {
      apiMessage = resolvedMessage;
    } else if (Array.isArray(source.errors) && source.errors.length > 0) {
      const firstError = source.errors[0];
      if (typeof firstError === "string" && firstError.trim()) {
        apiMessage = firstError;
      }
    }
  } else if (typeof responseBody === "string" && responseBody.trim()) {
    apiMessage = responseBody.trim();
  }
  return apiMessage;
}

function buildSessionId(inputSessionId?: string): string | null {
  const normalized = normalizeText(inputSessionId);
  if (normalized) return normalized;
  return `SESSION-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function startApi4CallByAuthenticatedUser(params: {
  userId: string;
  input: StartCallInput;
}): Promise<StartCallResult> {
  const userId = normalizeText(params.userId);
  if (!userId) {
    throw new StartCallError(401, "CALL_USER_NOT_AUTHENTICATED", "Usuario autenticado nao encontrado.");
  }

  const leadId = normalizeText(params.input.leadId);
  const numeroRaw = normalizeText(params.input.numero);
  const numero = normalizePhone(numeroRaw);
  const nome = normalizeText(params.input.nome);
  const empresa = normalizeText(params.input.empresa);
  const responsavelId = normalizeText(params.input.responsavelId) || null;
  const atendenteNome = normalizeText(params.input.atendenteNome) || null;
  const sessionId = buildSessionId(params.input.sessionId);

  if (!leadId) {
    throw new StartCallError(400, "CALL_LEAD_REQUIRED", "Lead da ligacao e obrigatorio.");
  }

  if (!numero) {
    throw new StartCallError(400, "CALL_NUMBER_REQUIRED", "Numero de telefone invalido para discagem.");
  }

  const userExtension = await assertUserHasActiveExtension(userId).catch((error) => {
    const message = error instanceof Error ? error.message : "Falha ao carregar ramal do usuario.";
    if (message === "USER_EXTENSIONS_TABLE_MISSING") {
      throw new StartCallError(
        500,
        "CALL_USER_EXTENSION_TABLE_MISSING",
        "Tabela de ramais de usuario nao encontrada no banco. Execute as migracoes.",
      );
    }
    if (message === "USER_EXTENSION_INACTIVE") {
      throw new StartCallError(
        409,
        "CALL_USER_EXTENSION_INACTIVE",
        "Seu usuario possui ramal vinculado, mas ele esta inativo. Fale com o administrador.",
      );
    }
    if (message === "USER_EXTENSION_INVALID") {
      throw new StartCallError(
        409,
        "CALL_USER_EXTENSION_INVALID",
        "O ramal vinculado ao seu usuario esta invalido. Fale com o administrador.",
      );
    }
    if (message === "USER_EXTENSION_NOT_CONFIGURED") {
      throw new StartCallError(
        409,
        "CALL_USER_EXTENSION_NOT_CONFIGURED",
        "Seu usuario nao possui um ramal vinculado. Fale com o administrador.",
      );
    }
    throw new StartCallError(500, "CALL_USER_EXTENSION_LOOKUP_FAILED", "Nao foi possivel carregar o ramal do usuario.");
  });

  const ramal = normalizeText(userExtension.ramal);
  if (!ramal) {
    throw new StartCallError(
      409,
      "CALL_USER_EXTENSION_INVALID",
      "O ramal vinculado ao seu usuario esta invalido. Fale com o administrador.",
    );
  }

  const integration = await getApi4ComIntegracaoByRamal(ramal);
  if (!integration) {
    throw new StartCallError(
      409,
      "CALL_API4_INTEGRATION_NOT_FOUND",
      `Nao existe configuracao API4 cadastrada para o ramal ${ramal}.`,
    );
  }

  const token = normalizeText(integration.token);
  const gateway = normalizeText(integration.gateway);
  if (!token) {
    throw new StartCallError(
      409,
      "CALL_API4_TOKEN_MISSING",
      `Token da API4 ausente para o ramal ${ramal}.`,
    );
  }

  const payload: {
    extension: string;
    phone: string;
    metadata: Record<string, unknown>;
  } = {
    extension: ramal,
    phone: numero,
    metadata: {
      gateway: gateway || "",
      sessionId,
      leadId,
      nome,
      empresa,
      telefone: numero,
      userId,
      ramal,
      responsavelId,
      atendenteNome,
    },
  };

  const apiPayloadLog: Api4StartCallPayload = {
    numero,
    ramal,
  };
  console.log("[CALL_START] request", {
    user_id: userId,
    ramal_resolvido: ramal,
    numero,
    lead_id: leadId,
    api_payload: apiPayloadLog,
  });

  const response = await fetch(API4_DIALER_ENDPOINT, {
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

  if (response.status !== 200) {
    const apiMessage = resolveApi4ErrorMessage(responseBody);
    console.log("[CALL_START] api4_error", {
      user_id: userId,
      ramal_resolvido: ramal,
      numero,
      status: response.status,
      api_message: apiMessage,
    });
    throw new StartCallError(response.status, "CALL_API4_REJECTED", apiMessage);
  }

  const externalCallId = extractApi4ComCallId(responseBody);
  const persistedCallId = externalCallId || sessionId || `local-call-${randomUUID()}`;

  await upsertCallLog({
    id: persistedCallId,
    externalCallId: externalCallId || null,
    sessionId,
    leadId,
    userId,
    responsavelId,
    atendenteNome,
    nome,
    empresa,
    telefone: numero,
    called: numero,
    gateway: gateway || null,
    status: "Discando",
    eventType: "dial_request",
    ramal,
  });

  console.log("[CALL_START] success", {
    user_id: userId,
    ramal_resolvido: ramal,
    numero,
    external_call_id: externalCallId,
  });

  return {
    success: true,
    message: "Ligacao disparada com sucesso.",
    externalCallId,
    data: responseBody,
    context: {
      userId,
      ramal,
      numero,
      leadId,
      sessionId,
      nome,
      empresa,
      responsavelId,
      atendenteNome,
    },
  };
}
