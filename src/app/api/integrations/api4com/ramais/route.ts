import { NextResponse } from "next/server";
import {
  createApi4ComIntegracao,
  getApi4ComIntegracaoById,
  getApi4ComIntegracaoTemplate,
  listPublicApi4ComIntegracoes,
  updateApi4ComIntegracao,
} from "@/lib/api4com-config-store";
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

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

export async function GET() {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  try {
    const [items, template] = await Promise.all([listPublicApi4ComIntegracoes(), getApi4ComIntegracaoTemplate()]);
    return NextResponse.json({
      success: true,
      items,
      template,
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

    await createApi4ComIntegracao({
      nome: normalizeText(body.nome) || `API4COM - Ramal ${ramal}`,
      ramal,
      gateway: gatewayInput || undefined,
      token: tokenInput || undefined,
      status: body.status,
      responsavelId: body.responsavelId,
      baseIntegrationId: body.baseIntegrationId || template.baseIntegrationId,
      setAsPrimary: Boolean(body.setAsPrimary),
    });

    const [items, nextTemplate] = await Promise.all([listPublicApi4ComIntegracoes(), getApi4ComIntegracaoTemplate()]);
    return NextResponse.json({
      success: true,
      message: "Novo ramal cadastrado com sucesso.",
      items,
      template: nextTemplate,
    });
  } catch {
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

    await updateApi4ComIntegracao({
      id,
      nome: body.nome,
      ramal: ramalInput,
      gateway: gatewayInput,
      token: tokenInput,
      status: body.status,
      responsavelId: body.responsavelId,
      setAsPrimary: Boolean(body.setAsPrimary),
    });

    const [items, template] = await Promise.all([listPublicApi4ComIntegracoes(), getApi4ComIntegracaoTemplate()]);
    return NextResponse.json({
      success: true,
      message: "Ramal atualizado com sucesso.",
      items,
      template,
    });
  } catch {
    return NextResponse.json(
      { success: false, error: "Nao foi possivel atualizar o ramal da API4COM." },
      { status: 500 },
    );
  }
}
