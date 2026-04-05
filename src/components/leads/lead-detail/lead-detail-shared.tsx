import { Lead, LeadHistoryEvent, LeadObservationType, PainPoint } from "@/types/crm";

export type EditableFieldType = "input" | "textarea" | "select" | "date";

export type QualificacaoNegocioForm = {
  jaUtilizaCrm: "sim" | "nao" | null;
  qualCrmUtiliza: string;
  quantoPagaCrm: string;
  fazTrafegoPago: "sim" | "nao" | null;
  quantidadeProfissionaisClinica: number | null;
  nomeDecisor: string;
};

export const statusOptions: Lead["status"][] = [
  "Novo",
  "Contato iniciado",
  "Qualificado",
  "Reuniao marcada",
  "Proposta enviada",
  "Perdido",
  "Fechado",
];

export const businessTypeOptions = ["estetica", "odontologia"];

export const revenueOptions = [
  "Ate R$ 50k/mensal",
  "R$ 50k a R$ 120k/mensal",
  "R$ 120k a R$ 180k/mensal",
  "R$ 180k a R$ 300k/mensal",
  "Acima de R$ 300k/mensal",
];

export const decisionOptions = ["sim", "nao"];
export const buyingMomentOptions = ["curioso", "pesquisando", "avaliando", "quer resolver", "urgente"];
export const icpOptions = ["baixo", "medio", "alto"];

export const observationTypes: LeadObservationType[] = [
  "contato",
  "follow-up",
  "objecao",
  "informacao interna",
  "negociacao",
];

export function ChannelBadge({ channel }: { channel: Lead["channel"] }) {
  const style =
    channel === "inbound"
      ? "bg-emerald-500/20 text-emerald-300 border-emerald-400/40"
      : "bg-sky-500/20 text-sky-300 border-sky-400/40";

  return <span className={`rounded-full border px-2 py-1 text-xs font-semibold uppercase ${style}`}>{channel}</span>;
}

export function normalizeEventTypeLabel(value: string) {
  const normalized = (value || "").trim().toLowerCase();
  if (!normalized) return "Evento";
  if (normalized === "lead_criado") return "Lead criado";
  if (normalized === "ligacao") return "Ligacao";
  if (normalized === "agendamento") return "Agendamento";
  if (normalized === "mudanca de status") return "Status";
  if (normalized === "responsavel alterado") return "Responsavel";
  if (normalized === "proxima acao atualizada") return "Proxima acao";
  if (normalized === "lead atualizado") return "Atualizacao";
  if (normalized === "observacao interna" || normalized === "observacao_interna") return "Observacao interna";
  if (normalized === "obs") return "Observacao interna";
  return value;
}

export function normalizeHistoryDescription(event: LeadHistoryEvent) {
  const type = (event.eventType || "").trim().toLowerCase();
  const description = (event.description || "").trim();

  if (type === "lead atualizado" && description === "Dados do lead foram atualizados.") {
    return "Atualizacao de dados do lead.";
  }
  if (type === "mudanca de status" && description.toLowerCase() === "status alterado") {
    return "Status alterado.";
  }

  return description || "Sem descricao.";
}

type CommercialData = {
  buyingMoment: string;
  decisionMakerIdentified: string;
  icpFit: string;
  mainProblem: string;
  painPoints: string;
  mainInterest: string;
  businessType: string;
  specialty: string;
  monthlyRevenueRange: string;
  averageLeadsPerMonth: string;
};

export function getLeadCommercialData(lead: Lead): CommercialData {
  if (lead.channel === "inbound" && lead.inboundQualification) {
    return {
      buyingMoment: lead.inboundQualification.buyingMoment || "-",
      decisionMakerIdentified: lead.inboundQualification.decisionMakerIdentified || "-",
      icpFit: lead.inboundQualification.icpFit || "-",
      mainProblem: lead.inboundQualification.mainProblem || "-",
      painPoints: lead.inboundQualification.painPoints?.join(", ") || "-",
      mainInterest: lead.inboundQualification.mainInterest || "-",
      businessType: lead.inboundQualification.businessType || "-",
      specialty: lead.inboundQualification.specialty || "-",
      monthlyRevenueRange: lead.inboundQualification.monthlyRevenueRange || "-",
      averageLeadsPerMonth: lead.inboundQualification.averageLeadsPerMonth || "-",
    };
  }

  if (lead.channel === "outbound" && lead.outboundQualification) {
    return {
      buyingMoment: lead.outboundQualification.buyingMoment || "-",
      decisionMakerIdentified: lead.outboundQualification.decisionMakerIdentified || "-",
      icpFit: lead.outboundQualification.icpFit || "-",
      mainProblem: lead.outboundQualification.mainProblem || "-",
      painPoints: lead.outboundQualification.painPoints?.join(", ") || "-",
      mainInterest: "-",
      businessType: lead.outboundQualification.businessType || "-",
      specialty: lead.outboundQualification.specialty || "-",
      monthlyRevenueRange: lead.outboundQualification.monthlyRevenueRange || "-",
      averageLeadsPerMonth: lead.outboundQualification.averageLeadsPerMonth || "-",
    };
  }

  return {
    buyingMoment: "-",
    decisionMakerIdentified: "-",
    icpFit: "-",
    mainProblem: "-",
    painPoints: "-",
    mainInterest: "-",
    businessType: "-",
    specialty: "-",
    monthlyRevenueRange: "-",
    averageLeadsPerMonth: "-",
  };
}

