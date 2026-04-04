import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { consumePendingAutomatedLeads } from "@/lib/leads-automatizado-store";
import { readLeadsCollection } from "@/lib/leads-customers-store";
import {
  LEAD_OWNER_DISTRIBUTION_NO_ELIGIBLE,
  LeadOwnerDistributionError,
} from "@/lib/lead-owner-distribution";
import { distributeLeadOwnersFromDatabase } from "@/lib/lead-owner-distribution-server";
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
    const incomingLeads: Lead[] = entries.flatMap((entry) => entry.leads);
    let leads = incomingLeads;

    if (incomingLeads.length > 0) {
      const currentLeads = await readLeadsCollection();
      const distributed = await distributeLeadOwnersFromDatabase({
        incomingLeads,
        existingLeads: currentLeads,
      });
      leads = distributed.leads;
    }

    return NextResponse.json<PendentesResponse>({ success: true, leads, count: leads.length });
  } catch (error) {
    if (
      error instanceof LeadOwnerDistributionError &&
      error.code === LEAD_OWNER_DISTRIBUTION_NO_ELIGIBLE
    ) {
      return NextResponse.json<PendentesResponse>(
        {
          success: false,
          message:
            "Nao existe responsavel elegivel cadastrado para distribuir os leads automatizados pendentes.",
        },
        { status: 422 },
      );
    }
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
