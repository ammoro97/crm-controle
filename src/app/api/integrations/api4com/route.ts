import { NextResponse } from "next/server";
import { getApi4ComConfig, saveApi4ComConfig, toPublicApi4ComConfig } from "@/lib/api4com-config-store";
import { requireAuth } from "@/lib/require-auth";

type SaveApi4ComPayload = {
  token?: string;
  extension?: string;
  gateway?: string;
};

export async function GET() {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  try {
    const config = await getApi4ComConfig();
    return NextResponse.json({
      success: true,
      config: toPublicApi4ComConfig(config),
    });
  } catch {
    return NextResponse.json(
      { success: false, error: "Nao foi possivel carregar configuracoes da API4COM." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  try {
    const body = (await request.json()) as SaveApi4ComPayload;
    const extension = (body.extension || "").trim();
    const gateway = (body.gateway || "").trim();
    const tokenInput = typeof body.token === "string" ? body.token.trim() : undefined;

    if (!extension) {
      return NextResponse.json(
        { success: false, error: "Informe o ramal para salvar a configuracao." },
        { status: 400 },
      );
    }

    if (!gateway) {
      return NextResponse.json(
        { success: false, error: "Informe o gateway para salvar a configuracao." },
        { status: 400 },
      );
    }

    const current = await getApi4ComConfig();
    const hasStoredToken = Boolean(current.token.trim());
    const hasIncomingToken = Boolean(tokenInput && tokenInput.length > 0);

    if (!hasStoredToken && !hasIncomingToken) {
      return NextResponse.json(
        { success: false, error: "Informe o token da API4COM para continuar." },
        { status: 400 },
      );
    }

    const next = await saveApi4ComConfig({
      extension,
      gateway,
      token: hasIncomingToken ? tokenInput : undefined,
    });

    return NextResponse.json({
      success: true,
      message: "Credenciais salvas com sucesso.",
      config: toPublicApi4ComConfig(next),
    });
  } catch {
    return NextResponse.json(
      { success: false, error: "Falha ao salvar configuracao da API4COM." },
      { status: 500 },
    );
  }
}
