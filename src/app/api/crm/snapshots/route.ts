import { NextRequest, NextResponse } from "next/server";
import { readDataFile, writeDataFile } from "@/lib/storage-paths";
import {
  archiveLeadsToHistory,
  deleteCustomersFromCollection,
  deleteLeadsFromCollection,
  LeadArchiveEntry,
  readCustomersCollection,
  readLeadsCollection,
  readLeadsPage,
  writeCustomersCollection,
  writeLeadsCollection,
} from "@/lib/leads-customers-store";
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

const LEADS_PAGE_SIZE = 50;
const MAX_SNAPSHOT_ITEMS = 5000;
const MAX_DELETED_IDS = 5000;

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_GET_PER_WINDOW = 400;
const RATE_LIMIT_POST_PER_WINDOW = 200;

type RateCounter = {
  windowStart: number;
  count: number;
};

const rateCounters = new Map<string, RateCounter>();

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasNonEmptyId(value: unknown): value is { id: string } {
  if (!isObjectRecord(value)) return false;
  return typeof value.id === "string" && value.id.trim().length > 0;
}

function isLeadLike(value: unknown): value is Lead {
  return hasNonEmptyId(value);
}

function isMeetingLike(value: unknown): value is Meeting {
  return hasNonEmptyId(value);
}

function isLeadFinalizationLike(value: unknown): value is LeadFinalizationRecord {
  if (!hasNonEmptyId(value)) return false;
  if (!isObjectRecord(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.leadId === "string" && candidate.leadId.trim().length > 0;
}

function isWrapupLike(value: unknown): value is PostCallWrapup {
  return hasNonEmptyId(value);
}

function isLeadArchiveEntryLike(value: unknown): value is LeadArchiveEntry {
  if (!isObjectRecord(value)) return false;
  if (!isObjectRecord(value.lead) || typeof value.lead.id !== "string" || value.lead.id.trim().length === 0) {
    return false;
  }
  if (typeof value.finalizadoEm !== "string" || value.finalizadoEm.trim().length === 0) return false;
  if (typeof value.motivo !== "string" || value.motivo.trim().length === 0) return false;
  if (value.meetings !== undefined && !Array.isArray(value.meetings)) return false;
  return true;
}

function parseOptionalArray<T>(
  value: unknown,
  fieldName: string,
  validator: (item: unknown) => item is T,
  maxItems = MAX_SNAPSHOT_ITEMS,
): { ok: true; value: T[] | undefined } | { ok: false; message: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(value)) {
    return { ok: false, message: `Campo '${fieldName}' deve ser um array.` };
  }
  if (value.length > maxItems) {
    return { ok: false, message: `Campo '${fieldName}' excede o limite de ${maxItems} itens.` };
  }
  for (const item of value) {
    if (!validator(item)) {
      return { ok: false, message: `Campo '${fieldName}' contem item invalido.` };
    }
  }
  return { ok: true, value };
}

function parseOptionalStringIds(
  value: unknown,
  fieldName: string,
): { ok: true; value: string[] | undefined } | { ok: false; message: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(value)) {
    return { ok: false, message: `Campo '${fieldName}' deve ser um array.` };
  }
  if (value.length > MAX_DELETED_IDS) {
    return { ok: false, message: `Campo '${fieldName}' excede o limite de ${MAX_DELETED_IDS} itens.` };
  }

  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      return { ok: false, message: `Campo '${fieldName}' contem item invalido.` };
    }
    const trimmed = item.trim();
    if (!trimmed) continue;
    ids.push(trimmed);
  }
  return { ok: true, value: ids };
}

function parseSnapshotPayload(input: unknown):
  | { ok: true; payload: SnapshotPayload }
  | { ok: false; message: string } {
  if (!isObjectRecord(input)) {
    return { ok: false, message: "Payload invalido: esperado objeto JSON." };
  }

  const allowedKeys = new Set([
    "leads",
    "meetings",
    "customers",
    "leadFinalizations",
    "wrapups",
    "deletedLeadIds",
    "deletedCustomerIds",
    "archivedLeads",
  ]);

  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      return { ok: false, message: `Campo nao permitido no payload: '${key}'.` };
    }
  }

  const leads = parseOptionalArray(input.leads, "leads", isLeadLike);
  if (!leads.ok) return leads;

  const meetings = parseOptionalArray(input.meetings, "meetings", isMeetingLike);
  if (!meetings.ok) return meetings;

  const customers = parseOptionalArray(input.customers, "customers", isLeadLike);
  if (!customers.ok) return customers;

  const leadFinalizations = parseOptionalArray(
    input.leadFinalizations,
    "leadFinalizations",
    isLeadFinalizationLike,
  );
  if (!leadFinalizations.ok) return leadFinalizations;

  const wrapups = parseOptionalArray(input.wrapups, "wrapups", isWrapupLike);
  if (!wrapups.ok) return wrapups;

  const deletedLeadIds = parseOptionalStringIds(input.deletedLeadIds, "deletedLeadIds");
  if (!deletedLeadIds.ok) return deletedLeadIds;

  const deletedCustomerIds = parseOptionalStringIds(input.deletedCustomerIds, "deletedCustomerIds");
  if (!deletedCustomerIds.ok) return deletedCustomerIds;

  const archivedLeads = parseOptionalArray(input.archivedLeads, "archivedLeads", isLeadArchiveEntryLike);
  if (!archivedLeads.ok) return archivedLeads;

  return {
    ok: true,
    payload: {
      ...(leads.value !== undefined ? { leads: leads.value } : {}),
      ...(meetings.value !== undefined ? { meetings: meetings.value } : {}),
      ...(customers.value !== undefined ? { customers: customers.value } : {}),
      ...(leadFinalizations.value !== undefined ? { leadFinalizations: leadFinalizations.value } : {}),
      ...(wrapups.value !== undefined ? { wrapups: wrapups.value } : {}),
      ...(deletedLeadIds.value !== undefined ? { deletedLeadIds: deletedLeadIds.value } : {}),
      ...(deletedCustomerIds.value !== undefined ? { deletedCustomerIds: deletedCustomerIds.value } : {}),
      ...(archivedLeads.value !== undefined ? { archivedLeads: archivedLeads.value } : {}),
    },
  };
}

