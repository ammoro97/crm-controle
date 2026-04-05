import { NextResponse } from "next/server";
import { savePendingAutomatedLeads } from "@/lib/leads-automatizado-store";
import {
  LEAD_OWNER_DISTRIBUTION_NO_ELIGIBLE,
  LeadOwnerDistributionError,
} from "@/lib/lead-owner-distribution";
import { distributeLeadOwnersFromDatabase } from "@/lib/lead-owner-distribution-server";
import { resolveLeadExpedienteStatusFromHorario } from "@/lib/lead-expediente";
import { readLeadsCollection } from "@/lib/leads-customers-store";
import { Lead } from "@/types/crm";

export type OutboundLeadPayload = {
  empresa?: string | null;
  nome?: string | null;       // alias para empresa quando nao ha responsavel separado
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
  horario_funcionamento?: unknown; // aceita string ou array de {dia, horario}
  // backward-compat aliases
  name?: string | null;
  company?: string | null;
  phone?: string | null;
  city?: string | null;
  niche?: string | null;
  nicho?: string | null;
  [key: string]: unknown;
};

type RetornoBody = {
  requestId?: string;
  tipoAutomacao?: "api" | "cnpj";
  leads?: OutboundLeadPayload[];
  data?: OutboundLeadPayload[];
  [key: string]: unknown;
};

type HorarioItem = { dia?: unknown; horario?: unknown };

function normalizeHorarioFuncionamento(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    const lines = value
      .map((item: HorarioItem) => {
        const dia = String(item?.dia || "").trim();
        const horario = String(item?.horario || "").trim();
        if (!dia && !horario) return null;
        if (!horario || horario.toLowerCase() === "closed") return `${dia}: Fechado`;
        return `${dia}: ${horario}`;
      })
      .filter((line): line is string => line !== null);
    return lines.length > 0 ? lines.join("\n") : null;
  }
  return null;
}

function buildCityField(cidade?: string | null, estado?: string | null): string {
  const c = String(cidade || "").trim();
  const s = String(estado || "").trim();
  if (c && s) return `${c} - ${s}`;
  return c || s || "";
}

function buildOutboundLead(raw: OutboundLeadPayload, tipoAutomacao: "api" | "cnpj"): Lead | null {
  // empresa: campo direto > company > nome (quando nao ha responsavel separado)
  const empresa = String(raw.empresa || raw.company || raw.nome || "").trim();
  // responsavel: campo direto > name (quando nome nao foi usado como empresa)
  const responsavel = String(raw.responsavel || raw.name || "").trim();
  if (!empresa && !responsavel) return null;

  const now = new Date();
  const dateStr = raw.dataCadastro
    ? String(raw.dataCadastro).trim().slice(0, 10)
    : now.toISOString().slice(0, 10);
  const timeStr = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  const origem = String(raw.origem || "").trim();
  const sourceLabel = origem || (tipoAutomacao === "api" ? "Automacao por API" : "Automacao por CNPJ");
  const id = `L-AUTO-${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`;
  const horarioFuncionamento = normalizeHorarioFuncionamento(raw.horario_funcionamento);

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
    site: raw.site ? String(raw.site).trim() : null,
    nota: raw.nota != null ? raw.nota : null,
    avaliacoes: raw.avaliacoes != null ? raw.avaliacoes : null,
    horario_funcionamento: horarioFuncionamento,
    expediente: resolveLeadExpedienteStatusFromHorario(horarioFuncionamento),
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
      jaUtilizaCrm: null,
      qualCrmUtiliza: "",
      quantoPagaCrm: "",
      fazTrafegoPago: null,
      quantidadeProfissionaisClinica: null,
      nomeDecisor: "",
      informacoesAdicionaisNegocio: "",
    },
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const raw = await request.json();

    // Aceita corpo como array direto [ {...}, {...} ] ou como objeto { leads: [...] }
    let tipoAutomacao: "api" | "cnpj" = "api";
    let requestId: string = `RET-${Date.now()}`;
    let rawLeads: OutboundLeadPayload[] = [];

    if (Array.isArray(raw)) {
      rawLeads = raw as OutboundLeadPayload[];
    } else {
      const body = raw as RetornoBody;
      tipoAutomacao = body.tipoAutomacao === "cnpj" ? "cnpj" : "api";
      requestId = String(body.requestId || requestId);
      rawLeads = Array.isArray(body.leads)
        ? body.leads
        : Array.isArray(body.data)
          ? body.data
          : [];
    }

    console.log("[RETORNO] payload_bruto", {
      requestId,
      tipoAutomacao,
      rawCount: rawLeads.length,
      primeiraEmpresa: rawLeads[0]?.nome ?? rawLeads[0]?.empresa ?? "(vazio)",
    });

    const leads: Lead[] = rawLeads
      .map((item) => buildOutboundLead(item, tipoAutomacao))
      .filter((lead): lead is Lead => lead !== null);

    console.log("[RETORNO] leads_normalizados", {
      count: leads.length,
      ids: leads.map((l) => l.id),
      empresas: leads.map((l) => l.company),
    });

    if (leads.length === 0) {
      return NextResponse.json(
        { success: false, message: "Nenhum lead valido encontrado no retorno." },
        { status: 400 },
      );
    }

    const currentLeads = await readLeadsCollection();
    const distributed = await distributeLeadOwnersFromDatabase({
      incomingLeads: leads,
      existingLeads: currentLeads,
    });

    await savePendingAutomatedLeads({
      requestId,
      tipoAutomacao,
      leads: distributed.leads,
      savedAt: new Date().toISOString(),
    });

    console.log("[RETORNO] salvo_pendente", { requestId, count: leads.length });

    return NextResponse.json({ success: true, count: distributed.leads.length });
  } catch (error) {
    if (
      error instanceof LeadOwnerDistributionError &&
      error.code === LEAD_OWNER_DISTRIBUTION_NO_ELIGIBLE
    ) {
      return NextResponse.json(
        {
          success: false,
          code: LEAD_OWNER_DISTRIBUTION_NO_ELIGIBLE,
          message:
            "Nao existe responsavel elegivel cadastrado para distribuir os leads automatizados. Cadastre ao menos um responsavel.",
        },
        { status: 422 },
      );
    }
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

