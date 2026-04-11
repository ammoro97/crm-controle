import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { savePendingAutomatedLeads } from "@/lib/leads-automatizado-store";
import {
  LEAD_OWNER_DISTRIBUTION_NO_ELIGIBLE,
  LeadOwnerDistributionError,
} from "@/lib/lead-owner-distribution";
import { distributeLeadOwnersFromDatabase } from "@/lib/lead-owner-distribution-server";
import { resolveLeadExpedienteStatusFromHorario } from "@/lib/lead-expediente";
import { readLeadsCollection } from "@/lib/leads-customers-store";
import { getWebhookOutConfig } from "@/lib/webhook-out-config-store";
import { CALL_ANALYSIS_SECRET_HEADER } from "@/types/call-analysis";
import { Lead } from "@/types/crm";

export type OutboundLeadPayload = {
  empresa?: string | null;
  nome?: string | null;       // alias para empresa quando nao ha responsavel separado
  responsavel?: string | null;
  socios?: string | string[] | null;
  telefone?: string | null;
  telefone_google?: string | null;
  telefone_cnpj?: string | null;
  email?: string | null;
  site?: string | null;
  tempo_cnpj?: number | string | null;
  rl_site?: string | null;
  nome_fantasia?: string | null;
  endereco_completo?: string | null;
  categoria_principal?: string | null;
  categorias_secundarias?: string | string[] | null;
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
const REQUIRE_RETORNO_SECRET = String(process.env.LEADS_AUTOMATIZADO_REQUIRE_SECRET || "").trim() === "1";

function hasValidRetornoSecret(request: Request, expectedSecret: string): boolean {
  if (!expectedSecret) return false;
  const receivedSecret = String(request.headers.get(CALL_ANALYSIS_SECRET_HEADER) || "").trim();
  const expectedBuffer = Buffer.from(expectedSecret, "utf8");
  const receivedBuffer = Buffer.from(receivedSecret, "utf8");
  if (expectedBuffer.length === 0 || expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

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

function getPayloadValue(raw: OutboundLeadPayload, aliases: string[]): unknown {
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

function getPayloadString(raw: OutboundLeadPayload, aliases: string[]): string {
  const value = getPayloadValue(raw, aliases);
  if (Array.isArray(value)) {
    const first = value.map((item) => String(item || "").trim()).find(Boolean);
    return first || "";
  }
  return String(value || "").trim();
}

function getPayloadList(raw: OutboundLeadPayload, aliases: string[]): string[] {
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

function normalizeNumberLike(value: unknown): number | string | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").trim();
  return text ? text : null;
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

function buildCityField(cidade?: string | null, estado?: string | null): string {
  const c = String(cidade || "").trim();
  const s = String(estado || "").trim();
  if (c && s) return `${c} - ${s}`;
  return c || s || "";
}

function buildOutboundLead(raw: OutboundLeadPayload, tipoAutomacao: "api" | "cnpj"): Lead | null {
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
  const empresa = getPayloadString(raw, [
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
  const leadDisplayName = responsavel || firstSocio || empresa;
  if (!empresa && !leadDisplayName) return null;

  const telefoneGoogle = getPayloadString(raw, ["telefone_google", "telefone google", "phone_google"]);
  const telefoneCnpj = getPayloadString(raw, ["telefone_cnpj", "telefone cnpj", "phone_cnpj"]);
  const telefonePadrao = getPayloadString(raw, ["telefone", "phone", "celular", "whatsapp"]);
  const allPhones = Array.from(new Set([telefoneGoogle, telefoneCnpj, telefonePadrao].filter(Boolean)));
  const primaryPhone = allPhones[0] || "";

  const email = getPayloadString(raw, ["email", "e-mail"]);
  const site = getPayloadString(raw, ["site", "website", "url"]);
  const cidade = getPayloadString(raw, ["cidade", "city"]);
  const estado = getPayloadString(raw, ["estado", "uf"]);
  const origemPayload = getPayloadString(raw, ["origem", "source"]);
  const dataCadastroRaw = getPayloadString(raw, ["dataCadastro", "data_cadastro", "data cadastro", "cadastrado"]);
  const nomeFantasia = getPayloadString(raw, ["nome_fantasia", "nome fantasia", "nomefantasia"]) || empresa;
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
  const nota = normalizeNumberLike(getPayloadValue(raw, ["nota", "rating", "nota_media"]));
  const avaliacoes = normalizeNumberLike(getPayloadValue(raw, ["avaliacoes", "avaliacao", "reviews"]));
  const tempoCnpj = normalizeNumberLike(getPayloadValue(raw, ["tempo_cnpj", "tempo cnpj", "tempo de cnpj", "anos_cnpj", "anos"]));
  const horarioFuncionamento = normalizeHorarioFuncionamento(
    getPayloadValue(raw, ["horario_funcionamento", "horario de funcionamento", "horario", "funcionamento"]),
  );
  const nicho = getPayloadString(raw, ["niche", "nicho"]) || categoriaPrincipal;

  const now = new Date();
  const normalizedDate = normalizeDateInput(dataCadastroRaw);
  const dateStr = normalizedDate || now.toISOString().slice(0, 10);
  const timeStr = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  const sourceLabel = origemPayload || (tipoAutomacao === "api" ? "Automacao por API" : "Automacao por CNPJ");
  const id = `L-AUTO-${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`;

  return {
    id,
    name: leadDisplayName,
    names: socios.length > 0 ? socios : (leadDisplayName && leadDisplayName !== empresa ? [leadDisplayName] : []),
    socios: socios.length > 0 ? socios : null,
    company: empresa,
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
  try {
    const config = await getWebhookOutConfig();
    const expectedSecret = String(process.env.LEADS_AUTOMATIZADO_WEBHOOK_SECRET || config.secret || "").trim();
    if (expectedSecret && !hasValidRetornoSecret(request, expectedSecret)) {
      return NextResponse.json(
        { success: false, message: "Assinatura invalida no retorno automatizado." },
        { status: 401 },
      );
    }
    if (!expectedSecret && REQUIRE_RETORNO_SECRET) {
      return NextResponse.json(
        { success: false, message: "Secret de webhook nao configurado para retorno automatizado." },
        { status: 401 },
      );
    }

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

    const leads: Lead[] = rawLeads
      .map((item) => buildOutboundLead(item, tipoAutomacao))
      .filter((lead): lead is Lead => lead !== null);

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

