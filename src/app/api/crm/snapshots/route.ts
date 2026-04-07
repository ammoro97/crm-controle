import { NextRequest, NextResponse } from "next/server";
import { readDataFile, writeDataFile } from "@/lib/storage-paths";
import { archiveLeadsToHistory, deleteCustomersFromCollection, deleteLeadsFromCollection, LeadArchiveEntry, readCustomersCollection, readLeadsCollection, readLeadsPage, writeCustomersCollection, writeLeadsCollection } from "@/lib/leads-customers-store";
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
  deletedLeadIds?: string[];
  deletedCustomerIds?: string[];
  archivedLeads?: LeadArchiveEntry[];
};

const MEETINGS_FILE = "crm.agenda.meetings.v1.json";
const LEAD_FINALIZATIONS_FILE = "crm.leads.finalizations.v1.json";
const WRAPUPS_FILE = "crm.calls.wrapups.v1.json";

function asArray<T>(value: unknown): T[] | null {
  return Array.isArray(value) ? (value as T[]) : null;
}

function asStringIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim() !== "");
}

function asLeadArchiveEntries(value: unknown): LeadArchiveEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is LeadArchiveEntry =>
      typeof v === "object" && v !== null &&
      typeof (v as LeadArchiveEntry).finalizadoEm === "string" &&
      typeof (v as LeadArchiveEntry).motivo === "string" &&
      typeof (v as LeadArchiveEntry).lead === "object",
  );
}

function normalizeText(value?: string | null) {
  return String(value || "").trim().toLocaleLowerCase("pt-BR");
}

const LEADS_PAGE_SIZE = 50;

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  const page = Math.max(0, parseInt(request.nextUrl.searchParams.get("page") ?? "0", 10));
  const isFirstPage = page === 0;

  try {
    // Leads: paginados. Demais dados: apenas na primeira página (são menores, não precisam de paginação).
    const [leadsResult, meetings, customers, leadFinalizations, wrapups] = await Promise.all([
      readLeadsPage({ limit: LEADS_PAGE_SIZE, offset: page * LEADS_PAGE_SIZE }),
      isFirstPage ? readDataFile<Meeting[]>(MEETINGS_FILE, []) : Promise.resolve([]),
      isFirstPage ? readCustomersCollection() : Promise.resolve([]),
      isFirstPage ? readDataFile<LeadFinalizationRecord[]>(LEAD_FINALIZATIONS_FILE, []) : Promise.resolve([]),
      isFirstPage ? readDataFile<PostCallWrapup[]>(WRAPUPS_FILE, []) : Promise.resolve([]),
    ]);

    return NextResponse.json({
      success: true,
      snapshots: {
        leads: leadsResult.leads,
        meetings: Array.isArray(meetings) ? meetings : [],
        customers: Array.isArray(customers) ? customers : [],
        leadFinalizations: Array.isArray(leadFinalizations) ? leadFinalizations : [],
        wrapups: Array.isArray(wrapups) ? wrapups : [],
      },
      pagination: {
        page,
        pageSize: LEADS_PAGE_SIZE,
        hasMore: leadsResult.hasMore,
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

    // Leads arquivados: insert em leads_finalizados ANTES do delete (sequencial, não paralelo)
    const archivedLeads = asLeadArchiveEntries(body?.archivedLeads);
    if (archivedLeads.length > 0) {
      // Executa fora do Promise.all para garantir insert → delete sequencial
      await archiveLeadsToHistory(archivedLeads);
    }

    const deletedLeadIds = asStringIds(body?.deletedLeadIds);
    if (deletedLeadIds.length > 0) {
      writes.push(deleteLeadsFromCollection(deletedLeadIds));
    }

    const deletedCustomerIds = asStringIds(body?.deletedCustomerIds);
    if (deletedCustomerIds.length > 0) {
      writes.push(deleteCustomersFromCollection(deletedCustomerIds));
    }

    const leadFinalizations = asArray<LeadFinalizationRecord>(body?.leadFinalizations);
    if (leadFinalizations) {
      writes.push(writeDataFile(LEAD_FINALIZATIONS_FILE, leadFinalizations));
    }

    const wrapups = asArray<PostCallWrapup>(body?.wrapups);
    if (wrapups) {
      // Merge com existentes para nao sobrescrever wrapups de outros usuarios.
      const existing = await readDataFile<PostCallWrapup[]>(WRAPUPS_FILE, []);
      const existingArray = Array.isArray(existing) ? existing : [];
      const incomingIds = new Set(wrapups.map((w) => w.id));
      const preserved = existingArray.filter((w) => !incomingIds.has((w as PostCallWrapup).id));
      writes.push(writeDataFile(WRAPUPS_FILE, [...wrapups, ...preserved]));
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
