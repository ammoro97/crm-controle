import { NextResponse } from "next/server";
import { getCallAnalysisObservations } from "@/lib/call-analysis-store";
import { getCallLogs } from "@/lib/calls-store";
import { readCustomersCollection, readLeadsCollection } from "@/lib/leads-customers-store";
import { PostCallWrapup } from "@/lib/post-call-flow";
import { requireAuth } from "@/lib/require-auth";
import { readDataFile } from "@/lib/storage-paths";
import { CallLog, Lead, LeadFinalizationRecord, Meeting } from "@/types/crm";

type ChatRole = "assistant" | "user";

type ChatConversationItem = {
  role: ChatRole;
  content: string;
};

type ChatRequestBody = {
  message?: string;
  conversation?: ChatConversationItem[];
};

type TemporalGroup = {
  key: string;
  total: number;
  answered: number;
  answeredRate: number;
};

type AssistantContextSummary = {
  generatedAt: string;
  timezone: string;
  totals: {
    leads: number;
    customers: number;
    meetings: number;
    finalizations: number;
    wrapups: number;
    callAnalysisObservations: number;
    calls: number;
    callsAnswered: number;
    callsAnsweredRate: number;
  };
  temporal: {
    hoursWithoutCalls: string[];
    topHours: TemporalGroup[];
    weekdays: TemporalGroup[];
  };
  opportunity: {
    estimatedUpliftPercent: number;
    rationale: string;
  };
};

const MEETINGS_FILE = "crm.agenda.meetings.v1.json";
const LEAD_FINALIZATIONS_FILE = "crm.leads.finalizations.v1.json";
const WRAPUPS_FILE = "crm.calls.wrapups.v1.json";
const DEFAULT_MODEL = "gpt-4.1-mini";
const DEFAULT_TIMEZONE = "America/Sao_Paulo";

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function safePercent(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return Number(((numerator / denominator) * 100).toFixed(1));
}

function normalizeText(value?: string | null): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function isAnsweredStatus(status?: string | null): boolean {
  const normalized = normalizeText(status);
  return normalized === "atendida" || normalized === "answered" || normalized === "conectada";
}

function getTimezoneParts(inputIso: string, timezone: string): { hourLabel: string; weekday: string } | null {
  const parsed = new Date(inputIso);
  if (Number.isNaN(parsed.getTime())) return null;

  const formatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    hour12: false,
    weekday: "long",
  });
  const parts = formatter.formatToParts(parsed);
  const hour = parts.find((item) => item.type === "hour")?.value || "";
  const weekday = parts.find((item) => item.type === "weekday")?.value || "";
  if (!hour || !weekday) return null;
  return {
    hourLabel: `${hour.padStart(2, "0")}:00`,
    weekday,
  };
}

function toTemporalGroups(map: Map<string, { total: number; answered: number }>): TemporalGroup[] {
  return Array.from(map.entries())
    .map(([key, value]) => ({
      key,
      total: value.total,
      answered: value.answered,
      answeredRate: safePercent(value.answered, value.total),
    }))
    .sort((a, b) => b.answeredRate - a.answeredRate || b.total - a.total);
}