export function updateCommercialField(draftLead: Lead, key: string, value: string): Lead {
  let nextLead: Lead = { ...draftLead };

  if (draftLead.channel === "inbound" && draftLead.inboundQualification) {
    const inbound = { ...draftLead.inboundQualification };
    if (key === "businessType") inbound.businessType = value as typeof inbound.businessType;
    if (key === "specialty") inbound.specialty = value;
    if (key === "monthlyRevenueRange") inbound.monthlyRevenueRange = value;
    if (key === "averageLeadsPerMonth") inbound.averageLeadsPerMonth = value;
    if (key === "decisionMakerIdentified") inbound.decisionMakerIdentified = value as typeof inbound.decisionMakerIdentified;
    if (key === "buyingMoment") inbound.buyingMoment = value as typeof inbound.buyingMoment;
    if (key === "icpFit") inbound.icpFit = value as typeof inbound.icpFit;
    if (key === "mainProblem") inbound.mainProblem = value;
    if (key === "painPoints") {
      inbound.painPoints = value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean) as PainPoint[];
    }
    if (key === "mainInterest") inbound.mainInterest = value as typeof inbound.mainInterest;
    nextLead = { ...nextLead, inboundQualification: inbound };
  }

  if (draftLead.channel === "outbound" && draftLead.outboundQualification) {
    const outbound = { ...draftLead.outboundQualification };
    if (key === "businessType") outbound.businessType = value as typeof outbound.businessType;
    if (key === "specialty") outbound.specialty = value;
    if (key === "monthlyRevenueRange") outbound.monthlyRevenueRange = value;
    if (key === "averageLeadsPerMonth") outbound.averageLeadsPerMonth = value;
    if (key === "decisionMakerIdentified") outbound.decisionMakerIdentified = value as typeof outbound.decisionMakerIdentified;
    if (key === "buyingMoment") outbound.buyingMoment = value as typeof outbound.buyingMoment;
    if (key === "icpFit") outbound.icpFit = value as typeof outbound.icpFit;
    if (key === "mainProblem") outbound.mainProblem = value;
    if (key === "painPoints") {
      outbound.painPoints = value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean) as PainPoint[];
    }
    nextLead = { ...nextLead, outboundQualification: outbound };
  }

  return nextLead;
}

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function normalizeChoice(value: unknown): "sim" | "nao" | null {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "sim") return "sim";
  if (normalized === "nao") return "nao";
  return null;
}

function normalizePositiveInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  const digitsOnly = normalizeText(value).replace(/\D/g, "");
  if (!digitsOnly) return null;
  const parsed = Number(digitsOnly);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

export function getLeadQualificacaoNegocioForm(lead: Lead): QualificacaoNegocioForm {
  const outbound = lead.outboundQualification;
  const jaUtilizaCrm = normalizeChoice(outbound?.jaUtilizaCrm ?? outbound?.usesCrm);
  const qualCrmUtiliza = normalizeText(outbound?.qualCrmUtiliza ?? outbound?.crmName);
  const quantoPagaCrm = normalizeText(outbound?.quantoPagaCrm);
  const fazTrafegoPago = normalizeChoice(outbound?.fazTrafegoPago);
  const quantidadeProfissionaisClinica = normalizePositiveInteger(
    outbound?.quantidadeProfissionaisClinica ?? outbound?.teamSize,
  );
  const nomeDecisor = normalizeText(outbound?.nomeDecisor ?? outbound?.decisionContacts?.[0]?.name);

  return {
    jaUtilizaCrm,
    qualCrmUtiliza,
    quantoPagaCrm,
    fazTrafegoPago,
    quantidadeProfissionaisClinica,
    nomeDecisor,
  };
}

export function updateLeadQualificacaoNegocio(
  lead: Lead,
  patch: Partial<QualificacaoNegocioForm>,
): Lead {
  if (lead.channel !== "outbound" || !lead.outboundQualification) {
    return lead;
  }

  const current = getLeadQualificacaoNegocioForm(lead);
  const merged: QualificacaoNegocioForm = {
    ...current,
    ...patch,
  };

  if (merged.jaUtilizaCrm === "nao") {
    merged.qualCrmUtiliza = "";
    merged.quantoPagaCrm = "";
  }

  const nextOutbound = {
    ...lead.outboundQualification,
    jaUtilizaCrm: merged.jaUtilizaCrm,
    qualCrmUtiliza: merged.qualCrmUtiliza,
    quantoPagaCrm: merged.quantoPagaCrm,
    fazTrafegoPago: merged.fazTrafegoPago,
    quantidadeProfissionaisClinica: merged.quantidadeProfissionaisClinica,
    nomeDecisor: merged.nomeDecisor,
  };

  return {
    ...lead,
    outboundQualification: nextOutbound,
  };
}

export function validateQualificacaoNegocio(form: QualificacaoNegocioForm): {
  valid: boolean;
  missingRequiredFields: string[];
} {
  const missing: string[] = [];

  if (!form.jaUtilizaCrm) missing.push("Já utiliza CRM?");
  if (!form.fazTrafegoPago) missing.push("Faz tráfego pago?");
  if (!form.quantidadeProfissionaisClinica || form.quantidadeProfissionaisClinica <= 0) {
    missing.push("Quantos profissionais existem na clínica?");
  }
  if (!normalizeText(form.nomeDecisor)) missing.push("Qual o nome do decisor?");

  if (form.jaUtilizaCrm === "sim") {
    if (!normalizeText(form.qualCrmUtiliza)) missing.push("Qual CRM utiliza?");
    if (!normalizeText(form.quantoPagaCrm)) missing.push("Quanto paga?");
  }

  return {
    valid: missing.length === 0,
    missingRequiredFields: missing,
  };
}
