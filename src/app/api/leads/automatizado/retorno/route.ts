import { NextResponse } from "next/server";
import { savePendingAutomatedLeads } from "@/lib/leads-automatizado-store";
import { Lead } from "@/types/crm";

type N8nLeadItem = {
  name?: string;
  nome?: string;
  company?: string;
  empresa?: string;
  phone?: string;
  telefone?: string;
  email?: string;
  city?: string;
  cidade?: string;
  niche?: string;
  nicho?: string;
  [key: string]: unknown;
};

type RetornoBody = {
  requestId?: string;
  tipoAutomacao?: "api" | "cnpj";
  leads?: N8nLeadItem[];
  data?: N8nLeadItem[];
  [key: string]: unknown;
};

function buildOutboundLead(raw: N8nLeadItem, tipoAutomacao: "api" | "cnpj"): Lead | null {
  const name = String(raw.name || raw.nome || "").trim();
  const company = String(raw.company || raw.empresa || "").trim();
  if (!name && !company) return null;

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const sourceLabel = tipoAutomacao === "api" ? "Automacao por API" : "Automacao por CNPJ";
  const id = `L-AUTO-${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`;

  return {
    id,
    name: name || company,
    names: name ? [name] : [],
    company,
    phone: String(raw.phone || raw.telefone || "").trim(),
    phones: [],
    email: String(raw.email || "").trim(),
    emails: [],
    status: "Novo",
    source: sourceLabel,
    owner: "",
    notes: "",
    channel: "outbound",
    city: String(raw.city || raw.cidade || "").trim(),
    niche: String(raw.niche || raw.nicho || "").trim(),
    entryDate: dateStr,
    firstContactDate: "",
    lastInteraction: "",
    nextAction: "",
    nextActionDate: "",
    lossReason: "",
    temperature: "frio",
    history: [
      {
        id: `H-AUTO-${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
        date: dateStr,
        time: timeStr,
        eventType: "LEAD_CRIADO",
        description: `Lead criado via ${sourceLabel}. Canal: outbound.`,
        owner: "Automacao",
      },
    ],
    internalNotes: [],
    observationLog: [],
    outboundQualification: {
      decisionContacts: [{ name: "", phone: "", email: "" }],
      whoAnswered: "",
      attemptCount: "1",
      businessType: "estetica",
      specialty: "",
      monthlyRevenueRange: "Ate R$ 50k/mensal",
      averageLeadsPerMonth: "",
      employeeCountRange: "1-5",
      unitCount: "1",
      painPoints: [],
      mainProblem: "",
      usesCrm: "nao",
      crmName: "",
      usesDigitalSchedule: "nao",
      usesSpreadsheet: "nao",
      usesNothing: "sim",
      decisionMakerIdentified: "nao",
      buyingMoment: "pesquisando",
      icpFit: "medio",
      teamSize: "",
    },
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as RetornoBody;
    const tipoAutomacao: "api" | "cnpj" = body.tipoAutomacao === "cnpj" ? "cnpj" : "api";

    const rawLeads: N8nLeadItem[] = Array.isArray(body.leads)
      ? body.leads
      : Array.isArray(body.data)
        ? body.data
        : [];

    const leads: Lead[] = rawLeads
      .map((raw) => buildOutboundLead(raw, tipoAutomacao))
      .filter((lead): lead is Lead => lead !== null);

    if (leads.length === 0) {
      return NextResponse.json(
        { success: false, message: "Nenhum lead valido encontrado no retorno." },
        { status: 400 },
      );
    }

    await savePendingAutomatedLeads({
      requestId: String(body.requestId || `RET-${Date.now()}`),
      tipoAutomacao,
      leads,
      savedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, count: leads.length });
  } catch (error) {
    console.error(
      "[LEADS_AUTOMATIZADO][RETORNO] Erro:",
      error instanceof Error ? error.message : "Erro desconhecido",
    );
    return NextResponse.json(
      { success: false, message: "Nao foi possivel processar o retorno." },
      { status: 500 },
    );
  }
}
