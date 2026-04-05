import { NextResponse } from "next/server";
import {
  createApi4ComIntegracao,
  getApi4ComIntegracaoById,
  getApi4ComIntegracaoTemplate,
  listApi4ComIntegracoes,
  listPublicApi4ComIntegracoes,
  updateApi4ComIntegracao,
} from "@/lib/api4com-config-store";
import { listResponsaveisForVinculo, ResponsavelByAuthError } from "@/lib/responsaveis/get-responsavel-by-auth-user";
import type { StatusIntegracao } from "@/types/integrations";
import { requireAuth } from "@/lib/require-auth";

type CreateRamalPayload = {
  nome?: string;
  ramal?: string;
  gateway?: string | null;
  token?: string | null;
  status?: StatusIntegracao;
  responsavelId?: string | null;
  baseIntegrationId?: string | null;
  setAsPrimary?: boolean;
};

type UpdateRamalPayload = {
  id?: string;
  nome?: string;
  ramal?: string;
  gateway?: string | null;
  token?: string | null;
  status?: StatusIntegracao;
  responsavelId?: string | null;
  setAsPrimary?: boolean;
};

type RamalPayload = {
  items: Awaited<ReturnType<typeof listPublicApi4ComIntegracoes>>;
  template: Awaited<ReturnType<typeof getApi4ComIntegracaoTemplate>>;
  responsaveis: Awaited<ReturnType<typeof listResponsaveisForVinculo>>;
};

class RamalValidationError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "RamalValidationError";
    this.status = status;
    this.code = code;
  }
}

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function normalizeStatus(value: unknown, fallback: StatusIntegracao = "inativo"): StatusIntegracao {
  const parsed = normalizeText(value).toLowerCase();
  if (parsed === "ativo") return "ativo";
  if (parsed === "inativo") return "inativo";
  if (parsed === "erro") return "erro";
  return fallback;
}

async function buildRamaisPayload(): Promise<RamalPayload> {
  const [items, template, responsaveis] = await Promise.all([
    listPublicApi4ComIntegracoes(),
    getApi4ComIntegracaoTemplate(),
    listResponsaveisForVinculo().catch((error) => {
      console.error(
        "[API4_RAMAIS] falha ao carregar responsaveis para vinculo",
        error instanceof Error ? error.message : error,
      );
      return [];
    }),
  ]);

  const responsaveisMap = new Map(responsaveis.map((item) => [item.id, item]));
  const enrichedItems = items.map((item) => {
    const responsavel = item.responsavelId ? responsaveisMap.get(item.responsavelId) : null;
    return {
      ...item,
      responsavelNome: responsavel?.nome || null,
      responsavelEmail: responsavel?.emailLogin || null,
      responsavelAuthLinked: Boolean(responsavel?.authLinked),
    };
  });

  return {
    items: enrichedItems,
    template,
    responsaveis,
  };
}

async function assertResponsavelExists(responsavelId: string | null): Promise<void> {
  const normalizedResponsavelId = normalizeText(responsavelId);
  if (!normalizedResponsavelId) return;
  const responsaveis = await listResponsaveisForVinculo().catch(() => []);
  const exists = responsaveis.some((item) => item.id === normalizedResponsavelId);
  if (!exists) {
    throw new RamalValidationError(400, "RAMAL_RESPONSAVEL_NOT_FOUND", "Responsavel selecionado nao encontrado.");
  }
}

async function assertActiveResponsavelUniqueness(input: {
  responsavelId: string | null;
  status: StatusIntegracao;
  ignoreIntegrationId?: string;
}): Promise<void> {
  const responsavelId = normalizeText(input.responsavelId);
  if (!responsavelId) return;
  if (input.status !== "ativo") return;

  const integrations = await listApi4ComIntegracoes();
  const conflict = integrations.find((item) => {
    if (normalizeText(item.id) === normalizeText(input.ignoreIntegrationId)) return false;
    return normalizeText(item.responsavelId) === responsavelId && normalizeStatus(item.status) === "ativo";
  });

  if (conflict) {
    throw new RamalValidationError(
      409,
      "RAMAL_RESPONSAVEL_ACTIVE_CONFLICT",
      "Este Responsavel ja possui um ramal ativo vinculado.",
    );
  }
}

function normalizeOptionalResponsavelId(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized || null;
}

