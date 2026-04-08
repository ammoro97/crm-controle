import { NextResponse } from "next/server";
import { getApi4ComConfig, toPublicApi4ComConfig } from "@/lib/api4com-config-store";
import { requireAuth } from "@/lib/require-auth";

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
  void request;
  return NextResponse.json(
    {
      success: false,
      error: "Endpoint legado desativado. Use /api/integrations/api4com/ramais.",
      code: "API4_LEGACY_ENDPOINT_DISABLED",
    },
    { status: 410 },
  );
}
