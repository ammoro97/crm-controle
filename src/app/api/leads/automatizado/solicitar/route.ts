import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { Lead } from "@/types/crm";

export type SolicitacaoApiPayload = {
  tipoAutomacao: "api";
  totalLeads: number;
  nicho: string;
  pais: "Brasil";
  estado?: string;
  cidade?: string;
};

export type SolicitacaoCnpjPayload = {
  tipoAutomacao: "cnpj";
  cnae: string;
  cidade?: string;
  estado?: string;
  anos?: number;
  quantidade: number;
};

export type SolicitacaoPayload = SolicitacaoApiPayload | SolicitacaoCnpjPayload;

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

type N8nRetornoBody = {
  leads?: N8nLeadItem[];
  data?: N8nLeadItem[];
  [key: string]: unknown;
};

export type SolicitacaoResponse = {
  success: boolean;
  leads?: Lead[];
  count?: number;
  message?: string;
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
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  try {
    const body = (await request.json()) as SolicitacaoPayload;

    if (!body.tipoAutomacao || !["api", "cnpj"].includes(body.tipoAutomacao)) {
      return NextResponse.json<SolicitacaoResponse>(
        { success: false, message: "Tipo de automacao invalido." },
        { status: 400 },
      );
    }

    if (body.tipoAutomacao === "api") {
      if (!body.totalLeads || body.totalLeads <= 0) {
        return NextResponse.json<SolicitacaoResponse>(
          { success: false, message: "Total de leads obrigatorio e deve ser maior que zero." },
          { status: 400 },
        );
      }
      if (!body.nicho?.trim()) {
        return NextResponse.json<SolicitacaoResponse>(
          { success: false, message: "Nicho obrigatorio para automacao por API." },
          { status: 400 },
        );
      }
    }

    if (body.tipoAutomacao === "cnpj") {
      if (!body.cnae?.trim()) {
        return NextResponse.json<SolicitacaoResponse>(
          { success: false, message: "CNAE obrigatorio para automacao por CNPJ." },
          { status: 400 },
        );
      }
      if (!body.quantidade || body.quantidade <= 0) {
        return NextResponse.json<SolicitacaoResponse>(
          { success: false, message: "Quantidade obrigatoria e deve ser maior que zero." },
          { status: 400 },
        );
      }
    }

    const webhookUrl = String(
      process.env.N8N_WEBHOOK_URL || process.env.N8N_WEBHOOK_SOLICITAR_URL || "",
    ).trim();

    if (!webhookUrl) {
      return NextResponse.json<SolicitacaoResponse>(
        { success: false, message: "URL do webhook de automacao nao configurada. Verifique as variaveis de ambiente." },
        { status: 500 },
      );
    }

    const n8nResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!n8nResponse.ok) {
      return NextResponse.json<SolicitacaoResponse>(
        { success: false, message: `Erro ao chamar automacao externa (HTTP ${n8nResponse.status}). Tente novamente.` },
        { status: 502 },
      );
    }

    const n8nData = (await n8nResponse.json()) as N8nRetornoBody | N8nLeadItem[];
    const rawLeads: N8nLeadItem[] = Array.isArray(n8nData)
      ? (n8nData as N8nLeadItem[])
      : Array.isArray((n8nData as N8nRetornoBody).leads)
        ? ((n8nData as N8nRetornoBody).leads as N8nLeadItem[])
        : Array.isArray((n8nData as N8nRetornoBody).data)
          ? ((n8nData as N8nRetornoBody).data as N8nLeadItem[])
          : [];

    const leads: Lead[] = rawLeads
      .map((raw) => buildOutboundLead(raw, body.tipoAutomacao))
      .filter((lead): lead is Lead => lead !== null);

    return NextResponse.json<SolicitacaoResponse>({ success: true, leads, count: leads.length });
  } catch (error) {
    console.error(
      "[LEADS_AUTOMATIZADO][SOLICITAR] Erro:",
      error instanceof Error ? error.message : "Erro desconhecido",
    );
    return NextResponse.json<SolicitacaoResponse>(
      { success: false, message: "Nao foi possivel processar a solicitacao." },
      { status: 500 },
    );
  }
}
