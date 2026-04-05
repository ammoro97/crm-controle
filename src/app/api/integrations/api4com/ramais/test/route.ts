import { NextResponse } from "next/server";
import {
  getApi4ComIntegracaoById,
  listPublicApi4ComIntegracoes,
  updateApi4ComIntegracaoStatus,
} from "@/lib/api4com-config-store";
import { requireAuth } from "@/lib/require-auth";

type TestRamalPayload = {
  id?: string;
};

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  try {
    const body = (await request.json()) as TestRamalPayload;
    const id = normalizeText(body.id);

    if (!id) {
      return NextResponse.json(
        { success: false, message: "Informe qual ramal deve ser testado." },
        { status: 400 },
      );
    }

    const target = await getApi4ComIntegracaoById(id);
    if (!target) {
      return NextResponse.json(
        { success: false, message: "Ramal nao encontrado." },
        { status: 404 },
      );
    }

    const hasToken = Boolean(normalizeText(target.token));
    const hasRamal = Boolean(normalizeText(target.ramal));
    const hasGateway = Boolean(normalizeText(target.gateway));

    if (!hasToken || !hasRamal || !hasGateway) {
      await updateApi4ComIntegracaoStatus(id, "erro");
      const items = await listPublicApi4ComIntegracoes();
      return NextResponse.json(
        {
          success: false,
          message: "Nao foi possivel testar: token, ramal e gateway sao obrigatorios.",
          items,
        },
        { status: 400 },
      );
    }

    await updateApi4ComIntegracaoStatus(id, "ativo");
    const items = await listPublicApi4ComIntegracoes();
    return NextResponse.json({
      success: true,
      message: "Conexao do ramal testada com sucesso.",
      items,
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Nao foi possivel testar o ramal da API4COM." },
      { status: 500 },
    );
  }
}
