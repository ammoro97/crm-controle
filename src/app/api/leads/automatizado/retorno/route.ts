import { NextResponse } from "next/server";
import { savePendingAutomatedLeads } from "@/lib/leads-automatizado-store";
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

function normalizeExpedienteString(value?: string | null): "Aberto" | "Fechado" | "Indefinido" {
  if (!value) return "Indefinido";
  const v = value.trim().toLowerCase();
  if (v === "aberto" || v === "open" || v === "aberto agora") return "Aberto";
  if (v === "fechado" || v === "closed" || v === "fechado agora") return "Fechado";
  if (v.startsWith("aberto")) return "Aberto";
  if (v.startsWith("fechado")) return "Fechado";
  return "Indefinido";
}

type HorarioItem = { dia?: unknown; horario?: unknown };

// Converte "7 AM" ou "8 PM" para minutos desde meia-noite
function parseTimeToMinutes(timeStr: string): number | null {
  const match = timeStr.trim().match(/^(\d+)(?::(\d+))?\s*(AM|PM)$/i);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const period = match[3].toUpperCase();
  if (period === "PM" && hour !== 12) hour += 12;
  if (period === "AM" && hour === 12) hour = 0;
  return hour * 60 + minutes;
}

// Mapeia dia da semana JS (0=Dom..6=Sab) para nome em portugues
const DIAS_PT = ["Domingo", "Segunda-feira", "Terca-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sabado"];

function computeExpedienteFromHorarios(
  horarios: HorarioItem[],
): "Aberto" | "Fechado" | "Indefinido" {
  // Usa horario de Brasilia (UTC-3) — Brazil nao tem horario de verao desde 2019
  const nowBrasilia = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const dayIndex = nowBrasilia.getDay(); // 0=Dom, 6=Sab
  const todayPt = DIAS_PT[dayIndex];
  const currentMinutes = nowBrasilia.getHours() * 60 + nowBrasilia.getMinutes();

  // Busca a entrada do dia atual (comparacao sem acento e case-insensitive)
  const normalize = (s: string) =>
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

  const entry = horarios.find((item) => normalize(String(item?.dia || "")) === normalize(todayPt));
  if (!entry) return "Indefinido";

  const horario = String(entry?.horario || "").trim();
  if (!horario || horario.toLowerCase() === "closed") return "Fechado";

  // Formato esperado: "7 AM to 8 PM"
  const match = horario.match(/^(.+?)\s+to\s+(.+)$/i);
  if (!match) return "Indefinido";

  const start = parseTimeToMinutes(match[1]);
  const end = parseTimeToMinutes(match[2]);
  if (start === null || end === null) return "Indefinido";

  return currentMinutes >= start && currentMinutes < end ? "Aberto" : "Fechado";
}

function resolveExpediente(
  expedienteExplicito: string | null | undefined,
  horarioRaw: unknown,
): "Aberto" | "Fechado" | "Indefinido" {
  // Se o payload ja traz expediente explicito, usa ele
  if (expedienteExplicito) return normalizeExpedienteString(expedienteExplicito);
  // Caso contrario, calcula a partir do horario_funcionamento
  if (Array.isArray(horarioRaw) && horarioRaw.length > 0) {
    return computeExpedienteFromHorarios(horarioRaw as HorarioItem[]);
  }
  return "Indefinido";
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
    horario_funcionamento: normalizeHorarioFuncionamento(raw.horario_funcionamento),
    expediente: resolveExpediente(raw.expediente, raw.horario_funcionamento),
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

    await savePendingAutomatedLeads({
      requestId,
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