function buildContextSummary(params: {
  calls: CallLog[];
  leads: Lead[];
  customers: Lead[];
  meetings: Meeting[];
  finalizations: LeadFinalizationRecord[];
  wrapups: PostCallWrapup[];
  callAnalysisObservationsCount: number;
  timezone: string;
}): AssistantContextSummary {
  const {
    calls,
    leads,
    customers,
    meetings,
    finalizations,
    wrapups,
    callAnalysisObservationsCount,
    timezone,
  } = params;

  const callsAnswered = calls.filter((call) => isAnsweredStatus(call.status)).length;
  const callsAnsweredRate = safePercent(callsAnswered, calls.length);

  const byHour = new Map<string, { total: number; answered: number }>();
  const byWeekday = new Map<string, { total: number; answered: number }>();

  for (const call of calls) {
    const reference = String(call.startedAt || call.createdAt || "").trim();
    if (!reference) continue;
    const parts = getTimezoneParts(reference, timezone);
    if (!parts) continue;

    const hourCurrent = byHour.get(parts.hourLabel) || { total: 0, answered: 0 };
    hourCurrent.total += 1;
    if (isAnsweredStatus(call.status)) hourCurrent.answered += 1;
    byHour.set(parts.hourLabel, hourCurrent);

    const dayCurrent = byWeekday.get(parts.weekday) || { total: 0, answered: 0 };
    dayCurrent.total += 1;
    if (isAnsweredStatus(call.status)) dayCurrent.answered += 1;
    byWeekday.set(parts.weekday, dayCurrent);
  }

  const hoursWithData = toTemporalGroups(byHour);
  const weekdays = toTemporalGroups(byWeekday);
  const allHours = Array.from({ length: 24 }).map((_, index) => `${String(index).padStart(2, "0")}:00`);
  const hoursWithoutCalls = allHours.filter((hour) => !byHour.has(hour));

  const topHours = hoursWithData.filter((item) => item.total >= 3).slice(0, 3);
  const bestHourRate = topHours.length > 0 ? topHours[0].answeredRate : callsAnsweredRate;
  const deltaVsOverall = Math.max(0, bestHourRate - callsAnsweredRate);
  const sparsityBoost = clamp(hoursWithoutCalls.length * 0.4, 0, 7);
  const baseEstimate = deltaVsOverall * 0.55 + sparsityBoost;
  const estimatedUpliftPercent = clamp(Math.round(baseEstimate), 1, 22);

  const rationale = topHours.length
    ? `Janela com melhor atendimento (${topHours[0].key}) supera a media geral em ${deltaVsOverall.toFixed(1)} p.p.`
    : "Base com baixa cobertura por horario. Oportunidade principal esta em testar janelas sem ligacao.";

  return {
    generatedAt: new Date().toISOString(),
    timezone,
    totals: {
      leads: leads.length,
      customers: customers.length,
      meetings: meetings.length,
      finalizations: finalizations.length,
      wrapups: wrapups.length,
      callAnalysisObservations: callAnalysisObservationsCount,
      calls: calls.length,
      callsAnswered,
      callsAnsweredRate,
    },
    temporal: {
      hoursWithoutCalls: hoursWithoutCalls.slice(0, 10),
      topHours,
      weekdays: weekdays.slice(0, 7),
    },
    opportunity: {
      estimatedUpliftPercent,
      rationale,
    },
  };
}

function sanitizeConversation(items: unknown): ChatConversationItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const typed = item as Partial<ChatConversationItem>;
      const role = typed.role === "assistant" ? "assistant" : typed.role === "user" ? "user" : null;
      const content = String(typed.content || "").trim();
      if (!role || !content) return null;
      return {
        role,
        content: content.slice(0, 2200),
      } satisfies ChatConversationItem;
    })
    .filter((item): item is ChatConversationItem => Boolean(item))
    .slice(-10);
}

function buildFallbackReply(input: { context: AssistantContextSummary; userMessage: string; includeApiHint: boolean }) {
  const { context, includeApiHint } = input;
  const topHour = context.temporal.topHours[0];
  const topDay = context.temporal.weekdays[0];
  const noCalls = context.temporal.hoursWithoutCalls.slice(0, 4).join(", ") || "sem lacunas criticas";
  const lines = [
    "Insight proativo rapido com base no CRM:",
    `- Atendimento atual: ${context.totals.callsAnsweredRate}% (${context.totals.callsAnswered}/${context.totals.calls} ligacoes).`,
    `- Horarios sem ligacoes: ${noCalls}.`,
    topHour
      ? `- Melhor janela atual: ${topHour.key} com ${topHour.answeredRate}% de atendimento em ${topHour.total} ligacoes.`
      : "- Ainda nao existe massa critica por horario para comparar janelas com alta confianca.",
    topDay
      ? `- Dia com melhor desempenho: ${topDay.key} (${topDay.answeredRate}% de atendimento).`
      : "- Ainda nao existe massa critica por dia da semana para comparar desempenho.",
    `- Potencial estimado de ganho com ajuste de agenda/comportamento: +${context.opportunity.estimatedUpliftPercent}% (estimativa).`,
    `- Racional: ${context.opportunity.rationale}`,
    'Se quiser acompanhar isso de forma ativa, me diga: "quero acompanhar esse insight".',
  ];

  if (includeApiHint) {
    lines.push(
      "Obs: para respostas com IA generativa completa, configure OPENAI_API_KEY no servidor e use o endpoint /api/assistente/chat.",
    );
  }

  return lines.join("\n");
}

