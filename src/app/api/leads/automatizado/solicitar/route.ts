import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { getWebhookOutConfig, isWebhookOutConfigured } from "@/lib/webhook-out-config-store";
import { CALL_ANALYSIS_SECRET_HEADER } from "@/types/call-analysis";
import { Lead } from "@/types/crm";
import { readLeadsCollection } from "@/lib/leads-customers-store";
import { resolveLeadExpedienteStatusFromHorario } from "@/lib/lead-expediente";
import {
  LEAD_OWNER_DISTRIBUTION_NO_ELIGIBLE,
  LeadOwnerDistributionError,
} from "@/lib/lead-owner-distribution";
import { distributeLeadOwnersFromDatabase } from "@/lib/lead-owner-distribution-server";

const CRM_EVENT_OUTBOUND = "outbound" as const;

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
  socios?: string | string[] | null;
  phone?: string;
  telefone?: string;
  telefone_google?: string | null;
  telefone_cnpj?: string | null;
  email?: string;
  city?: string;
  cidade?: string;
  estado?: string;
  dataCadastro?: string;
  origem?: string;
  site?: string;
  horario_funcionamento?: unknown;
  nota?: number | string | null;
  avaliacoes?: number | string | null;
  tempo_cnpj?: number | string | null;
  rl_site?: string | null;
  nome_fantasia?: string | null;
  endereco_completo?: string | null;
  categoria_principal?: string | null;
  categorias_secundarias?: string | string[] | null;
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
  pending?: boolean;
  message?: string;
};

