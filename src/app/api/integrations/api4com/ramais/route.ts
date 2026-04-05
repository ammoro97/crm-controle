import { NextResponse } from "next/server";
import {
  createApi4ComIntegracao,
  getApi4ComIntegracaoById,
  getApi4ComIntegracaoTemplate,
  listPublicApi4ComIntegracoes,
  updateApi4ComIntegracao,
} from "@/lib/api4com-config-store";
import { listAuthUsers } from "@/lib/auth/list-auth-users";
import {
  assignUserExtensionLink,
  clearUserExtensionLinkByRamal,
  getActiveUserExtensionLinkByRamal,
  listActiveUserExtensionLinks,
  UserExtensionLinkError,
} from "@/lib/ramais/user-extension-links";
import type { StatusIntegracao } from "@/types/integrations";
import { requireAuth } from "@/lib/require-auth";

type CreateRamalPayload = {
  nome?: string;
  ramal?: string;
  gateway?: string | null;
  token?: string | null;
  status?: StatusIntegracao;
  userId?: string | null;
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
  userId?: string | null;
  setAsPrimary?: boolean;
};

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

async function assertAuthUserExists(userId: string): Promise<void> {
  const normalized = normalizeText(userId);
  if (!normalized) return;
  const users = await listAuthUsers();
  const exists = users.some((user) => normalizeText(user.id) === normalized);
  if (!exists) {
    throw new UserExtensionLinkError(400, "USER_EXTENSION_USER_NOT_FOUND", "Usuario selecionado nao encontrado.");
  }
}

async function buildRamaisPayload() {
  const [items, template, users, links] = await Promise.all([
    listPublicApi4ComIntegracoes(),
    getApi4ComIntegracaoTemplate(),
    listAuthUsers(),
    listActiveUserExtensionLinks(),
  ]);

  const byRamal = new Map(links.map((item) => [item.ramal, item]));
  const usersById = new Map(users.map((user) => [user.id, user]));

  const enrichedItems = items.map((item) => {
    const link = byRamal.get(item.ramal);
    const linkedUser = link ? usersById.get(link.userId) : null;
    return {
      ...item,
      userId: link?.userId || null,
      userEmail: linkedUser?.email || null,
      userNome: linkedUser?.nome || null,
    };
  });

  return {
    items: enrichedItems,
    template,
    users,
  };
}

export async function GET() {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  try {
    const { items, template, users } = await buildRamaisPayload();
    return NextResponse.json({
      success: true,
      items,
      template,
      users,
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

    const created = await createApi4ComIntegracao({
      nome: normalizeText(body.nome) || `API4COM - Ramal ${ramal}`,
      ramal,
      gateway: gatewayInput || undefined,
      token: tokenInput || undefined,
      status: body.status,
      responsavelId: null,
      baseIntegrationId: body.baseIntegrationId || template.baseIntegrationId,
      setAsPrimary: Boolean(body.setAsPrimary),
    });

    const userId = normalizeText(body.userId);
    if (userId) {
      await assertAuthUserExists(userId);
      await assignUserExtensionLink({
        userId,
        ramal: created.ramal,
      });
    }

    const { items, template: nextTemplate, users } = await buildRamaisPayload();
    return NextResponse.json({
      success: true,
      message: "Novo ramal cadastrado com sucesso.",
      items,
      template: nextTemplate,
      users,
    });
  } catch (error) {
    if (error instanceof UserExtensionLinkError) {
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

    const currentRamal = normalizeText(current.ramal);
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

    const updated = await updateApi4ComIntegracao({
      id,
      nome: body.nome,
      ramal: ramalInput,
      gateway: gatewayInput,
      token: tokenInput,
      status: body.status,
      responsavelId: null,
      setAsPrimary: Boolean(body.setAsPrimary),
    });
    if (!updated) {
      return NextResponse.json(
        { success: false, error: "Ramal nao encontrado para atualizacao." },
        { status: 404 },
      );
    }

    const nextRamal = normalizeText(updated.ramal);
    const userId = body.userId === undefined ? undefined : normalizeText(body.userId);

    if (userId !== undefined) {
      if (userId) {
        await assertAuthUserExists(userId);
        const oldLink = currentRamal && currentRamal !== nextRamal
          ? await getActiveUserExtensionLinkByRamal(currentRamal)
          : null;
        if (oldLink && oldLink.userId === userId) {
          await clearUserExtensionLinkByRamal(currentRamal);
        }
        await assignUserExtensionLink({
          userId,
          ramal: nextRamal,
        });
      } else {
        await clearUserExtensionLinkByRamal(currentRamal);
        if (nextRamal !== currentRamal) {
          await clearUserExtensionLinkByRamal(nextRamal);
        }
      }
    }

    const { items, template, users } = await buildRamaisPayload();
    return NextResponse.json({
      success: true,
      message: "Ramal atualizado com sucesso.",
      items,
      template,
      users,
    });
  } catch (error) {
    if (error instanceof UserExtensionLinkError) {
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
