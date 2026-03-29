import { NextResponse } from "next/server";
import { getCallLogs } from "@/lib/calls-store";

export async function GET() {
  try {
    const calls = await getCallLogs();
    const ordered = [...calls].sort((a, b) => {
      const first = a.startedAt || a.createdAt;
      const second = b.startedAt || b.createdAt;
      return second.localeCompare(first);
    });

    console.log("[POSTCALL_DEBUG][API_LIGACOES] GET /api/ligacoes", {
      total: ordered.length,
      latest: ordered[0]
        ? {
            id: ordered[0].id,
            leadId: ordered[0].leadId,
            status: ordered[0].status,
            eventType: ordered[0].eventType,
            startedAt: ordered[0].startedAt,
            endedAt: ordered[0].endedAt,
            durationSeconds: ordered[0].durationSeconds,
            telefone: ordered[0].telefone,
          }
        : null,
    });

    return NextResponse.json({
      success: true,
      calls: ordered,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: "Nao foi possivel carregar ligacoes.",
        detail: error instanceof Error ? error.message : "Erro desconhecido",
      },
      { status: 500 },
    );
  }
}