function normalizePayloadKey(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function getPayloadValue(raw: N8nLeadItem, aliases: string[]): unknown {
  for (const alias of aliases) {
    const direct = raw[alias];
    if (hasMeaningfulValue(direct)) return direct;
  }

  const normalizedAliases = new Set(aliases.map((alias) => normalizePayloadKey(alias)));
  for (const [key, value] of Object.entries(raw)) {
    if (!normalizedAliases.has(normalizePayloadKey(key))) continue;
    if (!hasMeaningfulValue(value)) continue;
    return value;
  }
  return undefined;
}

function getPayloadString(raw: N8nLeadItem, aliases: string[]): string {
  const value = getPayloadValue(raw, aliases);
  if (Array.isArray(value)) {
    const first = value.map((item) => String(item || "").trim()).find(Boolean);
    return first || "";
  }
  return String(value || "").trim();
}

function getPayloadList(raw: N8nLeadItem, aliases: string[]): string[] {
  const value = getPayloadValue(raw, aliases);
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  const text = String(value || "").trim();
  if (!text) return [];
  return text
    .split(/[|;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeDateInput(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const brMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brMatch) return `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`;
  return raw.slice(0, 10);
}

function normalizeNumberLike(value: unknown): number | string | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function normalizeHorarioFuncionamento(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    const lines = value
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const row = item as { dia?: unknown; horario?: unknown };
        const dia = String(row.dia || "").trim();
        const horario = String(row.horario || "").trim();
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

function buildOutboundLead(raw: N8nLeadItem, tipoAutomacao: "api" | "cnpj"): Lead | null {
  const socios = getPayloadList(raw, [
    "socios",
    "socio",
    "responsaveis",
    "responsavel",
    "responsavel_principal",
    "nome_responsavel",
    "nome_contato",
    "contato",
    "nome",
  ]);
  const company = getPayloadString(raw, [
    "empresa",
    "company",
    "nome_fantasia",
    "nome fantasia",
    "razao_social",
    "razao social",
    "nome",
  ]);
  const responsavel = getPayloadString(raw, ["responsavel", "name", "nome_responsavel", "contato"]);
  const firstSocio = socios[0] || "";
  const name = responsavel || firstSocio || company;
  if (!name && !company) return null;

  const telefoneGoogle = getPayloadString(raw, ["telefone_google", "telefone google", "phone_google"]);
  const telefoneCnpj = getPayloadString(raw, ["telefone_cnpj", "telefone cnpj", "phone_cnpj"]);
  const telefonePadrao = getPayloadString(raw, ["telefone", "phone", "celular", "whatsapp"]);
  const allPhones = Array.from(new Set([telefoneGoogle, telefoneCnpj, telefonePadrao].filter(Boolean)));
  const primaryPhone = allPhones[0] || "";

  const email = getPayloadString(raw, ["email", "e-mail"]);
  const site = getPayloadString(raw, ["site", "website", "url"]);
  const cidade = getPayloadString(raw, ["cidade", "city"]);
  const estado = getPayloadString(raw, ["estado", "uf"]);
  const dataCadastroRaw = getPayloadString(raw, ["dataCadastro", "data_cadastro", "data cadastro", "cadastrado"]);
  const sourceRaw = getPayloadString(raw, ["origem", "source"]);
  const nomeFantasia = getPayloadString(raw, ["nome_fantasia", "nome fantasia", "nomefantasia"]) || company;
  const enderecoCompleto = getPayloadString(raw, ["endereco_completo", "endereco completo", "endereco", "address"]);
  const categoriaPrincipal =
    getPayloadString(raw, ["categoria_principal", "categoria principal", "categoria", "niche", "nicho"]);
  const categoriasSecundarias = getPayloadList(raw, [
    "categorias_secundarias",
    "categorias secundarias",
    "categoria_secundaria",
    "categorias",
  ]);
  const rlSite = getPayloadString(raw, ["rl_site", "rl site", "responsavel_legal_site", "responsavel legal site"]);
  const tempoCnpj = normalizeNumberLike(getPayloadValue(raw, ["tempo_cnpj", "tempo cnpj", "tempo de cnpj", "anos_cnpj", "anos"]));
  const nota = normalizeNumberLike(getPayloadValue(raw, ["nota", "rating", "nota_media"]));
  const avaliacoes = normalizeNumberLike(getPayloadValue(raw, ["avaliacoes", "avaliacao", "reviews"]));
  const horarioFuncionamento = normalizeHorarioFuncionamento(
    getPayloadValue(raw, ["horario_funcionamento", "horario de funcionamento", "horario", "funcionamento"]),
  );
  const nicho = getPayloadString(raw, ["niche", "nicho"]) || categoriaPrincipal;

  const now = new Date();
  const dateStr = normalizeDateInput(dataCadastroRaw) || now.toISOString().slice(0, 10);
  const timeStr = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const sourceLabel = sourceRaw || (tipoAutomacao === "api" ? "Automacao por API" : "Automacao por CNPJ");
  const id = `L-AUTO-${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`;

  return {
    id,
    name: name || company,
    names: socios.length > 0 ? socios : (name && name !== company ? [name] : []),
    socios: socios.length > 0 ? socios : null,
    company,
    phone: primaryPhone,
    telefone_google: telefoneGoogle || null,
    telefone_cnpj: telefoneCnpj || null,
    phones: allPhones,
    email,
    emails: [],
    status: "Novo",
    source: sourceLabel,
    owner: "",
    notes: "",
    channel: "outbound",
    city: buildCityField(cidade, estado),
    niche: nicho,
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
    site: site || null,
    nome_fantasia: nomeFantasia || null,
    endereco_completo: enderecoCompleto || null,
    categoria_principal: categoriaPrincipal || null,
    categorias_secundarias: categoriasSecundarias.length > 0 ? categoriasSecundarias : null,
    rl_site: rlSite || null,
    tempo_cnpj: tempoCnpj,
    nota,
    avaliacoes,
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

    const config = await getWebhookOutConfig();
    if (!isWebhookOutConfigured(config)) {
      return NextResponse.json<SolicitacaoResponse>(
        { success: false, message: "Webhook de saida nao configurado. Configure em Configuracoes > Integracoes." },
        { status: 400 },
      );
    }

    const payload = { event: CRM_EVENT_OUTBOUND, ...body };

    const n8nResponse = await fetch(config.url, {
      method: config.method,
      headers: {
        "Content-Type": "application/json",
        "x-crm-event": CRM_EVENT_OUTBOUND,
        ...(config.secret ? { [CALL_ANALYSIS_SECRET_HEADER]: config.secret } : {}),
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    if (!n8nResponse.ok) {
      return NextResponse.json<SolicitacaoResponse>(
        { success: false, message: `Erro ao chamar automacao externa (HTTP ${n8nResponse.status}). Tente novamente.` },
        { status: 502 },
      );
    }

    const n8nData = (await n8nResponse.json()) as N8nRetornoBody | N8nLeadItem[];
    console.log("[SOLICITAR] n8n_response_raw", JSON.stringify(n8nData).slice(0, 500));

    const rawLeads: N8nLeadItem[] = Array.isArray(n8nData)
      ? (n8nData as N8nLeadItem[])
      : Array.isArray((n8nData as N8nRetornoBody).leads)
        ? ((n8nData as N8nRetornoBody).leads as N8nLeadItem[])
        : Array.isArray((n8nData as N8nRetornoBody).data)
          ? ((n8nData as N8nRetornoBody).data as N8nLeadItem[])
          : [];

    const extractedLeads: Lead[] = rawLeads
      .map((raw) => buildOutboundLead(raw, body.tipoAutomacao))
      .filter((lead): lead is Lead => lead !== null);

    let leads = extractedLeads;
    if (leads.length > 0) {
      const currentLeads = await readLeadsCollection();
      const distributed = await distributeLeadOwnersFromDatabase({
        incomingLeads: leads,
        existingLeads: currentLeads,
      });
      leads = distributed.leads;
    }

    console.log("[SOLICITAR] leads_extraidos", {
      count: leads.length,
      pending: leads.length === 0,
      empresas: leads.map((l) => l.company),
    });

    // Se n8n respondeu com leads sincronamente, retorna direto.
    // Se retornou vazio (respond immediately / async), sinaliza pending
    // para o frontend aguardar o callback via /retorno + /pendentes.
    return NextResponse.json<SolicitacaoResponse>({
      success: true,
      leads,
      count: leads.length,
      pending: leads.length === 0,
    });
  } catch (error) {
    if (
      error instanceof LeadOwnerDistributionError &&
      error.code === LEAD_OWNER_DISTRIBUTION_NO_ELIGIBLE
    ) {
      return NextResponse.json<SolicitacaoResponse>(
        {
          success: false,
          message:
            "Nao existe responsavel elegivel cadastrado para distribuir os leads automatizados. Cadastre ao menos um responsavel.",
          pending: false,
        },
        { status: 422 },
      );
    }
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
