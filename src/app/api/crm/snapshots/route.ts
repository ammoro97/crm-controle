import { NextRequest, NextResponse } from "next/server";
import { readDataFile, writeDataFile } from "@/lib/storage-paths";
import { readCustomersCollection, readLeadsCollection, writeCustomersCollection, writeLeadsCollection } from "@/lib/leads-customers-store";
import { requireAuth } from "@/lib/require-auth";
import type { Lead, LeadFinalizationRecord, Meeting } from "@/types/crm";

type SnapshotPayload = {
  leads?: Lead[];
  meetings?: Meeting[];
  customers?: Lead[];
  leadFinalizations?: LeadFinalizationRecord[];
};

const MEETINGS_FILE = "crm.agenda.meetings.v1.json";
const LEAD_FINALIZATIONS_FILE = "crm.leads.finalizations.v1.json";

function asArray<T>(value: unknown): T[] | null {
  return Array.isArray(value) ? (value as T[]) : null;
}

export async function GET() {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  try {
    const [leads, meetings, customers, leadFinalizations] = await Promise.all([
      readLeadsCollection(),
      readDataFile<Meeting[]>(MEETINGS_FILE, []),
      readCustomersCollection(),
      readDataFile<LeadFinalizationRecord[]>(LEAD_FINALIZATIONS_FILE, []),
    ]);

    return NextResponse.json({
      success: true,
      snapshots: {
        leads: Array.isArray(leads) ? leads : [],
        meetings: Array.isArray(meetings) ? meetings : [],
        customers: Array.isArray(customers) ? customers : [],
        leadFinalizations: Array.isArray(leadFinalizations) ? leadFinalizations : [],
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
      writes.push(writeLeadsCollection(leads));
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

    if (writes.length === 0) {
      return NextResponse.json(
        { success: false, message: "Nenhum snapshot valido enviado para persistencia." },
        { status: 400 },
      );
    }

    await Promise.all(writes);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { success: false, message: "Nao foi possivel salvar snapshots do CRM." },
      { status: 500 },
    );
  }
}
