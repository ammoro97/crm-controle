import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";

type LogPerformancePayload = {
  origem: "analise_ligacoes";
  erro?: string;
  tempoRespostaMs?: number;
  etapa: "fetch_ligacoes" | "persistencia" | "renderizacao";
  created_at: string;
};

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  try {
    const body = (await request.json()) as LogPerformancePayload;

    const label = body.erro ? "ERROR" : body.tempoRespostaMs && body.tempoRespostaMs > 3000 ? "SLOW" : "INFO";
    console.warn(`[PERF_LOG] ${label}`, {
      origem: body.origem,
      etapa: body.etapa,
      tempoRespostaMs: body.tempoRespostaMs,
      erro: body.erro,
      created_at: body.created_at,
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false }, { status: 400 });
  }
}
