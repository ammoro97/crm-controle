import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { getActiveAutomatedImport } from "@/lib/leads-automatizado-store";

type StatusResponse = {
  success: boolean;
  active: boolean;
  importacao?: {
    requestId: string;
    tipoAutomacao: "api" | "cnpj";
    createdAt: string;
    updatedAt: string;
  };
};

export async function GET(): Promise<NextResponse> {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  try {
    const activeImport = await getActiveAutomatedImport();
    if (!activeImport) {
      return NextResponse.json<StatusResponse>({ success: true, active: false });
    }

    return NextResponse.json<StatusResponse>({
      success: true,
      active: true,
      importacao: {
        requestId: activeImport.requestId,
        tipoAutomacao: activeImport.tipoAutomacao,
        createdAt: activeImport.createdAt,
        updatedAt: activeImport.updatedAt,
      },
    });
  } catch (error) {
    console.error(
      "[LEADS_AUTOMATIZADO][STATUS] Erro:",
      error instanceof Error ? error.message : "Erro desconhecido",
    );
    return NextResponse.json<StatusResponse>(
      { success: false, active: false },
      { status: 500 },
    );
  }
}
