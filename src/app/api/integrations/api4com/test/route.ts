import { NextResponse } from "next/server";
import { getApi4ComConfig, toPublicApi4ComConfig, updateApi4ComConnectionStatus } from "@/lib/api4com-config-store";
import { requireAuth } from "@/lib/require-auth";

export async function POST() {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  try {
    const config = await getApi4ComConfig();

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

    const updated = await updateApi4ComConnectionStatus(true);

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
