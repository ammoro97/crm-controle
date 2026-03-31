import { NextResponse } from "next/server";
import { getCallLogs } from "@/lib/calls-store";
import { requireAuth } from "@/lib/require-auth";

export async function GET() {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

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
  } catch {
    return NextResponse.json(
      { success: false, message: "Nao foi possivel carregar ligacoes." },
      { status: 500 },
    );
  }
}
