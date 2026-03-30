import { NextResponse } from "next/server";
import { getCallAnalysisObservations } from "@/lib/call-analysis-store";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const leadIdFilter = String(searchParams.get("leadId") || "").trim();
    const callIdFilter = String(searchParams.get("callId") || "").trim();

    const rows = await getCallAnalysisObservations();
    const filtered = rows.filter((row) => {
      if (leadIdFilter && row.leadId !== leadIdFilter) return false;
      if (callIdFilter && row.callId !== callIdFilter) return false;
      return true;
    });

    return NextResponse.json({
      success: true,
      observations: filtered,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: "Nao foi possivel carregar observacoes de analise IA.",
        detail: error instanceof Error ? error.message : "Erro desconhecido",
      },
      { status: 500 },
    );
  }
}