function buildSystemPrompt(context: AssistantContextSummary): string {
  return [
    "Voce e o Assistente ativo do CRM Comercial Pro.",
    "Seu objetivo e propor insights acionaveis, com linguagem objetiva, sempre em portugues do Brasil.",
    "Regras:",
    "1. Nao invente dados fora do contexto.",
    "2. Quando falar de impacto, trate como estimativa e explique o racional.",
    "3. Sempre proponha proximo passo pratico de acompanhamento.",
    "4. Se o usuario pedir para acompanhar um insight, descreva o monitor em formato operacional (metrica, frequencia, alvo, alerta).",
    "Contexto atual do CRM (JSON):",
    JSON.stringify(context),
  ].join("\n");
}

function extractTextFromOpenAIResponse(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const obj = payload as Record<string, unknown>;

  const direct = obj.output_text;
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const output = obj.output;
  if (!Array.isArray(output)) return "";

  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const content = record.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const typed = part as Record<string, unknown>;
      if (typed.type === "output_text" && typeof typed.text === "string") {
        chunks.push(typed.text);
      }
    }
  }

  return chunks.join("\n").trim();
}

async function loadAssistantContextSummary(timezone: string): Promise<AssistantContextSummary> {
  const [calls, leads, customers, meetings, finalizations, wrapups, observations] = await Promise.all([
    getCallLogs(),
    readLeadsCollection(),
    readCustomersCollection(),
    readDataFile<Meeting[]>(MEETINGS_FILE, []),
    readDataFile<LeadFinalizationRecord[]>(LEAD_FINALIZATIONS_FILE, []),
    readDataFile<PostCallWrapup[]>(WRAPUPS_FILE, []),
    getCallAnalysisObservations(),
  ]);

  return buildContextSummary({
    calls: asArray<CallLog>(calls),
    leads: asArray<Lead>(leads),
    customers: asArray<Lead>(customers),
    meetings: asArray<Meeting>(meetings),
    finalizations: asArray<LeadFinalizationRecord>(finalizations),
    wrapups: asArray<PostCallWrapup>(wrapups),
    callAnalysisObservationsCount: Array.isArray(observations) ? observations.length : 0,
    timezone,
  });
}

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  try {
    const body = (await request.json()) as ChatRequestBody;
    const userMessage = String(body.message || "").trim();
    if (!userMessage) {
      return NextResponse.json(
        { success: false, error: "Mensagem obrigatoria." },
        { status: 400 },
      );
    }

    const timezone = String(process.env.CRM_TIMEZONE || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
    const contextSummary = await loadAssistantContextSummary(timezone);
    const conversation = sanitizeConversation(body.conversation);
    const openAiApiKey = String(process.env.OPENAI_API_KEY || "").trim();
    const model = String(process.env.OPENAI_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;

    if (!openAiApiKey) {
      return NextResponse.json({
        success: true,
        source: "fallback",
        message: buildFallbackReply({
          context: contextSummary,
          userMessage,
          includeApiHint: true,
        }),
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openAiApiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.35,
          max_output_tokens: 900,
          input: [
            {
              role: "system",
              content: [
                {
                  type: "input_text",
                  text: buildSystemPrompt(contextSummary),
                },
              ],
            },
            ...conversation.map((item) => ({
              role: item.role,
              content: [{ type: "input_text", text: item.content }],
            })),
            {
              role: "user",
              content: [{ type: "input_text", text: userMessage }],
            },
          ],
        }),
        signal: controller.signal,
        cache: "no-store",
      });

      const raw = (await response.json()) as unknown;
      const assistantText = extractTextFromOpenAIResponse(raw);
      if (!response.ok || !assistantText) {
        throw new Error("OPENAI_RESPONSE_INVALID");
      }

      return NextResponse.json({
        success: true,
        source: "openai",
        message: assistantText,
      });
    } catch (error) {
      console.error(
        "[ASSISTENTE] fallback acionado:",
        error instanceof Error ? error.message : "Erro desconhecido",
      );
      return NextResponse.json({
        success: true,
        source: "fallback",
        message: buildFallbackReply({
          context: contextSummary,
          userMessage,
          includeApiHint: false,
        }),
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return NextResponse.json(
      { success: false, error: "Nao foi possivel processar a mensagem do assistente." },
      { status: 500 },
    );
  }
}

