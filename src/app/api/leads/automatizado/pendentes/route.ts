import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { consumePendingAutomatedLeads } from "@/lib/leads-automatizado-store";
import { Lead } from "@/types/crm";

type PendentesResponse = {
  success: boolean;
  leads?: Lead[];
  count?: number;
  message?: string;
};

export async function GET(): Promise<NextResponse> {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  try {
    const entries = await consumePendingAutomatedLeads();
    const leads: Lead[] = entries.flatMap((entry) => entry.leads);

    return NextResponse.json<PendentesResponse>({ success: true, leads, count: leads.length });
  } catch (error) {
    console.error(
      "[LEADS_AUTOMATIZADO][PENDENTES] Erro:",
      error instanceof Error ? error.message : "Erro desconhecido",
    );
    return NextResponse.json<PendentesResponse>(
      { success: false, message: "Nao foi possivel buscar leads pendentes." },
      { status: 500 },
    );
  }
}