function consumeRateLimit(bucketKey: string, maxPerWindow: number): boolean {
  const now = Date.now();
  const windowStart = now - (now % RATE_LIMIT_WINDOW_MS);
  const current = rateCounters.get(bucketKey);

  if (!current || current.windowStart !== windowStart) {
    rateCounters.set(bucketKey, { windowStart, count: 1 });
    return true;
  }

  if (current.count >= maxPerWindow) {
    return false;
  }

  current.count += 1;

  if (rateCounters.size > 5_000) {
    for (const [key, bucket] of rateCounters.entries()) {
      if (windowStart - bucket.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
        rateCounters.delete(key);
      }
    }
  }

  return true;
}

function parsePageParam(request: NextRequest): number {
  const raw = request.nextUrl.searchParams.get("page") ?? "0";
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  const allowed = consumeRateLimit(`crm-snapshots:get:${auth.userId}`, RATE_LIMIT_GET_PER_WINDOW);
  if (!allowed) {
    return NextResponse.json(
      { success: false, message: "Limite de requisicoes excedido. Tente novamente em instantes." },
      { status: 429 },
    );
  }

  const page = parsePageParam(request);
  const isFirstPage = page === 0;

  try {
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
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: "Nao foi possivel carregar snapshots do CRM.",
        details: error instanceof Error ? error.message : "erro_desconhecido",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  const allowed = consumeRateLimit(`crm-snapshots:post:${auth.userId}`, RATE_LIMIT_POST_PER_WINDOW);
  if (!allowed) {
    return NextResponse.json(
      { success: false, message: "Limite de requisicoes excedido. Tente novamente em instantes." },
      { status: 429 },
    );
  }

  try {
    const rawBody: unknown = await request.json();
    const parsedPayload = parseSnapshotPayload(rawBody);
    if (!parsedPayload.ok) {
      return NextResponse.json(
        { success: false, message: parsedPayload.message },
        { status: 400 },
      );
    }

    const body = parsedPayload.payload;
    const writes: Promise<void>[] = [];

    const leads = body.leads;
    if (leads) {
      const currentLeads = await readLeadsCollection();
      if (leads.length === 0 && currentLeads.length > 0) {
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

      const distributedLeads = await distributeLeadOwnersFromDatabase({
        incomingLeads: leads,
        existingLeads: currentLeads,
      });

      writes.push(writeLeadsCollection(distributedLeads.leads));
    }

    const meetings = body.meetings;
    if (meetings) {
      writes.push(writeDataFile(MEETINGS_FILE, meetings));
    }

    const customers = body.customers;
    if (customers) {
      writes.push(writeCustomersCollection(customers));
    }

    const archivedLeads = body.archivedLeads ?? [];
    if (archivedLeads.length > 0) {
      await archiveLeadsToHistory(archivedLeads);
    }

    const deletedLeadIds = body.deletedLeadIds ?? [];
    if (deletedLeadIds.length > 0) {
      writes.push(deleteLeadsFromCollection(deletedLeadIds));
    }

    const deletedCustomerIds = body.deletedCustomerIds ?? [];
    if (deletedCustomerIds.length > 0) {
      writes.push(deleteCustomersFromCollection(deletedCustomerIds));
    }

    const leadFinalizations = body.leadFinalizations;
    if (leadFinalizations) {
      writes.push(writeDataFile(LEAD_FINALIZATIONS_FILE, leadFinalizations));
    }

    const wrapups = body.wrapups;
    if (wrapups) {
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
      {
        success: false,
        message: "Nao foi possivel salvar snapshots do CRM.",
        details: error instanceof Error ? error.message : "erro_desconhecido",
      },
      { status: 500 },
    );
  }
}