export async function GET() {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  try {
    const { items, template, responsaveis } = await buildRamaisPayload();
    return NextResponse.json({
      success: true,
      items,
      template,
      responsaveis,
    });
  } catch {
    return NextResponse.json(
      { success: false, error: "Nao foi possivel carregar os ramais da API4COM." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  try {
    const body = (await request.json()) as CreateRamalPayload;
    const ramal = normalizeText(body.ramal);
    if (!ramal) {
      return NextResponse.json(
        { success: false, error: "Informe o ramal para cadastrar a integracao." },
        { status: 400 },
      );
    }

    const template = await getApi4ComIntegracaoTemplate();
    const tokenInput = normalizeText(body.token);
    const gatewayInput = normalizeText(body.gateway);
    const hasToken = Boolean(tokenInput) || template.hasToken;
    const hasGateway = Boolean(gatewayInput) || Boolean(template.gateway);

    if (!hasToken) {
      return NextResponse.json(
        { success: false, error: "Informe o token da API4COM para cadastrar o ramal." },
        { status: 400 },
      );
    }

    if (!hasGateway) {
      return NextResponse.json(
        { success: false, error: "Informe o gateway da API4COM para cadastrar o ramal." },
        { status: 400 },
      );
    }

    const responsavelId = normalizeOptionalResponsavelId(body.responsavelId);
    const status = normalizeStatus(body.status, "inativo");
    await assertResponsavelExists(responsavelId);
    await assertActiveResponsavelUniqueness({
      responsavelId,
      status,
    });

    await createApi4ComIntegracao({
      nome: normalizeText(body.nome) || `API4COM - Ramal ${ramal}`,
      ramal,
      gateway: gatewayInput || undefined,
      token: tokenInput || undefined,
      status,
      responsavelId,
      baseIntegrationId: body.baseIntegrationId || template.baseIntegrationId,
      setAsPrimary: Boolean(body.setAsPrimary),
    });

    const { items, template: nextTemplate, responsaveis } = await buildRamaisPayload();
    return NextResponse.json({
      success: true,
      message: "Novo ramal cadastrado com sucesso.",
      items,
      template: nextTemplate,
      responsaveis,
    });
  } catch (error) {
    if (error instanceof RamalValidationError || error instanceof ResponsavelByAuthError) {
      return NextResponse.json(
        { success: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { success: false, error: "Nao foi possivel cadastrar o novo ramal da API4COM." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  try {
    const body = (await request.json()) as UpdateRamalPayload;
    const id = normalizeText(body.id);
    if (!id) {
      return NextResponse.json(
        { success: false, error: "Informe o id do ramal para editar." },
        { status: 400 },
      );
    }

    const current = await getApi4ComIntegracaoById(id);
    if (!current) {
      return NextResponse.json(
        { success: false, error: "Ramal nao encontrado." },
        { status: 404 },
      );
    }

    const ramalInput = body.ramal !== undefined ? normalizeText(body.ramal) : undefined;
    if (body.ramal !== undefined && !ramalInput) {
      return NextResponse.json(
        { success: false, error: "Informe um ramal valido para salvar." },
        { status: 400 },
      );
    }

    const gatewayInput = body.gateway !== undefined ? normalizeText(body.gateway) : undefined;
    const tokenInput = body.token !== undefined ? normalizeText(body.token) : undefined;

    const nextGateway = gatewayInput !== undefined ? gatewayInput : normalizeText(current.gateway);
    const nextToken = tokenInput !== undefined && tokenInput ? tokenInput : normalizeText(current.token);

    if (!nextToken) {
      return NextResponse.json(
        { success: false, error: "O token da API4COM nao pode ficar vazio." },
        { status: 400 },
      );
    }

    if (!nextGateway) {
      return NextResponse.json(
        { success: false, error: "O gateway da API4COM nao pode ficar vazio." },
        { status: 400 },
      );
    }

    const responsavelId =
      body.responsavelId === undefined
        ? normalizeOptionalResponsavelId(current.responsavelId)
        : normalizeOptionalResponsavelId(body.responsavelId);
    const status = body.status === undefined ? normalizeStatus(current.status) : normalizeStatus(body.status);

    await assertResponsavelExists(responsavelId);
    await assertActiveResponsavelUniqueness({
      responsavelId,
      status,
      ignoreIntegrationId: id,
    });

    const updated = await updateApi4ComIntegracao({
      id,
      nome: body.nome,
      ramal: ramalInput,
      gateway: gatewayInput,
      token: tokenInput,
      status,
      responsavelId,
      setAsPrimary: Boolean(body.setAsPrimary),
    });

    if (!updated) {
      return NextResponse.json(
        { success: false, error: "Ramal nao encontrado para atualizacao." },
        { status: 404 },
      );
    }

    const { items, template, responsaveis } = await buildRamaisPayload();
    return NextResponse.json({
      success: true,
      message: "Ramal atualizado com sucesso.",
      items,
      template,
      responsaveis,
    });
  } catch (error) {
    if (error instanceof RamalValidationError || error instanceof ResponsavelByAuthError) {
      return NextResponse.json(
        { success: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { success: false, error: "Nao foi possivel atualizar o ramal da API4COM." },
      { status: 500 },
    );
  }
}
