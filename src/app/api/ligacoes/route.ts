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

