import { NextRequest, NextResponse } from "next/server";
import { readDataFile, writeDataFile } from "@/lib/storage-paths";
import { readCustomersCollection, readLeadsCollection, writeCustomersCollection, writeLeadsCollection } from "@/lib/leads-customers-store";
import {
  LEAD_OWNER_DISTRIBUTION_NO_ELIGIBLE,
  LeadOwnerDistributionError,
} from "@/lib/lead-owner-distribution";
import { distributeLeadOwnersFromDatabase } from "@/lib/lead-owner-distribution-server";
import { requireAuth } from "@/lib/require-auth";
import type { Lead, LeadFinalizationRecord, Meeting } from "@/types/crm";
import type { PostCallWrapup } from "@/lib/post-call-flow";

type SnapshotPayload = {
  leads?: Lead[];
  meetings?: Meeting[];
  customers?: Lead[];
  leadFinalizations?: LeadFinalizationRecord[];
  wrapups?: PostCallWrapup[];
};

const MEETINGS_FILE = "crm.agenda.meetings.v1.json";
const LEAD_FINALIZATIONS_FILE = "crm.leads.finalizations.v1.json";
const WRAPUPS_FILE = "crm.calls.wrapups.v1.json";

function asArray<T>(value: unknown): T[] | null {
  return Array.isArray(value) ? (value as T[]) : null;
}

function normalizeText(value?: string | null) {
  return String(value || "").trim().toLocaleLowerCase("pt-BR");
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  try {
    const [leads, meetings, customers, leadFinalizations, wrapups] = await Promise.all([
      readLeadsCollection(),
      readDataFile<Meeting[]>(MEETINGS_FILE, []),
      readCustomersCollection(),
      readDataFile<LeadFinalizationRecord[]>(LEAD_FINALIZATIONS_FILE, []),
      readDataFile<PostCallWrapup[]>(WRAPUPS_FILE, []),
    ]);

    const ownerFilter = normalizeText(request.nextUrl.searchParams.get("responsavel"));
    const channelFilter = normalizeText(request.nextUrl.searchParams.get("canal"));

    const normalizedLeads = Array.isArray(leads) ? leads : [];
    const filteredLeads = normalizedLeads.filter((lead) => {
      if (ownerFilter && ownerFilter !== "todos" && normalizeText(lead.owner) !== ownerFilter) return false;
      if (channelFilter && channelFilter !== "todos" && normalizeText(lead.channel) !== channelFilter) return false;
      return true;
    });

    return NextResponse.json({
      success: true,
      snapshots: {
        leads: filteredLeads,
        meetings: Array.isArray(meetings) ? meetings : [],
        customers: Array.isArray(customers) ? customers : [],
        leadFinalizations: Array.isArray(leadFinalizations) ? leadFinalizations : [],
        wrapups: Array.isArray(wrapups) ? wrapups : [],
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Nao foi possivel carregar snapshots do CRM." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  try {
    const body = (await request.json()) as SnapshotPayload;
    const writes: Promise<void>[] = [];

    const leads = asArray<Lead>(body?.leads);
    if (leads) {
      const currentLeads = await readLeadsCollection();
      if (leads.length === 0) {
        if (currentLeads.length > 0) {
          return NextResponse.json(
            {
              success: false,
              message:
                "Bloqueado snapshot vazio de leads para evitar apagar crm_leads sem confirmacao explicita.",
              code: "LEADS_EMPTY_SNAPSHOT_BLOCKED",
            },
            { status: 409 },
          );
        }
      }

      const distributedLeads = await distributeLeadOwnersFromDatabase({
        incomingLeads: leads,
        existingLeads: currentLeads,
      });

      writes.push(writeLeadsCollection(distributedLeads.leads));
    }

    const meetings = asArray<Meeting>(body?.meetings);
    if (meetings) {
      writes.push(writeDataFile(MEETINGS_FILE, meetings));
    }

    const customers = asArray<Lead>(body?.customers);
    if (customers) {
      writes.push(writeCustomersCollection(customers));
    }

    const leadFinalizations = asArray<LeadFinalizationRecord>(body?.leadFinalizations);
    if (leadFinalizations) {
      writes.push(writeDataFile(LEAD_FINALIZATIONS_FILE, leadFinalizations));
    }

    const wrapups = asArray<PostCallWrapup>(body?.wrapups);
    if (wrapups) {
      writes.push(writeDataFile(WRAPUPS_FILE, wrapups));
    }

    if (writes.length === 0) {
      return NextResponse.json(
        { success: false, message: "Nenhum snapshot valido enviado para persistencia." },
        { status: 400 },
      );
    }

    await Promise.all(writes);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "LEADS_EMPTY_SNAPSHOT_BLOCKED") {
      return NextResponse.json(
        {
          success: false,
          message: "Bloqueado snapshot vazio de leads para evitar perda de dados.",
          code: "LEADS_EMPTY_SNAPSHOT_BLOCKED",
        },
        { status: 409 },
      );
    }
    if (
      error instanceof LeadOwnerDistributionError &&
      error.code === LEAD_OWNER_DISTRIBUTION_NO_ELIGIBLE
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Nao foi possivel salvar leads sem responsavel elegivel cadastrado. Cadastre ao menos um responsavel em Configuracoes.",
          code: LEAD_OWNER_DISTRIBUTION_NO_ELIGIBLE,
        },
        { status: 422 },
      );
    }
    return NextResponse.json(
      { success: false, message: "Nao foi possivel salvar snapshots do CRM." },
      { status: 500 },
    );
  }
}
