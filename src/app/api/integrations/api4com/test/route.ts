import { NextResponse } from "next/server";
import { getApi4ComConfig, getApi4ComIntegracaoById, toPublicApi4ComConfig, updateApi4ComConnectionStatus } from "@/lib/api4com-config-store";
import type { Api4ComConfig } from "@/lib/api4com-config-store";
import { requireAuth } from "@/lib/require-auth";

type TestPayload = {
  integrationId?: string;
};

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  try {
    const body = (await request.json().catch(() => ({}))) as TestPayload;
    const integrationId = String(body.integrationId || "").trim();
    let config = await getApi4ComConfig();

    if (integrationId) {
      const selected = await getApi4ComIntegracaoById(integrationId);
      if (!selected) {
        return NextResponse.json(
          {
            success: false,
            message: "Ramal nao encontrado para teste.",
          },
          { status: 404 },
        );
      }
      const selectedConfig: Api4ComConfig = {
        integrationId: selected.id,
        nome: selected.nome,
        token: selected.token || "",
        extension: selected.ramal,
        gateway: selected.gateway || "",
        status: selected.status,
        isConnected: selected.status === "ativo",
        responsavelId: selected.responsavelId,
        createdAt: selected.createdAt,
        updatedAt: selected.updatedAt,
      };
      config = selectedConfig;
    }

    if (!config.token.trim()) {
      return NextResponse.json(
        {
          success: false,
          message: "Nao foi possivel testar a conexao: token nao configurado.",
          config: toPublicApi4ComConfig(config),
        },
        { status: 400 },
      );
    }

    if (!config.extension.trim()) {
      return NextResponse.json(
        {
          success: false,
          message: "Nao foi possivel testar a conexao: ramal nao configurado.",
          config: toPublicApi4ComConfig(config),
        },
        { status: 400 },
      );
    }

    if (!config.gateway.trim()) {
      return NextResponse.json(
        {
          success: false,
          message: "Nao foi possivel testar a conexao: gateway nao configurado.",
          config: toPublicApi4ComConfig(config),
        },
        { status: 400 },
      );
    }

    const updated = await updateApi4ComConnectionStatus(true, config.integrationId || undefined);

    return NextResponse.json({
      success: true,
      message: "Conexao testada com sucesso.",
      config: toPublicApi4ComConfig(updated),
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Nao foi possivel testar a conexao." },
      { status: 500 },
    );
  }
}
