import { NextResponse } from "next/server";
import { savePendingAutomatedLeads } from "@/lib/leads-automatizado-store";
import { Lead } from "@/types/crm";

export type OutboundLeadPayload = {
  empresa: string;
  responsavel?: string | null;
  telefone?: string | null;
  email?: string | null;
  site?: string | null;
  expediente?: "Aberto" | "Fechado" | "Indefinido" | string | null;
  nota?: number | string | null;
  avaliacoes?: number | string | null;
  cidade?: string | null;
  estado?: string | null;
  dataCadastro?: string | null;
  origem?: string | null;
  horario_funcionamento?: string | null;
  // backward-compat aliases
  name?: string;
  nome?: string;
  company?: string;
  phone?: string;
  telefone_alt?: string;
  city?: string;
  niche?: string;
  nicho?: string;
  [key: string]: unknown;
};

type RetornoBody = {
  requestId?: string;
  tipoAutomacao?: "api" | "cnpj";
  leads?: OutboundLeadPayload[];
  data?: OutboundLeadPayload[];
  [key: string]: unknown;
};

function normalizeExpediente(value?: string | null): "Aberto" | "Fechado" | "Indefinido" {
  if (!value) return "Indefinido";
  const v = value.trim().toLowerCase();
  if (v === "aberto" || v === "open" || v === "aberto agora") return "Aberto";
  if (v === "fechado" || v === "closed" || v === "fechado agora") return "Fechado";
  if (v.startsWith("aberto")) return "Aberto";
  if (v.startsWith("fechado")) return "Fechado";
  return "Indefinido";
}

function buildCityField(cidade?: string | null, estado?: string | null): string {
  const c = String(cidade || "").trim();
  const s = String(estado || "").trim();
  if (c && s) return `${c} - ${s}`;
  return c || s || "";
}

function buildOutboundLead(raw: OutboundLeadPayload, tipoAutomacao: "api" | "cnpj"): Lead | null {
  // Support both new format (empresa/responsavel) and old format (name/company)
  const empresa = String(raw.empresa || raw.company || "").trim();
  const responsavel = String(raw.responsavel || raw.name || raw.nome || "").trim();
  if (!empresa && !responsavel) return null;

  const now = new Date();
  const dateStr = raw.dataCadastro
    ? String(raw.dataCadastro).trim().slice(0, 10)
    : now.toISOString().slice(0, 10);
  const timeStr = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  const origem = String(raw.origem || "").trim();
  const sourceLabel = origem || (tipoAutomacao === "api" ? "Automacao por API" : "Automacao por CNPJ");
  const id = `L-AUTO-${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`;

  return {
    id,
    name: responsavel || empresa,
    names: responsavel ? [responsavel] : [],
    company: empresa,
    phone: String(raw.telefone || raw.phone || "").trim(),
    phones: [],
    email: String(raw.email || "").trim(),
    emails: [],
    status: "Novo",
    source: sourceLabel,
    owner: "",
    notes: "",
    channel: "outbound",
    city: buildCityField(raw.cidade || raw.city, raw.estado),
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
    // Outbound-specific fields
    site: raw.site ? String(raw.site).trim() : null,
    nota: raw.nota != null ? raw.nota : null,
    avaliacoes: raw.avaliacoes != null ? raw.avaliacoes : null,
    horario_funcionamento: raw.horario_funcionamento ? String(raw.horario_funcionamento).trim() : null,
    expediente: normalizeExpediente(raw.expediente),
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

    const rawLeads: OutboundLeadPayload[] = Array.isArray(body.leads)
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
