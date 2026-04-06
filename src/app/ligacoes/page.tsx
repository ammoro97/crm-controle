"use client";

import { Fragment, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { SchedulePicker } from "@/components/agenda/schedule-picker";
import { AgendaBlocks, emptyAgendaBlocks } from "@/components/agenda/agenda-types";
import { useAuth } from "@/components/auth/auth-provider";
import {
  getLeadsSnapshot,
  getMeetingsSnapshot,
  setLeadsSnapshot,
  setMeetingsSnapshot,
  subscribeLeadsSnapshot,
  subscribeMeetingsSnapshot,
} from "@/lib/crm-data-store";
import {
  inferAgendaChannelFromType,
  inferAgendaEventTypeFromNextAction,
  isMeetingActiveForScheduling,
} from "@/lib/agenda-events";
import {
  getLeadEmailItems,
  getLeadPhoneItems,
  getLeadPhones,
  updateLeadEmailItems,
  updateLeadPhoneItems,
} from "@/lib/lead-contact-utils";
import { useResponsaveisRecords } from "@/lib/responsaveis-store";
import { resolveResponsavelFromUserAsync } from "@/lib/responsavel-resolver";
import { getFinalizacaoClassification } from "@/lib/finalizacao-classification";
import {
  ActiveCallSession,
  PostCallWrapup,
  PostCallResultOption,
  PostCallSubfinalizacaoOption,
  clearActiveCallSession,
  detectCallEnd,
  getActiveCallSession,
  getPendingPostCallWrapupsCount,
  getPostCallWrapups,
  markCallSessionEnded,
  markCallSessionWrapped,
  markSessionPrompted,
  reconcileWrapupsWithCallLogs,
  savePostCallWrapup,
  setWrapupSessionState,
  subscribePostCallFlow,
} from "@/lib/post-call-flow";
import { EmailDispatchRequestBody, EmailDispatchResponse, CallFinalization } from "@/types/call-finalization";
import { CallAnalysisStatus, CallLog, Lead, LeadContactQuality, LeadEmail, LeadObservation, LeadPhone, Meeting } from "@/types/crm";

type Api4ComCallItem = {
  id?: string | number;
  uniqueid?: string;
  call_id?: string;
  callid?: string;
  first_name?: string;
  nome?: string;
  empresa?: string;
  telefone?: string;
  to?: string;
  started_at?: string;
  startedAt?: string;
  ended_at?: string;
  endedAt?: string;
  duration?: string | number;
  billsec?: string | number;
  bill_duration?: string | number;
  duration_seconds?: string | number;
  hangup_cause?: string;
  hangupCause?: string;
  record_url?: string;
  recording_url?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

type MappedCall = {
  id: string;
  storeCallId?: string | null;
  leadId?: string | null;
  externalCallId?: string | null;
  sessionId?: string | null;
  nome: string;
  empresa: string;
  telefone: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number;
  status: string;
  finalizacao: string;
  subfinalizacao: string;
  atendente: string;
  origem: string;
  ramal?: string | null;
  aiAnalysis?: string | null;
  analysisStatus?: CallAnalysisStatus;
  processingStatus?: "pending" | "processing" | "done" | "error";
  analysisRequestId?: string | null;
  analysisObservationId?: string | null;
  analysisLeadId?: string | null;
  analysisUpdatedAt?: string | null;
  analysisPreview?: string | null;
  analysisError?: string | null;
  raw: Api4ComCallItem;
};

type CallsApiResponse = {
  ok?: boolean;
  items?: Api4ComCallItem[];
  raw?: unknown;
  error?: string;
};

type InternalCallsApiResponse = {
  success?: boolean;
  calls?: CallLog[];
};

type WebhookOutConfigResponse = {
  success: boolean;
  configured?: boolean;
  error?: string;
  message?: string;
};

type GenerateAnaliseIaResponse = {
  success: boolean;
  message?: string;
  error?: string;
  detail?: string | null;
  code?: string;
  status?: number;
  requestId?: string;
  callId?: string;
};

type ResolveAnaliseIaResponse = {
  success: boolean;
  available?: boolean;
  message?: string;
  error?: string;
  code?: string;
  detail?: string | null;
  analysis?: {
    leadId?: string;
    observationId?: string;
    callId?: string;
  };
};

type AnalysisFeedbackEntry = {
  type: "success" | "error" | "info";
  message: string;
};

type LeadsIndexes = {
  byId: Map<string, Lead>;
  byPhoneDigits: Map<string, Lead>;
};

type PostCallFormState = {
  result: PostCallResultOption;
  reason: "Ja possui CRM e nao tem interesse" | "Outros" | "";
  observations: string;
  nextAction: PostCallSubfinalizacaoOption | "";
  followUpDate: string;
  followUpTime: string;
  company: string;
  primaryEmail: string;
  phoneItems: LeadPhone[];
  emailItems: LeadEmail[];
  newPhoneValue: string;
  newPhoneQuality: LeadContactQuality | "nao_classificado";
  newEmailValue: string;
  newEmailQuality: LeadContactQuality | "nao_classificado";
  sendEmail: boolean;
  emailTarget: string;
  emailMessage: string;
};

type CurrentCallEvidence = {
  id?: string;
  startedAt?: string | null;
  endedAt?: string | null;
  durationSeconds?: number;
  status?: string;
};

type WrapupEmailDispatchOutcome = {
  attempted: boolean;
  success: boolean;
  message?: string;
};

type FollowUpScheduleOutcome = {
  success: boolean;
  message?: string;
};

type WrapupsIndexes = {
  byCallId: Map<string, PostCallWrapup[]>;
  byExternalCallId: Map<string, PostCallWrapup[]>;
  bySessionId: Map<string, PostCallWrapup[]>;
};

type ResponsavelByIdIndex = Map<string, string>;

const postCallResultOptions: Array<{ value: PostCallResultOption; label: string }> = [
  { value: "Ligacao caiu", label: "Ligação caiu" },
  { value: "Caixa postal", label: "Caixa postal" },
  { value: "Ligacao muda", label: "Ligação muda" },
  { value: "Numero invalido", label: "Número inválido" },
  { value: "Pessoa nao conhece", label: "Pessoa não conhece" },
  { value: "Falou com cliente", label: "Falou com cliente" },
  { value: "Falou com secretaria", label: "Falou com secretária" },
];

const POST_CALL_RESULT_VALUES = new Set<PostCallResultOption>(postCallResultOptions.map((option) => option.value));

const baseFinalizacaoOptions = [
  "Todas",
  "Ligação caiu",
  "Caixa postal",
  "Ligação muda",
  "Número inválido",
  "Pessoa não conhece",
  "Falou com cliente",
  "Falou com secretária",
];

const finalizacaoComProximaAcao = new Set<PostCallResultOption>([
  "Falou com cliente",
  "Falou com secretaria",
]);

const nextActionComFollowUp = new Set([
  "Agendar Vídeo Chamada",
  "Agendar Video Chamada",
  "Agendar Ligação",
  "Agendar Ligacao",
  "Agendar WhatsApp",
  "Follow-up",
  "Confirmou possibilidade de contato",
]);

const secondaryOptionsByFinalizacao: Record<"Falou com cliente" | "Falou com secretaria", string[]> = {
  "Falou com cliente": ["Agendar Vídeo Chamada", "Agendar Ligação", "Agendar WhatsApp", "Follow-up", "Sem Interesse"],
  "Falou com secretaria": ["Confirmou possibilidade de contato", "Não houve confirmação"],
};

const OFFICIAL_FINALIZACOES = new Set(baseFinalizacaoOptions.filter((value) => value !== "Todas"));
const HIDDEN_CALL_IDS_STORAGE_KEY = "crm:ligacoes:hidden-call-ids";
const WRAPUP_DRAFT_STORAGE_KEY = "crm:calls:wrapup-draft:v1";
const AGENDA_BLOCKS_STORAGE_KEY = "crm.agenda.blocks.v1";
const WEBHOOK_OUT_LOCAL_STORAGE_KEY = "crm:webhook-out-config:v1";
const LIGACOES_DEBUG_PREFIX = "[LIGACOES_DEBUG]";
const SEM_INTERESSE_SUBFINALIZACAO = "Sem Interesse";

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function normalizeDigits(value?: string | null) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeLookupKey(value?: string | null) {
  return String(value || "").trim().toLowerCase();
}

function getStartedAtMinuteKey(value?: string | null) {
  const startedAt = String(value || "").trim();
  if (!startedAt) return "";
  return startedAt.slice(0, 16);
}

function buildMappedCallLookupKeys(call: MappedCall) {
  const keys: string[] = [];
  const add = (prefix: string, value?: string | null) => {
    const normalized = normalizeLookupKey(value);
    if (!normalized) return;
    keys.push(`${prefix}:${normalized}`);
  };

  add("id", call.id);
  add("store", call.storeCallId);
  add("external", call.externalCallId);
  add("session", call.sessionId);
  if (call.leadId) add("lead", call.leadId);

  const phoneDigits = normalizeDigits(call.telefone);
  const startedAtMinute = getStartedAtMinuteKey(call.startedAt);
  if (phoneDigits && startedAtMinute) {
    keys.push(`phone-minute:${phoneDigits}|${startedAtMinute}`);
    if (call.leadId) {
      keys.push(`lead-phone-minute:${normalizeLookupKey(call.leadId)}|${phoneDigits}|${startedAtMinute}`);
    }
  }

  return Array.from(new Set(keys));
}

function shouldOverlayAnalysisState(current: MappedCall, fallback: MappedCall) {
  const currentPriority = getCallAnalysisPriority(current);
  const fallbackPriority = getCallAnalysisPriority(fallback);
  if (fallbackPriority <= currentPriority) return false;
  return resolveAnalysisStatus(fallback) !== "idle";
}

function mergeAnalysisState(current: MappedCall, fallback: MappedCall): MappedCall {
  return {
    ...current,
    storeCallId: current.storeCallId || fallback.storeCallId || null,
    analysisStatus: fallback.analysisStatus || current.analysisStatus || "idle",
    processingStatus: fallback.processingStatus || current.processingStatus || "pending",
    analysisRequestId: fallback.analysisRequestId || current.analysisRequestId || null,
    analysisObservationId: fallback.analysisObservationId || current.analysisObservationId || null,
    analysisLeadId:
      fallback.analysisLeadId || current.analysisLeadId || current.leadId || fallback.leadId || null,
    analysisUpdatedAt: fallback.analysisUpdatedAt || current.analysisUpdatedAt || null,
    analysisPreview: fallback.analysisPreview || current.analysisPreview || null,
    aiAnalysis: fallback.aiAnalysis || current.aiAnalysis || null,
    analysisError: fallback.analysisError || current.analysisError || null,
  };
}

function buildLeadsIndexes(leads: Lead[]): LeadsIndexes {
  const byId = new Map<string, Lead>();
  const byPhoneDigits = new Map<string, Lead>();

  for (const lead of leads) {
    byId.set(lead.id, lead);
    const digits = normalizeDigits(lead.phone);
    if (digits) byPhoneDigits.set(digits, lead);
  }

  return { byId, byPhoneDigits };
}

function findLeadByPhone(indexes: LeadsIndexes, phoneRaw?: string | null) {
  const digits = normalizeDigits(phoneRaw);
  if (!digits) return null;
  if (indexes.byPhoneDigits.has(digits)) return indexes.byPhoneDigits.get(digits) || null;
  for (const [phone, lead] of indexes.byPhoneDigits.entries()) {
    if (phone.endsWith(digits) || digits.endsWith(phone)) return lead;
  }
  return null;
}

function formatDurationHuman(seconds?: number) {
  const safe = Number(seconds || 0);
  if (!Number.isFinite(safe) || safe <= 0) return "sem duracao registrada";
  const minutes = Math.floor(safe / 60);
  const remaining = safe % 60;
  if (minutes > 0) {
    return `${minutes} minuto${minutes > 1 ? "s" : ""}${remaining > 0 ? ` e ${remaining}s` : ""}`;
  }
  return `${remaining}s`;
}

function polarToCartesian(cx: number, cy: number, radius: number, angleInDegrees: number) {
  const radians = ((angleInDegrees - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  };
}

function buildPieSlicePath(cx: number, cy: number, radius: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y} Z`;
}

function normalizeText(value?: string | null) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function normalizePostCallResultOption(value: unknown): PostCallResultOption {
  const raw = String(value || "").trim();
  if (POST_CALL_RESULT_VALUES.has(raw as PostCallResultOption)) return raw as PostCallResultOption;
  if (normalizeText(raw) === "cliente sem interesse") return "Falou com cliente";
  return "Caixa postal";
}

function normalizeSubfinalizacaoOption(value: unknown): PostCallSubfinalizacaoOption | "" {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const normalized = normalizeText(raw);
  if (normalized === "agendar video chamada") return "Agendar Vídeo Chamada";
  if (normalized === "agendar ligacao") return "Agendar Ligação";
  if (normalized === "agendar whatsapp") return "Agendar WhatsApp";
  if (normalized === "follow-up" || normalized === "follow up") return "Follow-up";
  if (normalized === "sem interesse" || normalized === "cliente sem interesse") return "Sem Interesse";
  if (normalized === "confirmou possibilidade de contato") return "Confirmou possibilidade de contato";
  if (normalized === "nao houve confirmacao") return "Não houve confirmação";

  return "";
}

function isClosingNextAction(nextAction?: string | null) {
  return inferAgendaEventTypeFromNextAction(nextAction) === "call_conversao";
}

function normalizeFinalizacaoLabel(value: string) {
  const normalized = normalizeText(value);
  if (!normalized) return "-";
  if (OFFICIAL_FINALIZACOES.has(value)) return value;

  const legacyMap: Record<string, string> = {
    "falou com cliente": "Falou com cliente",
    "falou com secretaria": "Falou com secretária",
    "cliente sem interesse": "Falou com cliente",
    "falou com a pessoa": "Falou com cliente",
    "era a pessoa errada": "Pessoa não conhece",
    "pessoa errada": "Pessoa não conhece",
    "nao atendeu": "Caixa postal",
    "não atendeu": "Caixa postal",
    "caixa postal": "Caixa postal",
    "numero invalido": "Número inválido",
    "número inválido": "Número inválido",
    "ligacao caiu": "Ligação caiu",
    "ligação caiu": "Ligação caiu",
    "ligacao muda": "Ligação muda",
    "ligação muda": "Ligação muda",
    "pediu retorno": "Falou com cliente",
    "deixou recado": "Falou com secretária",
    outro: "Falou com cliente",
    falou_com_pessoa: "Falou com cliente",
    pessoa_errada: "Pessoa não conhece",
    nao_atendeu: "Caixa postal",
    caixa_postal: "Caixa postal",
    numero_invalido: "Número inválido",
    ligacao_caiu: "Ligação caiu",
    ligacao_muda: "Ligação muda",
    pediu_retorno: "Falou com cliente",
    deixou_recado: "Falou com secretária",
    cliente_sem_interesse: "Falou com cliente",
  };

  return legacyMap[normalized] || "-";
}

function resolveWrapupSubfinalizacaoLabel(wrapup?: PostCallWrapup): string {
  if (!wrapup) return "-";
  const explicit = String(wrapup.nextAction || "").trim();
  if (explicit) return explicit;
  if (normalizeText(wrapup.result) === "cliente sem interesse") return SEM_INTERESSE_SUBFINALIZACAO;
  return "-";
}

function pushIndexedWrapup(index: Map<string, PostCallWrapup[]>, key: string, wrapup: PostCallWrapup) {
  if (!key) return;
  const current = index.get(key) || [];
  current.push(wrapup);
  index.set(key, current);
}

function buildWrapupsIndexes(wrapups: PostCallWrapup[]): WrapupsIndexes {
  const byCallId = new Map<string, PostCallWrapup[]>();
  const byExternalCallId = new Map<string, PostCallWrapup[]>();
  const bySessionId = new Map<string, PostCallWrapup[]>();

  const ordered = [...wrapups].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const wrapup of ordered) {
    pushIndexedWrapup(byCallId, String(wrapup.callId || "").trim(), wrapup);
    pushIndexedWrapup(byExternalCallId, String(wrapup.externalCallId || "").trim(), wrapup);
    pushIndexedWrapup(bySessionId, String(wrapup.sessionId || "").trim(), wrapup);
  }

  return { byCallId, byExternalCallId, bySessionId };
}

function getUniqueWrapup(index: Map<string, PostCallWrapup[]>, key?: string | null): PostCallWrapup | undefined {
  const normalized = String(key || "").trim();
  if (!normalized) return undefined;
  const matches = index.get(normalized) || [];
  if (matches.length === 0) return undefined;
  if (matches.length > 1) {
    console.warn(`${LIGACOES_DEBUG_PREFIX} WRAPUP_DUPLICATE_KEY`, {
      key: normalized,
      candidates: matches.map((item) => ({
        wrapupId: item.id,
        sessionId: item.sessionId,
        externalCallId: item.externalCallId || null,
        callId: item.callId || null,
        createdAt: item.createdAt,
      })),
      selectedWrapupId: matches[0].id,
    });
  }
  return matches[0];
}

function isTechnicalAnswered(status: string, durationSeconds: number) {
  if (durationSeconds <= 0) return false;
  const normalized = normalizeText(status);
  if (!normalized) return true;

  const blockedTokens = ["cancel", "number changed", "unallocated number", "nao atendida", "sem resposta", "ocupado", "busy"];
  if (blockedTokens.some((token) => normalized.includes(token))) return false;
  return true;
}

function nowDateAndTime() {
  const now = new Date();
  return {
    date: now.toISOString().slice(0, 10),
    time: now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    dateTime: now.toISOString(),
  };
}

function normalizeLeadContactQuality(value: unknown): LeadContactQuality | undefined {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "bom" || normalized === "ruim") return normalized;
  return undefined;
}

function normalizeContactQualitySelection(value: unknown): LeadContactQuality | "nao_classificado" {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "bom" || normalized === "ruim") return normalized;
  return "nao_classificado";
}

function toLeadContactQuality(value: LeadContactQuality | "nao_classificado"): LeadContactQuality | undefined {
  return value === "nao_classificado" ? undefined : value;
}

function normalizeLeadPhoneItemsForDraft(items: unknown): LeadPhone[] {
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  const normalized: LeadPhone[] = [];
  for (const item of items) {
    const value = String((item as LeadPhone | undefined)?.value || "").trim();
    if (!value) continue;
    const key = normalizeDigits(value) || value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const quality = normalizeLeadContactQuality((item as LeadPhone | undefined)?.quality);
    normalized.push({
      value,
      ...(quality ? { quality } : {}),
    });
  }
  return normalized;
}

function normalizeLeadEmailItemsForDraft(items: unknown): LeadEmail[] {
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  const normalized: LeadEmail[] = [];
  for (const item of items) {
    const value = String((item as LeadEmail | undefined)?.value || "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const quality = normalizeLeadContactQuality((item as LeadEmail | undefined)?.quality);
    normalized.push({
      value,
      ...(quality ? { quality } : {}),
    });
  }
  return normalized;
}

function findLeadIndexForSession(leads: Lead[], session: ActiveCallSession): number {
  const sessionPhone = normalizeDigits(session.telefone);
  return leads.findIndex((lead) => {
    if (session.leadId && lead.id === session.leadId) return true;
    const phones = getLeadPhones(lead).map((phone) => normalizeDigits(phone));
    return phones.some((phone) => Boolean(phone && sessionPhone && (phone.endsWith(sessionPhone) || sessionPhone.endsWith(phone))));
  });
}

function buildInitialPhoneItemsForSession(session: ActiveCallSession, lead?: Lead | null): LeadPhone[] {
  const fromLead = lead ? getLeadPhoneItems(lead) : [];
  if (fromLead.length > 0) return fromLead;
  const fallbackPhone = String(session.telefone || "").trim();
  return fallbackPhone ? [{ value: fallbackPhone }] : [];
}

function buildInitialEmailItemsForSession(lead?: Lead | null): LeadEmail[] {
  if (!lead) return [];
  return getLeadEmailItems(lead);
}

function mergePrimaryEmailIntoItems(primaryEmail: string, items: LeadEmail[]): LeadEmail[] {
  const cleanedPrimary = String(primaryEmail || "").trim();
  const normalizedItems = normalizeLeadEmailItemsForDraft(items);
  if (!cleanedPrimary) return normalizedItems;

  const existingIndex = normalizedItems.findIndex(
    (item) => String(item.value || "").trim().toLowerCase() === cleanedPrimary.toLowerCase(),
  );
  if (existingIndex === 0) {
    const firstItem = normalizedItems[0];
    return [
      {
        value: cleanedPrimary,
        ...(firstItem?.quality ? { quality: firstItem.quality } : {}),
      },
      ...normalizedItems.slice(1),
    ];
  }
  if (existingIndex > 0) {
    const existing = normalizedItems[existingIndex];
    const rest = normalizedItems.filter((_, index) => index !== existingIndex);
    return [
      {
        value: cleanedPrimary,
        ...(existing?.quality ? { quality: existing.quality } : {}),
      },
      ...rest,
    ];
  }
  return [{ value: cleanedPrimary }, ...normalizedItems];
}

function createDefaultPostCallForm(): PostCallFormState {
  return {
    reason: "",
    result: "Caixa postal",
    observations: "",
    nextAction: "",
    followUpDate: "",
    followUpTime: "",
    company: "",
    primaryEmail: "",
    phoneItems: [],
    emailItems: [],
    newPhoneValue: "",
    newPhoneQuality: "nao_classificado",
    newEmailValue: "",
    newEmailQuality: "nao_classificado",
    sendEmail: false,
    emailTarget: "",
    emailMessage: "",
  };
}

function getSuggestedNextActionByFinalizacao(result: PostCallResultOption): string {
  if (result === "Falou com cliente") return "Agendar Vídeo Chamada";
  if (result === "Falou com secretaria") return "Confirmou possibilidade de contato";
  return "";
}

function formatDate(value?: string | null) {
  if (!value || typeof value !== "string") return "-";
  const raw = value.trim();
  if (!raw) return "-";

  const [datePartRaw] = raw.split("T");
  const dateOnly = (datePartRaw || "").split(" ")[0] || "";
  const [yyyy = "", mm = "", dd = ""] = dateOnly.split("-");

  if (!yyyy || !mm || !dd) return "-";
  return `${dd}/${mm}/${yyyy}`;
}

function formatTime(value?: string | null) {
  if (!value || typeof value !== "string") return "-";
  const raw = value.trim();
  if (!raw) return "-";

  const [, timePartRaw = ""] = raw.split("T");
  const timeClean = timePartRaw.replace("Z", "").trim();
  if (timeClean.length < 5) return "-";

  return timeClean.length >= 8 ? timeClean.slice(0, 8) : timeClean.slice(0, 5);
}

function formatDuration(seconds?: number) {
  const totalSeconds = Number(seconds || 0);
  const safe = Number.isFinite(totalSeconds) ? totalSeconds : 0;
  const minutes = Math.floor(safe / 60);
  const restSeconds = safe % 60;
  return `${minutes.toString().padStart(2, "0")}:${restSeconds.toString().padStart(2, "0")}`;
}

function getCallRecordingUrl(call: MappedCall): string | null {
  if (typeof call.raw.recording_url === "string" && call.raw.recording_url.trim()) {
    return call.raw.recording_url.trim();
  }
  if (typeof call.raw.record_url === "string" && call.raw.record_url.trim()) {
    return call.raw.record_url.trim();
  }
  return null;
}

type WebhookOutClientConfig = {
  url: string;
  secret: string;
};

function normalizeWebhookOutUrlInput(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^ps:\/\//i.test(raw)) return `https://${raw.slice(5)}`;
  if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(raw)) return `https://${raw}`;
  return raw;
}

function isValidHttpUrl(value?: string | null) {
  const url = String(value || "").trim();
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function readWebhookOutClientConfig(): WebhookOutClientConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(WEBHOOK_OUT_LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { url?: string; secret?: string };
    const url = normalizeWebhookOutUrlInput(parsed.url);
    if (!isValidHttpUrl(url)) return null;
    return {
      url,
      secret: String(parsed.secret || "").trim(),
    };
  } catch {
    return null;
  }
}

function parseDuration(value: unknown): number {
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber >= 0) return asNumber;
  // Parse HH:MM:SS or MM:SS string format (API4com returns "00:00:06")
  if (typeof value === "string") {
    const parts = value.trim().split(":");
    if (parts.length === 3) {
      const h = Number(parts[0]);
      const m = Number(parts[1]);
      const s = Number(parts[2]);
      if (Number.isFinite(h) && Number.isFinite(m) && Number.isFinite(s)) {
        return h * 3600 + m * 60 + s;
      }
    }
    if (parts.length === 2) {
      const m = Number(parts[0]);
      const s = Number(parts[1]);
      if (Number.isFinite(m) && Number.isFinite(s)) {
        return m * 60 + s;
      }
    }
  }
  return 0;
}

function parseDateMaybe(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim();
}

function readHiddenCallIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(HIDDEN_CALL_IDS_STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map((item) => String(item || "").trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

function writeHiddenCallIds(ids: Set<string>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(HIDDEN_CALL_IDS_STORAGE_KEY, JSON.stringify(Array.from(ids)));
}

function readAgendaBlocksFromStorage(): AgendaBlocks {
  if (typeof window === "undefined") return emptyAgendaBlocks;
  try {
    const raw = window.localStorage.getItem(AGENDA_BLOCKS_STORAGE_KEY);
    if (!raw) return emptyAgendaBlocks;
    const parsed = JSON.parse(raw) as AgendaBlocks;
    return {
      recurringWeekdayBlocks: parsed.recurringWeekdayBlocks || [],
      specificDateBlocks: parsed.specificDateBlocks || [],
      periodBlocks: parsed.periodBlocks || [],
      specificTimeBlocks: parsed.specificTimeBlocks || [],
    };
  } catch {
    return emptyAgendaBlocks;
  }
}

function readWrapupDraft(sessionId: string): PostCallFormState | null {
  if (typeof window === "undefined" || !sessionId) return null;
  try {
    const raw = window.localStorage.getItem(WRAPUP_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, PostCallFormState | undefined>;
    const value = parsed[sessionId];
    if (!value) return null;
    const normalizedResult = normalizePostCallResultOption(value.result);
    const normalizedSubfinalizacao = normalizeSubfinalizacaoOption(value.nextAction);
    const normalizedReason =
      normalizedResult === "Falou com cliente" && normalizedSubfinalizacao === "Sem Interesse"
        ? value.reason || ""
        : "";
    return {
      reason: normalizedReason as "Ja possui CRM e nao tem interesse" | "Outros" | "",
      result: normalizedResult,
      observations: value.observations || "",
      nextAction: normalizedSubfinalizacao,
      followUpDate: value.followUpDate || "",
      followUpTime: value.followUpTime || "",
      company: String((value as { company?: string } | undefined)?.company || ""),
      primaryEmail: String((value as { primaryEmail?: string } | undefined)?.primaryEmail || ""),
      phoneItems: normalizeLeadPhoneItemsForDraft(value.phoneItems),
      emailItems: normalizeLeadEmailItemsForDraft(value.emailItems),
      newPhoneValue: String(value.newPhoneValue || "").trim(),
      newPhoneQuality: normalizeContactQualitySelection(value.newPhoneQuality),
      newEmailValue: String(value.newEmailValue || "").trim(),
      newEmailQuality: normalizeContactQualitySelection(value.newEmailQuality),
      sendEmail: Boolean(value.sendEmail),
      emailTarget: String(value.emailTarget || "").trim(),
      emailMessage: String(value.emailMessage || ""),
    };
  } catch {
    return null;
  }
}

function writeWrapupDraft(sessionId: string, form: PostCallFormState) {
  if (typeof window === "undefined" || !sessionId) return;
  try {
    const raw = window.localStorage.getItem(WRAPUP_DRAFT_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, PostCallFormState>) : {};
    parsed[sessionId] = form;
    window.localStorage.setItem(WRAPUP_DRAFT_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // noop
  }
}

function clearWrapupDraft(sessionId: string) {
  if (typeof window === "undefined" || !sessionId) return;
  try {
    const raw = window.localStorage.getItem(WRAPUP_DRAFT_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, PostCallFormState>;
    if (!parsed[sessionId]) return;
    delete parsed[sessionId];
    window.localStorage.setItem(WRAPUP_DRAFT_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // noop
  }
}

function humanizeHangupCause(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "Não atendida";
  const lower = normalized.toLowerCase();

  if (lower.includes("busy")) return "Ocupado";
  if (lower.includes("cancel")) return "Cancelada";
  if (lower.includes("no answer") || lower.includes("no-answer")) return "Sem resposta";
  if (lower.includes("normal") || lower === "atendida") return "Atendida";

  return normalized
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function mapApiCallToRow(
  item: Api4ComCallItem,
  index: number,
  context: {
    leadsIndexes: LeadsIndexes;
    internalByLookup: Map<string, CallLog>;
    wrapupsIndexes: WrapupsIndexes;
    responsavelById: ResponsavelByIdIndex;
  },
): MappedCall {
  const startedAt = parseDateMaybe(item.started_at ?? item.startedAt);
  const endedAt = parseDateMaybe(item.ended_at ?? item.endedAt);
  const durationRaw = item.duration ?? item.billsec ?? item.bill_duration ?? item.duration_seconds;
  const durationSeconds = parseDuration(durationRaw);
  const rawStatus = String(item.hangup_cause ?? item.hangupCause ?? "").trim();
  const status = rawStatus ? humanizeHangupCause(rawStatus) : durationSeconds > 0 ? "Atendida" : "Não atendida";
  const rawCallId = String(item.call_id ?? item.callid ?? item.uniqueid ?? "").trim();
  const rawRowId = String(item.id ?? "").trim();
  const rawId = rawCallId || rawRowId;
  const fallbackLookupId = `api4com-${normalizeDigits(String(item.telefone ?? item.to ?? "semfone"))}-${(startedAt || String(index)).replace(/[^0-9A-Za-z_-]/g, "")}`;
  const callLookupId = rawId || fallbackLookupId;
  const metadata =
    item.metadata && typeof item.metadata === "object" ? (item.metadata as Record<string, unknown>) : null;
  const metadataLeadId = String(metadata?.leadId ?? "").trim();
  const metadataNome = String(metadata?.nome ?? "").trim();
  const metadataEmpresa = String(metadata?.empresa ?? "").trim();
  const metadataTelefone = String(metadata?.telefone ?? "").trim();
  const metadataResponsavelId = String(metadata?.responsavelId ?? "").trim();
  const metadataSessionId = String(metadata?.sessionId ?? "").trim();
  const metadataCallId = String(metadata?.callId ?? metadata?.callid ?? "").trim();
  const metadataExternalCallId = String(metadata?.externalCallId ?? metadata?.external_call_id ?? metadataCallId).trim();
  const metadataGateway = String(metadata?.gateway ?? "").trim();
  const rowPhoneDigits = normalizeDigits(metadataTelefone || item.telefone || item.to || "");
  const rowStartedAtMinute = getStartedAtMinuteKey(startedAt);

  const internalLookupCandidates = Array.from(
    new Set([
      callLookupId,
      rawCallId,
      rawRowId,
      rawId,
      metadataCallId,
      metadataExternalCallId,
      metadataSessionId,
      String(item.call_id ?? "").trim(),
      String(item.callid ?? "").trim(),
      String(item.uniqueid ?? "").trim(),
      String(item.id ?? "").trim(),
      rowPhoneDigits && rowStartedAtMinute ? `phone-minute:${rowPhoneDigits}|${rowStartedAtMinute}` : "",
      metadataLeadId && rowPhoneDigits && rowStartedAtMinute
        ? `lead-phone-minute:${metadataLeadId}|${rowPhoneDigits}|${rowStartedAtMinute}`
        : "",
    ].filter(Boolean)),
  );
  let internal: CallLog | undefined;
  for (const key of internalLookupCandidates) {
    const found = context.internalByLookup.get(normalizeLookupKey(key));
    if (found) {
      internal = found;
      break;
    }
  }
  const leadFromId =
    (metadataLeadId ? context.leadsIndexes.byId.get(metadataLeadId) : undefined) ||
    (internal?.leadId ? context.leadsIndexes.byId.get(internal.leadId) : undefined);
  const leadFromPhone =
    findLeadByPhone(context.leadsIndexes, metadataTelefone || item.telefone || item.to || internal?.telefone || internal?.called) ||
    null;
  const linkedLead = leadFromId || leadFromPhone || null;

  const resolvedNome =
    linkedLead?.name ||
    internal?.nome ||
    metadataNome ||
    String(item.first_name ?? item.nome ?? "-").trim() ||
    "-";
  const resolvedEmpresa =
    linkedLead?.company || internal?.empresa || metadataEmpresa || String(item.empresa ?? "-").trim() || "-";
  const resolvedTelefone =
    linkedLead?.phone ||
    internal?.telefone ||
    metadataTelefone ||
    String(item.telefone ?? item.to ?? "-").trim() ||
    "-";
  // When live API data shows duration > 0, the call was answered — don't let a
  // stale internal record (written by webhook before the HH:MM:SS parse fix) override it.
  const internalStatusWrong =
    durationSeconds > 0 &&
    (internal?.status === "Nao atendida" || internal?.status === "Não atendida");
  const resolvedStatus = internalStatusWrong ? status : (internal?.status || status);
  const resolvedStartedAt = internal?.startedAt || startedAt;

  let matchSource: "sessionId" | "externalCallId" | "callId" | null = null;
  let matchedWrapup: PostCallWrapup | undefined;

  const sessionIdCandidate = metadataSessionId || internal?.sessionId || "";
  if (sessionIdCandidate) {
    matchedWrapup = getUniqueWrapup(context.wrapupsIndexes.bySessionId, sessionIdCandidate);
    if (matchedWrapup) matchSource = "sessionId";
  }

  if (!matchedWrapup && rawId) {
    matchedWrapup = getUniqueWrapup(context.wrapupsIndexes.byExternalCallId, rawId);
    if (matchedWrapup) matchSource = "externalCallId";
  }

  if (!matchedWrapup && metadataExternalCallId) {
    matchedWrapup =
      getUniqueWrapup(context.wrapupsIndexes.byExternalCallId, metadataExternalCallId) ||
      getUniqueWrapup(context.wrapupsIndexes.byCallId, metadataExternalCallId);
    if (matchedWrapup) matchSource = "externalCallId";
  }

  if (!matchedWrapup && rawId) {
    matchedWrapup = getUniqueWrapup(context.wrapupsIndexes.byCallId, rawId);
    if (matchedWrapup) matchSource = "callId";
  }

  if (!matchedWrapup && internal?.id) {
    matchedWrapup = getUniqueWrapup(context.wrapupsIndexes.byCallId, internal.id);
    if (matchedWrapup) matchSource = "callId";
  }

  if (matchedWrapup) {
    console.log(`${LIGACOES_DEBUG_PREFIX} TABLE_ROW_MATCH`, {
      tableCallId: callLookupId || internal?.id || null,
      sessionIdCandidate: sessionIdCandidate || null,
      metadataExternalCallId: metadataExternalCallId || null,
      wrapupId: matchedWrapup.id,
      wrapupCallId: matchedWrapup.callId || null,
      wrapupSessionId: matchedWrapup.sessionId,
      source: matchSource,
    });
  }

  const finalizacao = matchedWrapup ? normalizeFinalizacaoLabel(matchedWrapup.result) : "-";
  const subfinalizacao = resolveWrapupSubfinalizacaoLabel(matchedWrapup);
  const atendenteFromWrapupResponsavelId =
    matchedWrapup?.responsavelId ? context.responsavelById.get(matchedWrapup.responsavelId) : undefined;
  const atendenteFromResponsavelId = metadataResponsavelId
    ? context.responsavelById.get(metadataResponsavelId)
    : undefined;
  const atendente =
    atendenteFromWrapupResponsavelId ||
    atendenteFromResponsavelId ||
    "Responsável não vinculado";

  return {
    id:
      rawCallId ||
      rawRowId ||
      `api4com-${normalizeDigits(resolvedTelefone || metadataTelefone || item.telefone || item.to || "semfone")}-${(resolvedStartedAt || startedAt || String(index)).replace(/[^0-9A-Za-z_-]/g, "")}`,
    storeCallId: internal?.id || null,
    leadId: linkedLead?.id || internal?.leadId || metadataLeadId || null,
    externalCallId: rawCallId || metadataExternalCallId || internal?.externalCallId || rawRowId || null,
    sessionId: sessionIdCandidate || internal?.sessionId || null,
    nome: resolvedNome,
    empresa: resolvedEmpresa,
    telefone: resolvedTelefone,
    startedAt: resolvedStartedAt,
    endedAt: internal?.endedAt || endedAt,
    durationSeconds: Number(internal?.durationSeconds || durationSeconds),
    status: resolvedStatus,
    finalizacao,
    subfinalizacao,
    atendente,
    origem: "api4com",
    ramal: metadataGateway || internal?.gateway || null,
    aiAnalysis: internal?.aiAnalysis || null,
    analysisStatus: internal?.analysisStatus || "idle",
    processingStatus: internal?.processingStatus || "pending",
    analysisRequestId: internal?.analysisRequestId || null,
    analysisObservationId: internal?.analysisObservationId || null,
    analysisLeadId: internal?.analysisLeadId || internal?.leadId || linkedLead?.id || null,
    analysisUpdatedAt: internal?.analysisUpdatedAt || internal?.updatedAt || internal?.createdAt || null,
    analysisPreview: internal?.analysisPreview || null,
    analysisError: internal?.analysisError || null,
    raw: item,
  };
}

function resolveAnalysisStatus(call: {
  analysisStatus?: string | null;
}): CallAnalysisStatus {
  const explicit = String(call.analysisStatus || "").trim().toLowerCase();
  if (explicit === "processing") return "processing";
  if (explicit === "done") return "done";
  if (explicit === "error") return "error";
  if (explicit === "idle") return "idle";
  return "idle";
}

function getPersistedAnalysisObservationId(call: MappedCall): string {
  return String(call.analysisObservationId || "").trim();
}

function isAnalysisReady(call: MappedCall): boolean {
  const status = resolveAnalysisStatus(call);
  if (status !== "done") return false;
  return Boolean(getPersistedAnalysisObservationId(call));
}

function getCallAnalysisPriority(input: {
  analysisStatus?: string | null;
  analysisObservationId?: string | null;
  aiAnalysis?: string | null;
}) {
  let score = 0;
  if (String(input.analysisObservationId || "").trim()) score += 100;
  const status = resolveAnalysisStatus({
    analysisStatus: (input.analysisStatus as CallAnalysisStatus | undefined) || undefined,
  });
  if (status === "done") score += 90;
  if (status === "processing") score += 30;
  if (status === "error") score += 10;
  if (String(input.aiAnalysis || "").trim()) score += 80;
  return score;
}

function getCallSortReference(input: {
  updatedAt?: string | null;
  endedAt?: string | null;
  startedAt?: string | null;
  createdAt?: string | null;
}) {
  return String(input.updatedAt || input.endedAt || input.startedAt || input.createdAt || "");
}

function shouldReplaceLookupRecord(current: CallLog, incoming: CallLog) {
  const currentScore = getCallAnalysisPriority(current);
  const incomingScore = getCallAnalysisPriority(incoming);
  if (incomingScore !== currentScore) return incomingScore > currentScore;

  const currentRef = getCallSortReference(current);
  const incomingRef = getCallSortReference(incoming);
  if (incomingRef !== currentRef) return incomingRef > currentRef;

  return false;
}

function mapInternalCallToRow(
  item: CallLog,
  context: {
    leadsIndexes: LeadsIndexes;
    wrapupsIndexes: WrapupsIndexes;
    responsavelById: ResponsavelByIdIndex;
  },
): MappedCall {
  const linkedLead = item.leadId ? context.leadsIndexes.byId.get(item.leadId) : null;
  let matchedWrapup: PostCallWrapup | undefined =
    (item.sessionId ? getUniqueWrapup(context.wrapupsIndexes.bySessionId, item.sessionId) : undefined) ||
    (item.externalCallId ? getUniqueWrapup(context.wrapupsIndexes.byExternalCallId, item.externalCallId) : undefined) ||
    getUniqueWrapup(context.wrapupsIndexes.byCallId, item.id);

  if (matchedWrapup) {
    console.log(`${LIGACOES_DEBUG_PREFIX} TABLE_ROW_MATCH`, {
      tableCallId: item.id,
      sessionIdCandidate: item.sessionId || null,
      metadataExternalCallId: item.externalCallId || null,
      wrapupId: matchedWrapup.id,
      wrapupCallId: matchedWrapup.callId || null,
      wrapupSessionId: matchedWrapup.sessionId,
      source: "internal-call-map",
    });
  }

  const finalizacao = matchedWrapup ? normalizeFinalizacaoLabel(matchedWrapup.result) : "-";
  const subfinalizacao = resolveWrapupSubfinalizacaoLabel(matchedWrapup);
  const atendenteFromWrapupResponsavelId =
    matchedWrapup?.responsavelId ? context.responsavelById.get(matchedWrapup.responsavelId) : undefined;

  return {
    id: item.id,
    storeCallId: item.id,
    leadId: linkedLead?.id || item.leadId || null,
    externalCallId: item.externalCallId || null,
    sessionId: item.sessionId || null,
    nome: linkedLead?.name || item.nome || "-",
    empresa: linkedLead?.company || item.empresa || "-",
    telefone: linkedLead?.phone || item.telefone || item.called || item.caller || "-",
    startedAt: item.startedAt || null,
    endedAt: item.endedAt || null,
    durationSeconds: Number(item.durationSeconds || 0),
    status: item.status || "Não atendida",
    finalizacao,
    subfinalizacao,
    atendente: atendenteFromWrapupResponsavelId || "Responsável não vinculado",
    origem: "interna",
    ramal: item.gateway || null,
    aiAnalysis: item.aiAnalysis || null,
    analysisStatus: item.analysisStatus || "idle",
    processingStatus: item.processingStatus || "pending",
    analysisRequestId: item.analysisRequestId || null,
    analysisObservationId: item.analysisObservationId || null,
    analysisLeadId: item.analysisLeadId || item.leadId || linkedLead?.id || null,
    analysisUpdatedAt: item.analysisUpdatedAt || item.updatedAt || item.createdAt || null,
    analysisPreview: item.analysisPreview || null,
    analysisError: item.analysisError || null,
    raw: {
      record_url: item.recordUrl || undefined,
      hangup_cause: item.hangupCause || undefined,
      metadata: item.gateway ? { gateway: item.gateway } : undefined,
    },
  };
}

function formatTotalTime(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatAverageTime(totalSeconds: number, count: number) {
  if (count <= 0) return "0s";
  const avg = Math.floor(totalSeconds / count);
  const minutes = Math.floor(avg / 60);
  const seconds = avg % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m${seconds.toString().padStart(2, "0")}s`;
}

function normalizeFinalizacaoKey(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

const CPC_POSITIVE_FINALIZACOES = new Set(["falou com cliente"]);
const CPC_NEGATIVE_FINALIZACOES = ["cliente sem interesse", "cliente nao tem interesse"];
const CPC_NEGATIVE_SUBFINALIZACOES = new Set(["sem interesse"]);
const IMPRODUTIVE_FINALIZACOES = new Set([
  "nao atendeu",
  "caixa postal",
  "ligacao caiu",
  "ligacao muda",
  "numero invalido",
  "pessoa nao conhece",
]);
const FOLLOWUP_VALID_SUBFINALIZACOES = new Set([
  "agendar ligacao",
  "agendar whatsapp",
]);
const FOLLOWUP_VALID_FINALIZACOES = new Set(["falou com cliente", "falou com secretaria"]);

function hasFinalizacaoKeyword(value: string, keywords: string[]) {
  return keywords.some((keyword) => value.includes(keyword));
}

type FinalizacaoTipo =
  | "falou_com_cliente"
  | "pessoa_nao_conhece"
  | "falou_com_secretaria"
  | "numero_invalido"
  | "caixa_postal"
  | "ligacao_caiu"
  | "ligacao_muda"
  | "cliente_sem_interesse"
  | "outros";

type FinalizacaoUiConfig = {
  label: string;
  hex: string;
  barClass: string;
  ringClass: string;
  badgeClass: string;
};

const FINALIZACAO_UI: Record<FinalizacaoTipo, FinalizacaoUiConfig> = {
  falou_com_cliente: {
    label: "Falou com cliente",
    hex: "#10b981",
    barClass: "bg-emerald-500",
    ringClass: "stroke-emerald-500",
    badgeClass: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/35",
  },
  pessoa_nao_conhece: {
    label: "Pessoa não conhece",
    hex: "#3b82f6",
    barClass: "bg-blue-500",
    ringClass: "stroke-blue-500",
    badgeClass: "bg-blue-500/15 text-blue-300 border border-blue-500/35",
  },
  falou_com_secretaria: {
    label: "Falou com secretária",
    hex: "#f59e0b",
    barClass: "bg-amber-500",
    ringClass: "stroke-amber-500",
    badgeClass: "bg-amber-500/15 text-amber-300 border border-amber-500/35",
  },
  numero_invalido: {
    label: "Número inválido",
    hex: "#f43f5e",
    barClass: "bg-rose-500",
    ringClass: "stroke-rose-500",
    badgeClass: "bg-rose-500/15 text-rose-300 border border-rose-500/35",
  },
  caixa_postal: {
    label: "Caixa postal",
    hex: "#eab308",
    barClass: "bg-yellow-500",
    ringClass: "stroke-yellow-500",
    badgeClass: "bg-yellow-500/15 text-yellow-300 border border-yellow-500/35",
  },
  ligacao_caiu: {
    label: "Ligação caiu",
    hex: "#8b5cf6",
    barClass: "bg-violet-500",
    ringClass: "stroke-violet-500",
    badgeClass: "bg-violet-500/15 text-violet-300 border border-violet-500/35",
  },
  ligacao_muda: {
    label: "Ligação muda",
    hex: "#06b6d4",
    barClass: "bg-cyan-500",
    ringClass: "stroke-cyan-500",
    badgeClass: "bg-cyan-500/15 text-cyan-300 border border-cyan-500/35",
  },
  cliente_sem_interesse: {
    label: "Cliente sem interesse",
    hex: "#f97316",
    barClass: "bg-orange-500",
    ringClass: "stroke-orange-500",
    badgeClass: "bg-orange-500/15 text-orange-300 border border-orange-500/35",
  },
  outros: {
    label: "Outros",
    hex: "#64748b",
    barClass: "bg-slate-500",
    ringClass: "stroke-slate-500",
    badgeClass: "bg-slate-700/30 text-slate-300 border border-slate-600/60",
  },
};

function getFinalizacaoTipo(label: string): FinalizacaoTipo {
  const normalized = normalizeFinalizacaoKey(label);
  if (normalized === "outros" || normalized === "sem finalizacao") return "outros";
  if (normalized.includes("falou com cliente")) return "falou_com_cliente";
  if (normalized.includes("pessoa nao conhece")) return "pessoa_nao_conhece";
  if (normalized.includes("falou com secretaria")) return "falou_com_secretaria";
  if (normalized.includes("numero invalido")) return "numero_invalido";
  if (normalized.includes("caixa postal")) return "caixa_postal";
  if (normalized.includes("ligacao caiu")) return "ligacao_caiu";
  if (normalized.includes("ligacao muda")) return "ligacao_muda";
  if (normalized.includes("cliente sem interesse")) return "cliente_sem_interesse";
  return "outros";
}

function getFinalizacaoUi(label: string) {
  return FINALIZACAO_UI[getFinalizacaoTipo(label)];
}

function finalizacaoBarColor(label: string) {
  return getFinalizacaoUi(label).barClass;
}

function normalizeMeetingPersonName(value?: string) {
  return String(value || "").trim().toLowerCase();
}

function statusBadgeClass(status?: string) {
  const normalized = (status || "").toLowerCase();
  if (normalized === "atendida") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  if (normalized === "nao atendida" || normalized === "não atendida" || normalized === "sem resposta") return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  if (normalized === "ocupado") return "border-sky-500/40 bg-sky-500/10 text-sky-300";
  return "border-rose-500/40 bg-rose-500/10 text-rose-300";
}

function contactQualityLabel(quality?: LeadContactQuality) {
  if (quality === "bom") return "Bom";
  if (quality === "ruim") return "Ruim";
  return "Nao classificado";
}

function contactQualityBadgeClass(quality?: LeadContactQuality) {
  if (quality === "bom") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  if (quality === "ruim") return "border-rose-500/40 bg-rose-500/10 text-rose-300";
  return "border-amber-500/40 bg-amber-500/10 text-amber-200";
}

function contactQualityControlClass(
  current: LeadContactQuality | undefined,
  option: LeadContactQuality | "nao_classificado",
) {
  const isSelected =
    option === "nao_classificado" ? !current : current === option;
  if (isSelected && option === "bom") return "bg-emerald-500/20 text-emerald-200";
  if (isSelected && option === "ruim") return "bg-rose-500/20 text-rose-200";
  if (isSelected && option === "nao_classificado") return "bg-slate-700/80 text-slate-100";
  return "bg-slate-950/70 text-slate-400 hover:bg-slate-800/80";
}

export default function LigacoesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentUser } = useAuth();
  const responsaveisRecords = useResponsaveisRecords();
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [calls, setCalls] = useState<MappedCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [leadsSnapshot, setLeadsSnapshotState] = useState<Lead[]>(() => getLeadsSnapshot());
  const [meetingsSnapshot, setMeetingsSnapshotState] = useState<Meeting[]>(() => getMeetingsSnapshot());
  const [internalById, setInternalById] = useState<Map<string, CallLog>>(new Map());
  const [wrapups, setWrapups] = useState<PostCallWrapup[]>(() => getPostCallWrapups());
  const [finalizacaoFilter, setFinalizacaoFilter] = useState("Todas");
  const [atendenteFilter, setAtendenteFilter] = useState("Todos");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [webhookOutConfigured, setWebhookOutConfigured] = useState(false);
  const [webhookOutLoading, setWebhookOutLoading] = useState(true);
  const [webhookOutError, setWebhookOutError] = useState<string | null>(null);
  const [analysisLoadingCallId, setAnalysisLoadingCallId] = useState<string | null>(null);
  const [viewAnalysisLoadingCallId, setViewAnalysisLoadingCallId] = useState<string | null>(null);
  const [analysisFeedbackByCallId, setAnalysisFeedbackByCallId] = useState<Record<string, AnalysisFeedbackEntry>>({});
  const hiddenCallIdsRef = useRef<Set<string>>(new Set());
  const wrapupPhoneInputRef = useRef<HTMLInputElement | null>(null);
  const wrapupEmailInputRef = useRef<HTMLInputElement | null>(null);
  const callsTableScrollRef = useRef<HTMLDivElement | null>(null);
  const callsTableDragStartXRef = useRef(0);
  const callsTableDragStartScrollLeftRef = useRef(0);
  const callsTableIsDraggingRef = useRef(false);
  const [isCallsTableDragging, setIsCallsTableDragging] = useState(false);

  const [activeSession, setActiveSession] = useState<ActiveCallSession | null>(null);
  const [wrapupOpen, setWrapupOpen] = useState(false);
  const [wrapupSaving, setWrapupSaving] = useState(false);
  const [wrapupError, setWrapupError] = useState<string | null>(null);
  const [wrapupMessage, setWrapupMessage] = useState<string | null>(null);
  const [wrapupMessageType, setWrapupMessageType] = useState<"success" | "error">("success");
  const [postCallForm, setPostCallForm] = useState<PostCallFormState>(createDefaultPostCallForm());
  const [agendaBlocks, setAgendaBlocks] = useState<AgendaBlocks>(emptyAgendaBlocks);
  const [wrapupResolvedOwnerName, setWrapupResolvedOwnerName] = useState("");
  const [phoneAccordionOpen, setPhoneAccordionOpen] = useState(false);
  const [emailAccordionOpen, setEmailAccordionOpen] = useState(false);

  const checkingCallEndRef = useRef(false);
  const initialLoadDoneRef = useRef(false);
  const isInitialLoadRunningRef = useRef(false);
  const isLoadingCallsRef = useRef(false);
  const restoredFromQueryRef = useRef(false);
  const currentWrapupSessionRef = useRef<string | null>(null);
  const handleRestoreWrapupRef = useRef<(() => void) | null>(null);
  const shouldRestoreWrapupByQuery =
    searchParams.get("restoreWrapup") === "1" || searchParams.get("postCall") === "1";

  // Reset the guard whenever the user navigates to this page with restore params.
  useEffect(() => {
    if (shouldRestoreWrapupByQuery) {
      restoredFromQueryRef.current = false;
    }
  }, [shouldRestoreWrapupByQuery]);

  // Listen for the custom event dispatched by the app-shell "Abrir finalizacao" button.
  // This covers the case where the user is already on /ligacoes — router.push to the same
  // URL would not change searchParams, so the URL-param flow would never re-trigger.
  useEffect(() => {
    const handleOpenWrapupEvent = () => {
      restoredFromQueryRef.current = false;
      handleRestoreWrapupRef.current?.();
    };
    window.addEventListener("crm:open-wrapup", handleOpenWrapupEvent);
    return () => window.removeEventListener("crm:open-wrapup", handleOpenWrapupEvent);
  }, []);
  const showReasonField =
    postCallForm.result === "Falou com cliente" && normalizeText(postCallForm.nextAction) === "sem interesse";
  const showNextActionField = finalizacaoComProximaAcao.has(postCallForm.result);
  const currentSecondaryOptions =
    postCallForm.result === "Falou com cliente" || postCallForm.result === "Falou com secretaria"
      ? secondaryOptionsByFinalizacao[postCallForm.result]
      : [];
  const secondaryFieldLabel = "Subfinalização";
  const showFollowUpFields = showNextActionField && nextActionComFollowUp.has(postCallForm.nextAction);
  const isClosingSchedule = isClosingNextAction(postCallForm.nextAction);
  const scheduleSectionLabel = isClosingSchedule ? "Agendamento de fechamento" : "Agendamento de follow-up";
  const wrapupLeadPrimaryEmail = postCallForm.primaryEmail;
  const availableWrapupEmailTargets = useMemo(
    () => postCallForm.emailItems.map((item) => String(item.value || "").trim()).filter(Boolean),
    [postCallForm.emailItems],
  );
  const activeSessionPhoneDigits = useMemo(
    () => normalizeDigits(activeSession?.telefone || ""),
    [activeSession?.telefone],
  );
  const unclassifiedPhoneCount = useMemo(
    () => postCallForm.phoneItems.filter((item) => !item.quality).length,
    [postCallForm.phoneItems],
  );
  const unclassifiedEmailCount = useMemo(
    () => postCallForm.emailItems.filter((item) => !item.quality).length,
    [postCallForm.emailItems],
  );
  const hasEmailTargets = availableWrapupEmailTargets.length > 0;
  const responsavelById = useMemo(() => {
    const map: ResponsavelByIdIndex = new Map();
    for (const item of responsaveisRecords) {
      map.set(item.id, item.nome);
    }
    return map;
  }, [responsaveisRecords]);

  const loadCalls = async (signal?: AbortSignal, reason = "manual-refresh"): Promise<boolean> => {
    if (isLoadingCallsRef.current) return false;
    isLoadingCallsRef.current = true;
    console.log(`${LIGACOES_DEBUG_PREFIX} INITIAL LOAD START`, {
      reason,
      hasSignal: Boolean(signal),
      ts: new Date().toISOString(),
    });
    const isInitialLoad = !initialLoadDoneRef.current;
    if (isInitialLoad) setLoading(true);
    setError(null);

    try {
      const [externalResponse, internalResponse] = await Promise.all([
        fetch("/api/api4com/calls", {
          method: "GET",
          cache: "no-store",
          signal,
        }),
        fetch("/api/ligacoes", {
          method: "GET",
          cache: "no-store",
          signal,
        }),
      ]);
      const externalData = (await externalResponse.json()) as CallsApiResponse;
      const internalData = (await internalResponse.json()) as InternalCallsApiResponse;

      if (!internalResponse.ok || !internalData.success || !Array.isArray(internalData.calls)) {
        throw new Error("CALLS_INTERNAL_LOAD_FAILED");
      }

      const internalMapById = new Map<string, CallLog>();
      const internalMapByLookup = new Map<string, CallLog>();
      const registerLookup = (key: string, item: CallLog) => {
        const normalized = normalizeLookupKey(key);
        if (!normalized) return;
        const current = internalMapByLookup.get(normalized);
        if (!current || shouldReplaceLookupRecord(current, item)) {
          internalMapByLookup.set(normalized, item);
        }
      };
      for (const item of internalData.calls) {
        internalMapById.set(item.id, item);
        registerLookup(item.id, item);
        registerLookup(item.externalCallId || "", item);
        registerLookup(item.sessionId || "", item);
        const internalPhoneDigits = normalizeDigits(item.telefone || item.called || item.caller || "");
        const internalStartedAtMinute = getStartedAtMinuteKey(item.startedAt || item.createdAt || null);
        if (internalPhoneDigits && internalStartedAtMinute) {
          registerLookup(`phone-minute:${internalPhoneDigits}|${internalStartedAtMinute}`, item);
          const internalLeadId = String(item.leadId || "").trim();
          if (internalLeadId) {
            registerLookup(`lead-phone-minute:${internalLeadId}|${internalPhoneDigits}|${internalStartedAtMinute}`, item);
          }
        }
      }
      setInternalById(internalMapById);

      const leadsIndexes = buildLeadsIndexes(leadsSnapshot);
      const wrapupsIndexes = buildWrapupsIndexes(wrapups);
      const externalItems = externalResponse.ok && externalData.ok && Array.isArray(externalData.items) ? externalData.items : [];

      const rows =
        externalItems.length > 0
          ? externalItems.map((item, index) =>
              mapApiCallToRow(item, index, {
                leadsIndexes,
                internalByLookup: internalMapByLookup,
                wrapupsIndexes,
                responsavelById,
              }),
            )
          : Array.from(internalMapById.values()).map((item) =>
              mapInternalCallToRow(item, { leadsIndexes, wrapupsIndexes, responsavelById }),
            );

      rows.sort((a, b) => {
        const first = a.startedAt || "";
        const second = b.startedAt || "";
        return second.localeCompare(first);
      });

      const visibleRows = rows.filter((row) => !hiddenCallIdsRef.current.has(row.id));
      setCalls((prev) => {
        if (!prev.length) return visibleRows;

        const previousByLookup = new Map<string, MappedCall>();
        const registerPrevious = (call: MappedCall) => {
          for (const key of buildMappedCallLookupKeys(call)) {
            const current = previousByLookup.get(key);
            if (!current || shouldOverlayAnalysisState(current, call)) {
              previousByLookup.set(key, call);
            }
          }
        };
        prev.forEach(registerPrevious);

        return visibleRows.map((row) => {
          let fallback: MappedCall | undefined;
          for (const key of buildMappedCallLookupKeys(row)) {
            const candidate = previousByLookup.get(key);
            if (!candidate) continue;
            if (!fallback || shouldOverlayAnalysisState(fallback, candidate)) {
              fallback = candidate;
            }
          }

          if (!fallback || !shouldOverlayAnalysisState(row, fallback)) return row;
          return mergeAnalysisState(row, fallback);
        });
      });
      if (!externalResponse.ok || !externalData.ok) {
        setError(externalData.error || "Histórico externo indisponível. Exibindo ligações internas.");
      } else {
        setError(null);
      }
      console.log(`${LIGACOES_DEBUG_PREFIX} INITIAL LOAD SUCCESS`, {
        reason,
        externalOk: externalResponse.ok && externalData.ok,
        externalCount: externalItems.length,
        internalCount: internalMapById.size,
        renderedCount: visibleRows.length,
        source: externalItems.length > 0 ? "api4com" : "internal-fallback",
      });
      return true;
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") return false;
      setError("Não foi possível carregar ligações.");
      setCalls([]);
      console.error(`${LIGACOES_DEBUG_PREFIX} INITIAL LOAD FAIL`, {
        reason,
        message: requestError instanceof Error ? requestError.message : "erro desconhecido",
      });
      return false;
    } finally {
      if (isInitialLoad) setLoading(false);
      isLoadingCallsRef.current = false;
    }
    return false;
  };

  const loadCallsWithRetry = async (reason: string, attempts: number, signal?: AbortSignal) => {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (signal?.aborted) return;
      const ok = await loadCalls(signal, `${reason}#${attempt}`);
      if (ok) return;
      if (attempt < attempts) {
        await sleep(400 * attempt);
        isLoadingCallsRef.current = false;
      }
    }
  };

  const loadWebhookOutStatus = async () => {
    setWebhookOutLoading(true);
    setWebhookOutError(null);
    try {
      const response = await fetch("/api/integrations/webhook-out", {
        method: "GET",
        cache: "no-store",
      });
      const data = (await response.json()) as WebhookOutConfigResponse;
      if (!response.ok || !data.success) {
        const local = readWebhookOutClientConfig();
        setWebhookOutConfigured(Boolean(local?.url));
        if (!local?.url) {
          setWebhookOutError(data.error || "Nao foi possivel carregar configuracao de webhook de saida.");
        }
        return;
      }
      const local = readWebhookOutClientConfig();
      setWebhookOutConfigured(Boolean(data.configured || local?.url));
    } catch {
      const local = readWebhookOutClientConfig();
      setWebhookOutConfigured(Boolean(local?.url));
      if (!local?.url) {
        setWebhookOutError("Nao foi possivel carregar configuracao de webhook de saida.");
      }
    } finally {
      setWebhookOutLoading(false);
    }
  };

  const runWrapupReconciliation = async () => {
    if (getPendingPostCallWrapupsCount() === 0) return;

    try {
      const response = await fetch("/api/ligacoes", {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = (await response.json()) as InternalCallsApiResponse;
      if (!data.success || !Array.isArray(data.calls)) return;
      reconcileWrapupsWithCallLogs(data.calls);
    } catch {
      // noop
    }
  };

  useEffect(() => {
    const syncSession = () => {
      const session = getActiveCallSession();
      console.log("[POSTCALL_DEBUG] /ligacoes syncSession", session);
      setActiveSession(session);
      setWrapups(getPostCallWrapups());
    };
    syncSession();
    return subscribePostCallFlow(syncSession);
  }, []);

  useEffect(() => {
    const syncLeads = () => {
      setLeadsSnapshotState(getLeadsSnapshot());
    };
    syncLeads();
    return subscribeLeadsSnapshot(syncLeads);
  }, []);

  useEffect(() => {
    const syncMeetings = () => {
      setMeetingsSnapshotState(getMeetingsSnapshot());
    };
    syncMeetings();
    return subscribeMeetingsSnapshot(syncMeetings);
  }, []);

  useEffect(() => {
    const syncBlocks = () => {
      setAgendaBlocks(readAgendaBlocksFromStorage());
    };
    syncBlocks();
    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== AGENDA_BLOCKS_STORAGE_KEY) return;
      syncBlocks();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    if (!wrapupOpen) return;
    setAgendaBlocks(readAgendaBlocksFromStorage());
  }, [wrapupOpen]);

  useEffect(() => {
    let mounted = true;
    const resolveOwner = async () => {
      const resolved = await resolveResponsavelFromUserAsync(currentUser);
      if (!mounted) return;
      if (!resolved.linked || !resolved.responsavel) {
        setWrapupResolvedOwnerName("");
        return;
      }
      setWrapupResolvedOwnerName(resolved.responsavel.nome);
    };
    void resolveOwner();
    return () => {
      mounted = false;
    };
  }, [currentUser]);

  useEffect(() => {
    console.log("[POSTCALL_DEBUG] /ligacoes carregada", {
      href: typeof window !== "undefined" ? window.location.href : "",
      activeSession,
    });
  }, [activeSession]);

  useEffect(() => {
    console.log(`${LIGACOES_DEBUG_PREFIX} PAGE MOUNT`);
    hiddenCallIdsRef.current = readHiddenCallIds();
    const controller = new AbortController();
    isInitialLoadRunningRef.current = true;
    void loadCallsWithRetry("initial-mount", 3, controller.signal).finally(() => {
      isInitialLoadRunningRef.current = false;
      initialLoadDoneRef.current = true;
    });
    void runWrapupReconciliation();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    void loadWebhookOutStatus();
  }, []);

  useEffect(() => {
    if (responsavelById.size === 0) return;
    if (!initialLoadDoneRef.current && isInitialLoadRunningRef.current) return;
    void loadCallsWithRetry("responsaveis-ready", 2);
  }, [responsavelById]);

  useEffect(() => {
    const onFocus = () => {
      void loadCallsWithRetry("window-focus", 2);
      void loadWebhookOutStatus();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void loadCallsWithRetry("visibility-visible", 2);
        void loadWebhookOutStatus();
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void runWrapupReconciliation();
    }, 20000);
    return () => window.clearInterval(intervalId);
  }, []);

  const hasProcessingCalls = calls.some((call) => resolveAnalysisStatus(call) === "processing");

  useEffect(() => {
    if (!hasProcessingCalls) return;

    let disposed = false;

    const pollProcessingAnalysisStatus = async () => {
      try {
        const response = await fetch("/api/ligacoes", {
          method: "GET",
          cache: "no-store",
        });
        if (!response.ok) return;
        const data = (await response.json()) as InternalCallsApiResponse;
        if (!data.success || !Array.isArray(data.calls)) return;

        const internalLookup = new Map<string, CallLog>();
        const registerLookup = (key: string, item: CallLog) => {
          const normalized = normalizeLookupKey(key);
          if (!normalized) return;
          const current = internalLookup.get(normalized);
          if (!current || shouldReplaceLookupRecord(current, item)) {
            internalLookup.set(normalized, item);
          }
        };

        for (const item of data.calls) {
          registerLookup(String(item.id || "").trim(), item);
          registerLookup(String(item.externalCallId || "").trim(), item);
          registerLookup(String(item.sessionId || "").trim(), item);
          const internalPhoneDigits = normalizeDigits(item.telefone || item.called || item.caller || "");
          const internalStartedAtMinute = getStartedAtMinuteKey(item.startedAt || item.createdAt || null);
          if (internalPhoneDigits && internalStartedAtMinute) {
            registerLookup(`phone-minute:${internalPhoneDigits}|${internalStartedAtMinute}`, item);
            const internalLeadId = String(item.leadId || "").trim();
            if (internalLeadId) {
              registerLookup(`lead-phone-minute:${internalLeadId}|${internalPhoneDigits}|${internalStartedAtMinute}`, item);
            }
          }
        }

        if (disposed) return;

        setCalls((prev) => {
          let changed = false;
          const next = prev.map((call) => {
            if (resolveAnalysisStatus(call) !== "processing") return call;

            const lookupCandidates = Array.from(
              new Set(
                [
                  String(call.storeCallId || "").trim(),
                  String(call.id || "").trim(),
                  String(call.externalCallId || "").trim(),
                  String(call.sessionId || "").trim(),
                  (() => {
                    const digits = normalizeDigits(call.telefone);
                    const minute = getStartedAtMinuteKey(call.startedAt);
                    if (!digits || !minute) return "";
                    return `phone-minute:${digits}|${minute}`;
                  })(),
                  (() => {
                    const leadId = String(call.leadId || "").trim();
                    const digits = normalizeDigits(call.telefone);
                    const minute = getStartedAtMinuteKey(call.startedAt);
                    if (!leadId || !digits || !minute) return "";
                    return `lead-phone-minute:${leadId}|${digits}|${minute}`;
                  })(),
                ].filter(Boolean),
              ),
            );

            let internal: CallLog | undefined;
          for (const candidate of lookupCandidates) {
            const found = internalLookup.get(normalizeLookupKey(candidate));
            if (found) {
              internal = found;
              break;
            }
          }
            if (!internal) return call;

            const resolvedStatus = resolveAnalysisStatus({ analysisStatus: internal.analysisStatus });
            if (resolvedStatus === "processing") return call;

            const nextObservationId = String(internal.analysisObservationId || "").trim() || null;
            const nextLeadId = String(internal.analysisLeadId || internal.leadId || "").trim() || null;

            if (
              call.analysisStatus === resolvedStatus &&
              (call.analysisObservationId || null) === nextObservationId &&
              (call.analysisLeadId || null) === nextLeadId
            ) {
              return call;
            }

            changed = true;
            return {
              ...call,
              storeCallId: internal.id || call.storeCallId || null,
              analysisStatus: resolvedStatus,
              processingStatus: internal.processingStatus || call.processingStatus || "pending",
              analysisRequestId: internal.analysisRequestId || call.analysisRequestId || null,
              analysisObservationId: nextObservationId,
              analysisLeadId: nextLeadId,
              analysisUpdatedAt: internal.analysisUpdatedAt || call.analysisUpdatedAt || null,
              analysisPreview: internal.analysisPreview || call.analysisPreview || null,
              aiAnalysis: internal.aiAnalysis || call.aiAnalysis || null,
              analysisError: internal.analysisError || null,
            };
          });

          return changed ? next : prev;
        });
      } catch {
        // noop: mantém mecanismos existentes
      }
    };

    void pollProcessingAnalysisStatus();
    const intervalId = window.setInterval(() => {
      void pollProcessingAnalysisStatus();
    }, 5000);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [hasProcessingCalls]);

  useEffect(() => {
    let unmounted = false;

    const checkCallEnd = async () => {
      if (checkingCallEndRef.current) return;
      const session = getActiveCallSession();
      if (!session || session.status !== "dialing") return;

      checkingCallEndRef.current = true;
      const controller = new AbortController();
      try {
        const detection = await detectCallEnd(session, controller.signal);
        if (!detection.matched || !detection.detectionSource) return;
        if (unmounted) return;
        console.log(`${LIGACOES_DEBUG_PREFIX} CALL_ENDED_DETECTED`, {
          sessionId: session.sessionId,
          externalCallId: session.externalCallId || null,
          callId: detection.callId || null,
          leadId: session.leadId || null,
          source: detection.detectionSource,
        });
        markCallSessionEnded({
          sessionId: session.sessionId,
          callId: detection.callId,
          detectionSource: detection.detectionSource,
        });
      } finally {
        checkingCallEndRef.current = false;
      }
    };

    void checkCallEnd();
    const intervalId = window.setInterval(() => {
      void checkCallEnd();
    }, 4000);

    return () => {
      unmounted = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!activeSession || activeSession.status === "wrapped") {
      currentWrapupSessionRef.current = null;
      return;
    }

    const isNewSession = currentWrapupSessionRef.current !== activeSession.sessionId;
    if (isNewSession) {
      currentWrapupSessionRef.current = activeSession.sessionId;
      const draft = readWrapupDraft(activeSession.sessionId);
      const leadIndex = findLeadIndexForSession(leadsSnapshot, activeSession);
      const relatedLead = leadIndex >= 0 ? leadsSnapshot[leadIndex] : null;
      const defaultPhoneItems = buildInitialPhoneItemsForSession(activeSession, relatedLead);
      const defaultEmailItems = buildInitialEmailItemsForSession(relatedLead);
      const defaultCompany = String(relatedLead?.name || activeSession.nome || relatedLead?.company || activeSession.empresa || "").trim();
      const defaultPrimaryEmail = String(relatedLead?.email || defaultEmailItems[0]?.value || "").trim();
      const nextForm: PostCallFormState = {
        ...createDefaultPostCallForm(),
        ...(draft || {}),
        phoneItems: draft?.phoneItems?.length ? draft.phoneItems : defaultPhoneItems,
        emailItems: draft?.emailItems?.length ? draft.emailItems : defaultEmailItems,
        company: String(draft?.company || defaultCompany),
        primaryEmail: String(draft?.primaryEmail || defaultPrimaryEmail),
        emailTarget: draft?.emailTarget || defaultPrimaryEmail || "",
      };
      setPostCallForm(nextForm);
      restoredFromQueryRef.current = false;
      console.log(`${LIGACOES_DEBUG_PREFIX} WRAPUP_SESSION_CREATED`, {
        sessionId: activeSession.sessionId,
        externalCallId: activeSession.externalCallId || null,
        callId: activeSession.matchedCallId || null,
        leadId: activeSession.leadId || null,
        status: activeSession.status,
      });
    }

    const shouldForceRestore = shouldRestoreWrapupByQuery && !restoredFromQueryRef.current;
    const canOpenAutomatically = activeSession.wrapupState === "opened" || shouldForceRestore;
    if (!canOpenAutomatically || wrapupOpen) return;

    if (shouldForceRestore) {
      restoredFromQueryRef.current = true;
      setWrapupSessionState(activeSession.sessionId, "opened");
      console.log(`${LIGACOES_DEBUG_PREFIX} WRAPUP_MODAL_RESTORED`, {
        sessionId: activeSession.sessionId,
        externalCallId: activeSession.externalCallId || null,
        callId: activeSession.matchedCallId || null,
        leadId: activeSession.leadId || null,
      });
    }

    console.log(`${LIGACOES_DEBUG_PREFIX} WRAPUP_PENDING_SET`, {
      sessionId: activeSession.sessionId,
      externalCallId: activeSession.externalCallId || null,
      callId: activeSession.matchedCallId || null,
      leadId: activeSession.leadId || null,
      source: activeSession.detectionSource || null,
      status: activeSession.status,
      wrapupState: activeSession.wrapupState,
    });
    if (activeSession.wrapupState !== "opened") {
      setWrapupSessionState(activeSession.sessionId, "opened");
    }
    setWrapupError(null);
    setWrapupOpen(true);
    if (!activeSession.promptedAt) {
      markSessionPrompted(activeSession.sessionId);
    }
    console.log(`${LIGACOES_DEBUG_PREFIX} WRAPUP_MODAL_OPEN`, {
      sessionId: activeSession.sessionId,
      externalCallId: activeSession.externalCallId || null,
      callId: activeSession.matchedCallId || null,
      leadId: activeSession.leadId || null,
      status: activeSession.status,
    });
  }, [activeSession, leadsSnapshot, shouldRestoreWrapupByQuery, wrapupOpen]);

  useEffect(() => {
    if (!activeSession || activeSession.status === "wrapped") return;
    writeWrapupDraft(activeSession.sessionId, postCallForm);
  }, [activeSession, postCallForm]);

  useEffect(() => {
    setPostCallForm((prev) => {
      if (showNextActionField) return prev;
      if (!prev.nextAction && !prev.followUpDate && !prev.followUpTime) return prev;
      return {
        ...prev,
        nextAction: "",
        followUpDate: "",
        followUpTime: "",
      };
    });
  }, [showNextActionField]);

  useEffect(() => {
    setPostCallForm((prev) => {
      if (showFollowUpFields) return prev;
      if (!prev.followUpDate && !prev.followUpTime) return prev;
      return {
        ...prev,
        followUpDate: "",
        followUpTime: "",
      };
    });
  }, [showFollowUpFields]);

  useEffect(() => {
    setPostCallForm((prev) => {
      const currentTargets = prev.emailItems.map((item) => String(item.value || "").trim()).filter(Boolean);
      const firstTarget = currentTargets[0] || "";
      if (!prev.sendEmail) {
        if (!prev.emailTarget) return prev;
        return {
          ...prev,
          emailTarget: "",
        };
      }
      if (!currentTargets.length) {
        if (!prev.emailTarget) return prev;
        return {
          ...prev,
          emailTarget: "",
        };
      }
      if (prev.emailTarget && currentTargets.includes(prev.emailTarget)) return prev;
      return {
        ...prev,
        emailTarget: firstTarget,
      };
    });
  }, [postCallForm.sendEmail, postCallForm.emailItems]);

  useEffect(() => {
    setPostCallForm((prev) => {
      const currentEmails = prev.emailItems.map((item) => String(item.value || "").trim()).filter(Boolean);
      const normalizedPrimary = String(prev.primaryEmail || "").trim();
      if (normalizedPrimary) return prev;
      if (!currentEmails.length) return prev;
      return {
        ...prev,
        primaryEmail: currentEmails[0],
      };
    });
  }, [postCallForm.emailItems]);

  const finalizacaoOptions = baseFinalizacaoOptions;
  const atendenteOptions = useMemo(() => {
    const dynamic = Array.from(
      new Set(
        responsaveisRecords
          .map((record) => String(record.nome || "").trim())
          .filter((name) => name.length > 0),
      ),
    ).sort((a, b) => a.localeCompare(b));
    return ["Todos", ...dynamic];
  }, [responsaveisRecords]);

  useEffect(() => {
    if (atendenteFilter === "Todos") return;
    if (atendenteOptions.includes(atendenteFilter)) return;
    setAtendenteFilter("Todos");
  }, [atendenteFilter, atendenteOptions]);

  const filteredCalls = useMemo(() => {
    return calls.filter((call) => {
      const matchesFinalizacao = finalizacaoFilter === "Todas" || call.finalizacao === finalizacaoFilter;
      const matchesAtendente = atendenteFilter === "Todos" || call.atendente === atendenteFilter;
      return matchesFinalizacao && matchesAtendente;
    });
  }, [atendenteFilter, calls, finalizacaoFilter]);

  useEffect(() => {
    if (!selectedIds.length) return;
    const currentIds = new Set(filteredCalls.map((call) => call.id));
    setSelectedIds((prev) => prev.filter((id) => currentIds.has(id)));
  }, [filteredCalls, selectedIds.length]);

  useEffect(() => {
    if (!initialLoadDoneRef.current) return;
    void loadCallsWithRetry("wrapups-changed", 1);
  }, [wrapups]);

  const allFilteredSelected = filteredCalls.length > 0 && filteredCalls.every((call) => selectedIds.includes(call.id));

  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds(filteredCalls.map((call) => call.id));
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const deleteSelectedCalls = () => {
    if (selectedIds.length === 0) return;
    const ok = window.confirm(
      selectedIds.length === 1
        ? "Deseja excluir a ligação selecionada?"
        : `Deseja excluir ${selectedIds.length} ligações selecionadas?`,
    );
    if (!ok) return;

    const nextHidden = new Set(hiddenCallIdsRef.current);
    for (const id of selectedIds) nextHidden.add(id);
    hiddenCallIdsRef.current = nextHidden;
    writeHiddenCallIds(nextHidden);

    setCalls((prev) => prev.filter((call) => !nextHidden.has(call.id)));
    if (selectedCallId && nextHidden.has(selectedCallId)) {
      setSelectedCallId(null);
    }
    setSelectedIds([]);
  };

  const isInteractiveTableTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    return Boolean(target.closest("button, input, select, textarea, a, label"));
  };

  const handleCallsTableMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (!callsTableScrollRef.current) return;
    if (isInteractiveTableTarget(event.target)) return;

    callsTableIsDraggingRef.current = true;
    setIsCallsTableDragging(true);
    callsTableDragStartXRef.current = event.clientX;
    callsTableDragStartScrollLeftRef.current = callsTableScrollRef.current.scrollLeft;
  };

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!callsTableIsDraggingRef.current || !callsTableScrollRef.current) return;
      const deltaX = event.clientX - callsTableDragStartXRef.current;
      event.preventDefault();
      callsTableScrollRef.current.scrollLeft = callsTableDragStartScrollLeftRef.current - deltaX;
    };

    const stopDragging = () => {
      if (!callsTableIsDraggingRef.current) return;
      callsTableIsDraggingRef.current = false;
      setIsCallsTableDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: false });
    window.addEventListener("mouseup", stopDragging);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopDragging);
    };
  }, []);

  const handleViewAnaliseIa = async (call: MappedCall) => {
    if (viewAnalysisLoadingCallId === call.id) return;

    const canonicalCallId = String(call.storeCallId || call.id || "").trim();
    if (!canonicalCallId) {
      setAnalysisFeedbackByCallId((prev) => ({
        ...prev,
        [call.id]: {
          type: "error",
          message: "Ligacao sem identificador canônico para localizar análise.",
        },
      }));
      return;
    }

    setViewAnalysisLoadingCallId(call.id);
    setAnalysisFeedbackByCallId((prev) => ({
      ...prev,
      [call.id]: {
        type: "info",
        message: "Buscando análise...",
      },
    }));

    try {
      const query = new URLSearchParams();
      if (call.externalCallId) query.set("externalCallId", call.externalCallId);
      if (call.sessionId) query.set("sessionId", call.sessionId);
      if (call.analysisLeadId || call.leadId) query.set("leadId", String(call.analysisLeadId || call.leadId));
      if (call.analysisObservationId) query.set("analysisObservationId", String(call.analysisObservationId));
      if (call.telefone) query.set("phone", call.telefone);
      if (call.startedAt) query.set("startedAt", call.startedAt);

      const endpoint = `/api/ligacoes/${encodeURIComponent(canonicalCallId)}/analise${
        query.toString() ? `?${query.toString()}` : ""
      }`;
      const response = await fetch(endpoint);
      const payload = (await response.json().catch(() => null)) as ResolveAnaliseIaResponse | null;
      console.log(`${LIGACOES_DEBUG_PREFIX} VIEW_ANALYSIS_RESOLVE`, {
        callId: call.id,
        canonicalCallId,
        endpoint,
        status: response.status,
        success: payload?.success ?? false,
        available: payload?.available ?? false,
        code: payload?.code || null,
      });

      if (!response.ok || !payload?.success) {
        setAnalysisFeedbackByCallId((prev) => ({
          ...prev,
          [call.id]: {
            type: "error",
            message: payload?.message || "Nao foi possivel localizar a analise desta ligação.",
          },
        }));
        return;
      }

      const leadId = String(payload.analysis?.leadId || "").trim();
      const observationId = String(payload.analysis?.observationId || "").trim();
      const isAvailable = payload.available && leadId && observationId;

      if (!isAvailable) {
        console.warn(`${LIGACOES_DEBUG_PREFIX} VIEW_ANALYSIS_NOT_AVAILABLE`, {
          callId: call.id,
          canonicalCallId,
          payload,
        });
        setAnalysisFeedbackByCallId((prev) => ({
          ...prev,
          [call.id]: {
            type: "info",
            message: payload.message || "Análise ainda não disponível para visualização nesta ligação.",
          },
        }));
        return;
      }

      const params = new URLSearchParams();
      params.set("leadId", leadId);
      params.set("tab", "observacoes");
      params.set("highlightObservation", observationId);
      params.set("source", "ligacoes");
      console.log(`${LIGACOES_DEBUG_PREFIX} VIEW_ANALYSIS_NAVIGATE`, {
        callId: call.id,
        leadId,
        observationId,
        url: `/leads/outbound?${params.toString()}`,
      });
      router.push(`/leads/outbound?${params.toString()}`);
    } catch (error) {
      console.error(`${LIGACOES_DEBUG_PREFIX} VIEW_ANALYSIS_ERROR`, {
        callId: call.id,
        canonicalCallId,
        message: error instanceof Error ? error.message : "erro desconhecido",
      });
      setAnalysisFeedbackByCallId((prev) => ({
        ...prev,
        [call.id]: {
          type: "error",
          message: "Nao foi possivel localizar a analise desta ligação.",
        },
      }));
    } finally {
      setViewAnalysisLoadingCallId((prev) => (prev === call.id ? null : prev));
    }
  };

  const handleGenerateAnaliseIa = async (call: MappedCall) => {
    if (analysisLoadingCallId === call.id) return;
    const canonicalCallId = String(call.storeCallId || call.id || "").trim();
    if (!canonicalCallId) {
      setAnalysisFeedbackByCallId((prev) => ({
        ...prev,
        [call.id]: {
          type: "error",
          message: "Ligacao sem identificador canônico para analise.",
        },
      }));
      return;
    }
    const localWebhook = readWebhookOutClientConfig();

    if (!webhookOutConfigured && !localWebhook?.url) {
      setAnalysisFeedbackByCallId((prev) => ({
        ...prev,
        [call.id]: {
          type: "error",
          message: "Webhook de saida nao configurado. Configure em Configuracoes > Integracoes.",
        },
      }));
      return;
    }

    setAnalysisLoadingCallId(call.id);
    setAnalysisFeedbackByCallId((prev) => ({
      ...prev,
      [call.id]: {
        type: "info",
        message: "Gerando análise...",
      },
    }));

    const processingAt = new Date().toISOString();
    const processingPatch = {
      analysisStatus: "processing",
      analysisLeadId: call.analysisLeadId || call.leadId || null,
      analysisUpdatedAt: processingAt,
      analysisError: null,
      sourceCallId: call.id,
      externalCallId: call.externalCallId || null,
      sessionId: call.sessionId || null,
      leadId: call.leadId || null,
      telefone: call.telefone || null,
      nome: call.nome || null,
      empresa: call.empresa || null,
      startedAt: call.startedAt || null,
      endedAt: call.endedAt || null,
      durationSeconds: Number(call.durationSeconds || 0),
      status: call.status || null,
      gateway: call.ramal || null,
      recordUrl: getCallRecordingUrl(call) || null,
    } as const;
    console.log(`${LIGACOES_DEBUG_PREFIX} GERAR_ANALISE_IDS`, {
      tableCallId: call.id,
      storeCallId: call.storeCallId || null,
      externalCallId: call.externalCallId || null,
      sessionId: call.sessionId || null,
      leadId: call.leadId || null,
    });
    try {
      const persistProcessingResponse = await fetch(`/api/ligacoes/${encodeURIComponent(canonicalCallId)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(processingPatch),
      });
      const persistProcessingData = (await persistProcessingResponse.json().catch(() => ({}))) as {
        success?: boolean;
        resolvedCallId?: string;
        message?: string;
        detail?: string;
        call?: CallLog;
      };
      if (!persistProcessingResponse.ok || !persistProcessingData.success) {
        const persistErrorMessage =
          persistProcessingData.message ||
          persistProcessingData.detail ||
          "Nao foi possivel marcar a ligacao como em processamento.";
        setAnalysisFeedbackByCallId((prev) => ({
          ...prev,
          [call.id]: {
            type: "error",
            message: persistErrorMessage,
          },
        }));
        setAnalysisLoadingCallId(null);
        return;
      }

      setCalls((prev) =>
        prev.map((item) =>
          item.id === call.id
            ? {
                ...item,
                analysisStatus: "processing",
                processingStatus: "processing",
                storeCallId:
                  persistProcessingData.resolvedCallId ||
                  persistProcessingData.call?.id ||
                  item.storeCallId ||
                  canonicalCallId,
                analysisLeadId:
                  persistProcessingData.call?.analysisLeadId || item.analysisLeadId || item.leadId || call.leadId || null,
                analysisUpdatedAt: persistProcessingData.call?.analysisUpdatedAt || processingAt,
                analysisError: null,
              }
            : item,
        ),
      );
    } catch (persistError) {
      const persistErrorMessage =
        persistError instanceof Error
          ? persistError.message
          : "Nao foi possivel marcar a ligacao como em processamento.";
      setAnalysisFeedbackByCallId((prev) => ({
        ...prev,
        [call.id]: {
          type: "error",
          message: persistErrorMessage,
        },
      }));
      setAnalysisLoadingCallId(null);
      return;
    }

    const recordingUrl = getCallRecordingUrl(call);
    const metadata =
      call.raw.metadata && typeof call.raw.metadata === "object"
        ? (call.raw.metadata as Record<string, unknown>)
        : null;
    const ramalFromMetadata = String(metadata?.gateway ?? metadata?.ramal ?? "").trim();
    const externalCallIdFromRaw = String(
      call.raw.call_id ?? call.raw.callid ?? call.raw.uniqueid ?? call.raw.id ?? "",
    ).trim();

    try {
      const response = await fetch("/api/integracoes/analise-ia/gerar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          triggeredByUserId: currentUser?.id || undefined,
          triggeredByName: currentUser?.nome || undefined,
          triggeredByEmail: currentUser?.email || undefined,
          webhook: localWebhook
            ? {
                url: localWebhook.url,
                secret: localWebhook.secret || undefined,
                method: "POST",
              }
            : undefined,
          call: {
            id: canonicalCallId,
            callId: canonicalCallId,
            leadId: call.leadId || null,
            externalCallId: call.externalCallId || externalCallIdFromRaw || null,
            sessionId: call.sessionId || null,
            contactName: call.nome,
            companyName: call.empresa,
            phone: call.telefone,
            attendantName: call.atendente,
            date: formatDate(call.startedAt),
            startedAt: call.startedAt,
            endedAt: call.endedAt,
            durationSeconds: Number(call.durationSeconds || 0),
            durationLabel: formatDuration(call.durationSeconds),
            status: call.status,
            finalizacao: call.finalizacao,
            subfinalizacao: call.subfinalizacao,
            origem: call.origem,
            ramal: call.ramal || ramalFromMetadata || null,
            recordingUrl,
          },
        }),
      });

      let data: GenerateAnaliseIaResponse = { success: false };
      let rawResponseText = "";
      try {
        rawResponseText = await response.text();
        data = rawResponseText ? (JSON.parse(rawResponseText) as GenerateAnaliseIaResponse) : { success: false };
      } catch {
        data = { success: false, detail: rawResponseText || "Resposta invalida da API interna." };
      }

      if (!response.ok || !data.success) {
        const statusText = response.status ? `HTTP ${response.status}` : "";
        const codeText = data.code ? `[${data.code}]` : "";
        const detailedMessage =
          [
            data.message || data.error || "Falha ao enviar analise para processamento externo.",
            statusText,
            codeText,
            data.detail || "",
          ]
            .filter(Boolean)
            .join(" ");
        setCalls((prev) =>
          prev.map((item) =>
            item.id === call.id
              ? {
                  ...item,
                  analysisStatus: "error",
                  processingStatus: "error",
                  analysisUpdatedAt: new Date().toISOString(),
                  analysisError: detailedMessage,
                }
              : item,
          ),
        );
        console.error(`${LIGACOES_DEBUG_PREFIX} CALL_ANALYSIS_REQUEST_FAILED`, {
          callId: call.id,
          leadId: call.leadId || null,
          responseStatus: response.status,
          code: data.code || null,
          detail: data.detail || null,
          rawResponseText: rawResponseText || null,
        });
        setAnalysisFeedbackByCallId((prev) => ({
          ...prev,
          [call.id]: {
            type: "error",
            message: detailedMessage,
          },
        }));
        return;
      }

      setAnalysisFeedbackByCallId((prev) => ({
        ...prev,
        [call.id]: {
          type: "success",
          message: "Solicitacao enviada. Aguarde o processamento para liberar Ver analise.",
        },
      }));
      setCalls((prev) =>
        prev.map((item) =>
          item.id === call.id
            ? {
              ...item,
              analysisStatus: "processing",
              processingStatus: "processing",
              analysisRequestId: data.requestId || item.analysisRequestId || null,
              analysisLeadId: item.analysisLeadId || item.leadId || call.leadId || null,
              analysisUpdatedAt: new Date().toISOString(),
              analysisError: null,
            }
          : item,
        ),
      );
      await loadCallsWithRetry("analysis-requested", 1);
    } catch (requestError) {
      const errorMessage =
        requestError instanceof Error
          ? requestError.message
          : "Erro inesperado ao iniciar geracao da analise.";

      void fetch(`/api/ligacoes/${encodeURIComponent(canonicalCallId)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          analysisStatus: "error",
          analysisUpdatedAt: new Date().toISOString(),
          analysisError: `Nao foi possivel enviar analise. ${errorMessage}`,
        }),
      });

      setCalls((prev) =>
        prev.map((item) =>
          item.id === call.id
            ? {
                ...item,
                analysisStatus: "error",
                processingStatus: "error",
                analysisUpdatedAt: new Date().toISOString(),
                analysisError: `Nao foi possivel enviar analise. ${errorMessage}`,
              }
            : item,
        ),
      );
      setAnalysisFeedbackByCallId((prev) => ({
        ...prev,
        [call.id]: {
          type: "error",
          message: `Nao foi possivel enviar analise. ${errorMessage}`,
        },
      }));
      console.error(`${LIGACOES_DEBUG_PREFIX} CALL_ANALYSIS_REQUEST_EXCEPTION`, {
        callId: canonicalCallId,
        leadId: call.leadId || null,
        message: errorMessage,
      });
    } finally {
      setAnalysisLoadingCallId(null);
    }
  };

  const handleMinimizeWrapup = () => {
    if (!activeSession || activeSession.status === "wrapped") {
      setWrapupOpen(false);
      setWrapupError(null);
      return;
    }
    const nextWrapupState = activeSession.status === "ended_detected" ? "pending" : "minimized";
    setWrapupSessionState(activeSession.sessionId, nextWrapupState);
    setWrapupOpen(false);
    setWrapupError(null);
    console.log(`${LIGACOES_DEBUG_PREFIX} WRAPUP_MODAL_MINIMIZED`, {
      sessionId: activeSession.sessionId,
      externalCallId: activeSession.externalCallId || null,
      callId: activeSession.matchedCallId || null,
      leadId: activeSession.leadId || null,
      status: activeSession.status,
    });
  };

  const handleRestoreWrapup = () => {
    if (!activeSession || activeSession.status === "wrapped") return;
    setWrapupSessionState(activeSession.sessionId, "opened");
    setWrapupOpen(true);
    setWrapupError(null);
    restoredFromQueryRef.current = true;
    console.log(`${LIGACOES_DEBUG_PREFIX} WRAPUP_MODAL_RESTORED`, {
      sessionId: activeSession.sessionId,
      externalCallId: activeSession.externalCallId || null,
      callId: activeSession.matchedCallId || null,
      leadId: activeSession.leadId || null,
      status: activeSession.status,
    });
  };

  // Keep ref current so the event listener always calls the latest version
  handleRestoreWrapupRef.current = handleRestoreWrapup;

  const handleWrapupModalClose = () => {
    handleMinimizeWrapup();
  };

  const updateWrapupCompany = (value: string) => {
    setPostCallForm((prev) => ({
      ...prev,
      company: value,
    }));
  };

  const updateWrapupPrimaryEmail = (value: string) => {
    const cleaned = String(value || "");
    setPostCallForm((prev) => {
      return {
        ...prev,
        primaryEmail: cleaned,
        emailTarget: prev.sendEmail ? cleaned.trim() : prev.emailTarget,
      };
    });
  };

  const upsertWrapupPhoneItem = (value: string, quality?: LeadContactQuality) => {
    const cleaned = String(value || "").trim();
    if (!cleaned) return;
    const cleanedKey = normalizeDigits(cleaned) || cleaned.toLowerCase();
    setPostCallForm((prev) => {
      const existingIndex = prev.phoneItems.findIndex((item) => {
        const itemValue = String(item.value || "").trim();
        const itemKey = normalizeDigits(itemValue) || itemValue.toLowerCase();
        return itemKey === cleanedKey;
      });
      if (existingIndex >= 0) {
        const nextItems = [...prev.phoneItems];
        nextItems[existingIndex] = {
          value: cleaned,
          ...(quality ? { quality } : {}),
        };
        return {
          ...prev,
          phoneItems: nextItems,
          newPhoneValue: "",
        };
      }
      return {
        ...prev,
        phoneItems: [...prev.phoneItems, { value: cleaned, ...(quality ? { quality } : {}) }],
        newPhoneValue: "",
      };
    });
    window.setTimeout(() => {
      wrapupPhoneInputRef.current?.focus();
    }, 0);
  };

  const setWrapupPhoneQualityAt = (index: number, quality?: LeadContactQuality) => {
    setPostCallForm((prev) => {
      if (!prev.phoneItems[index]) return prev;
      const nextItems = [...prev.phoneItems];
      nextItems[index] = {
        value: nextItems[index].value,
        ...(quality ? { quality } : {}),
      };
      return {
        ...prev,
        phoneItems: nextItems,
      };
    });
  };

  const removeWrapupPhoneAt = (index: number) => {
    setPostCallForm((prev) => ({
      ...prev,
      phoneItems: prev.phoneItems.filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const upsertWrapupEmailItem = (value: string, quality?: LeadContactQuality) => {
    const cleaned = String(value || "").trim();
    if (!cleaned) return;
    const cleanedKey = cleaned.toLowerCase();
    setPostCallForm((prev) => {
      const existingIndex = prev.emailItems.findIndex((item) => String(item.value || "").trim().toLowerCase() === cleanedKey);
      if (existingIndex >= 0) {
        const nextItems = [...prev.emailItems];
        nextItems[existingIndex] = {
          value: cleaned,
          ...(quality ? { quality } : {}),
        };
        return {
          ...prev,
          emailItems: nextItems,
          primaryEmail: prev.primaryEmail && prev.primaryEmail.toLowerCase() === cleanedKey ? cleaned : prev.primaryEmail,
          newEmailValue: "",
        };
      }
      const shouldPromoteAsPrimary = !prev.primaryEmail.trim() || prev.emailItems.length === 0;
      const nextEmailItems = [...prev.emailItems, { value: cleaned, ...(quality ? { quality } : {}) }];
      return {
        ...prev,
        emailItems: nextEmailItems,
        primaryEmail: shouldPromoteAsPrimary ? cleaned : prev.primaryEmail,
        newEmailValue: "",
      };
    });
    window.setTimeout(() => {
      wrapupEmailInputRef.current?.focus();
    }, 0);
  };

  const setWrapupEmailQualityAt = (index: number, quality?: LeadContactQuality) => {
    setPostCallForm((prev) => {
      if (!prev.emailItems[index]) return prev;
      const nextItems = [...prev.emailItems];
      nextItems[index] = {
        value: nextItems[index].value,
        ...(quality ? { quality } : {}),
      };
      return {
        ...prev,
        emailItems: nextItems,
      };
    });
  };

  const dispatchWrapupEmailWebhook = async (payload: EmailDispatchRequestBody): Promise<WrapupEmailDispatchOutcome> => {
    try {
      const response = await fetch("/api/integrations/webhook-out/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      let data: EmailDispatchResponse = { success: false };
      let rawText = "";
      try {
        rawText = await response.text();
        data = rawText ? (JSON.parse(rawText) as EmailDispatchResponse) : { success: false };
      } catch {
        data = { success: false, detail: rawText || "Resposta invalida da API." };
      }

      if (!response.ok || !data.success) {
        const details = [
          data.message || data.error || "Falha ao disparar webhook de email.",
          data.status ? `HTTP ${data.status}` : "",
          data.detail || "",
        ]
          .filter(Boolean)
          .join(" ");
        return {
          attempted: true,
          success: false,
          message: details,
        };
      }

      return {
        attempted: true,
        success: true,
        message: data.message || "Webhook de email disparado com sucesso.",
      };
    } catch (error) {
      return {
        attempted: true,
        success: false,
        message: error instanceof Error ? error.message : "Erro de rede ao disparar webhook de email.",
      };
    }
  };

  const reserveFollowUpSlot = async (params: {
    date: string;
    time: string;
    ownerName: string;
    sessionId: string;
  }): Promise<FollowUpScheduleOutcome> => {
    try {
      const response = await fetch("/api/agenda/agendar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "reserve",
          date: params.date,
          time: params.time,
          owner: params.ownerName,
          sessionId: params.sessionId,
          blocks: agendaBlocks,
          localMeetings: meetingsSnapshot
            .filter((meeting) => isMeetingActiveForScheduling(meeting))
            .map((meeting) => ({
              id: meeting.id,
              date: meeting.date,
              callTime: meeting.callTime,
              owner: meeting.owner,
              notes: meeting.notes || "",
            })),
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        available?: boolean;
        message?: string;
      };
      if (!response.ok || !data.success || !data.available) {
        return {
          success: false,
          message: data.message || "Nao foi possivel validar disponibilidade para agendamento.",
        };
      }

      return {
        success: true,
      };
    } catch {
      return {
        success: false,
        message: "Nao foi possivel validar disponibilidade para agendamento.",
      };
    }
  };

  const summary = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    let todayCalls = 0;
    let answered = 0;
    let missed = 0;
    let totalCallSeconds = 0;
    let totalAnsweredSeconds = 0;

    for (const call of filteredCalls) {
      const duration = Number(call.durationSeconds || 0);
      if ((call.startedAt || "").slice(0, 10) === today) todayCalls += 1;
      totalCallSeconds += Math.max(0, duration);
      const connected = String(call.status || "").trim().toLowerCase() === "atendida";
      if (connected) {
        answered += 1;
        totalAnsweredSeconds += duration;
      } else missed += 1;
    }

    return {
      todayCalls,
      answered,
      missed,
      totalCallSeconds,
      totalAnsweredSeconds,
      totalCallTime: formatTotalTime(totalCallSeconds),
      totalTime: formatTotalTime(totalAnsweredSeconds),
    };
  }, [filteredCalls]);

  const tmaSegmentado = useMemo(() => {
    const build = (finalizacaoKey?: string) => {
      let totalSeconds = 0;
      let count = 0;

      for (const call of filteredCalls) {
        if (finalizacaoKey && normalizeFinalizacaoKey(call.finalizacao) !== finalizacaoKey) continue;
        totalSeconds += Math.max(0, Number(call.durationSeconds || 0));
        count += 1;
      }

      return {
        totalSeconds,
        count,
        tma: formatAverageTime(totalSeconds, count),
      };
    };

    return {
      cliente: build("falou com cliente"),
      secretaria: build("falou com secretaria"),
      geral: build(),
    };
  }, [filteredCalls]);

  const contactQuality = useMemo(() => {
    let cpcPositive = 0;
    let cpcNegative = 0;
    let improdutivas = 0;

    for (const call of filteredCalls) {
      const normalized = normalizeFinalizacaoKey(call.finalizacao);
      const normalizedSubfinalizacao = normalizeFinalizacaoKey(call.subfinalizacao);
      const isNegative =
        hasFinalizacaoKeyword(normalized, CPC_NEGATIVE_FINALIZACOES) ||
        CPC_NEGATIVE_SUBFINALIZACOES.has(normalizedSubfinalizacao);
      const isPositive = CPC_POSITIVE_FINALIZACOES.has(normalized) && !isNegative;
      const classification = getFinalizacaoClassification(call.finalizacao);
      const isImprodutiva =
        !isPositive &&
        !isNegative &&
        (IMPRODUTIVE_FINALIZACOES.has(normalized) || Boolean(classification && !classification.conectado));

      if (isPositive) {
        cpcPositive += 1;
      } else if (isNegative) {
        cpcNegative += 1;
      } else if (isImprodutiva) {
        improdutivas += 1;
      }
    }

    const cpc = cpcPositive + cpcNegative;

    const total = filteredCalls.length;
    const cpcRate = total > 0 ? Math.round((cpc / total) * 100) : 0;
    const cpcPositiveRate = total > 0 ? Math.round((cpcPositive / total) * 100) : 0;
    const cpcNegativeRate = total > 0 ? Math.round((cpcNegative / total) * 100) : 0;
    return { cpc, cpcRate, cpcPositive, cpcPositiveRate, cpcNegative, cpcNegativeRate, improdutivas };
  }, [filteredCalls]);

  const cpcPieSegments = useMemo(() => {
    const segments = [
      {
        id: "cpc_positivo",
        label: "CPC Positivo",
        count: contactQuality.cpcPositive,
        color: "#10B981",
      },
      {
        id: "cpc_negativo",
        label: "CPC Negativo",
        count: contactQuality.cpcNegative,
        color: "#F43F5E",
      },
      {
        id: "improdutivas",
        label: "Improdutivas",
        count: contactQuality.improdutivas,
        color: "#F59E0B",
      },
    ];

    const total = segments.reduce((acc, segment) => acc + segment.count, 0);
    let startAngle = 0;

    return segments.map((segment) => {
      const percent = total > 0 ? (segment.count / total) * 100 : 0;
      const sweepAngle = total > 0 ? (segment.count / total) * 360 : 0;
      const endAngle = startAngle + sweepAngle;
      const path = sweepAngle > 0 ? buildPieSlicePath(70, 70, 56, startAngle, endAngle) : "";
      const normalized = {
        ...segment,
        total,
        percent,
        path,
      };
      startAngle = endAngle;
      return normalized;
    });
  }, [contactQuality.cpcNegative, contactQuality.cpcPositive, contactQuality.improdutivas]);

  const finalizacaoChart = useMemo(() => {
    const counts = new Map<string, number>();
    for (const call of filteredCalls) {
      const label = call.finalizacao && call.finalizacao !== "-" ? call.finalizacao : "Sem finalizacao";
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    const total = filteredCalls.length;
    const sorted = Array.from(counts.entries())
      .map(([label, count]) => ({
        label,
        count,
        percent: total > 0 ? Math.round((count / total) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);
    return sorted;
  }, [filteredCalls]);

  const maxFinalizacaoPercent = useMemo(
    () => finalizacaoChart.reduce((max, item) => Math.max(max, item.percent), 0),
    [finalizacaoChart],
  );

  const applyWrapupToLead = (
    session: ActiveCallSession,
    formState: PostCallFormState,
    ownerName: string,
    callEvidence?: CurrentCallEvidence,
  ) => {
    const leads = getLeadsSnapshot();
    const now = nowDateAndTime();
    const leadIndex = findLeadIndexForSession(leads, session);

    if (leadIndex === -1) {
      console.log("[POSTCALL_DEBUG] Nenhum lead encontrado para vincular finalizacao", {
        sessionId: session.sessionId,
        leadId: session.leadId,
        telefone: session.telefone,
      });
      return;
    }

    const lead = leads[leadIndex];
    const companyName = String(formState.company || "").trim();
    const mergedEmailItems = mergePrimaryEmailIntoItems(formState.primaryEmail, formState.emailItems);
    const leadWithUpdatedContacts = updateLeadEmailItems(updateLeadPhoneItems(lead, formState.phoneItems), mergedEmailItems);
    const observationId = `OBS-CALL-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const freeTextObservationId = `OBS-CALL-TEXT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const resultLabel = normalizeFinalizacaoLabel(formState.result) || "Finalização registrada";
    const durationText = formatDurationHuman(callEvidence?.durationSeconds);
    const callDate = formatDate(callEvidence?.startedAt || now.date);
    const callTime = formatTime(callEvidence?.startedAt || `${now.date}T${now.time}:00`);
    const selectedEmail = formState.emailTarget || leadWithUpdatedContacts.email || "-";
    const followUpDateText = formState.followUpDate ? formatDate(formState.followUpDate) : "-";
    const followUpTimeText = formState.followUpTime || "-";
    const followUpText =
      followUpDateText !== "-" || followUpTimeText !== "-"
        ? `${followUpDateText}${followUpTimeText !== "-" ? ` ${followUpTimeText}` : ""}`.trim()
        : "-";

    const structuredLines = [
      `Finalização: ${resultLabel}`,
      `Motivo: ${formState.reason || "-"}`,
      `Proxima acao: ${formState.nextAction.trim() || "-"}`,
      `Follow-up: ${followUpText}`,
      `Duração: ${durationText}`,
      `E-mail do lead: ${selectedEmail}`,
      `Envio de e-mail no wrap-up: ${formState.sendEmail ? "Sim" : "Nao"}`,
      `Data/Hora da ligacao: ${callDate} ${callTime !== "-" ? `- ${callTime}` : ""}`.trim(),
    ];

    const structuredObservation: LeadObservation = {
      id: observationId,
      date: now.date,
      time: now.time,
      owner: ownerName,
      type: "contato",
      content: structuredLines.join("\n"),
    };

    const freeTextObservation =
      formState.observations.trim().length > 0
        ? ({
            id: freeTextObservationId,
            date: now.date,
            time: now.time,
            owner: ownerName,
            type: "informacao interna",
            content: formState.observations.trim(),
          } as LeadObservation)
        : null;

    const linkedObservationId = freeTextObservation?.id || structuredObservation.id;

    const historyEventDescription = `Ligação realizada com o lead. Finalização: ${resultLabel}.`;

    const nextLead: Lead = {
      ...leadWithUpdatedContacts,
      company: companyName || leadWithUpdatedContacts.company,
      history: [
        ...leadWithUpdatedContacts.history,
        {
          id: `H-CALL-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          date: now.date,
          time: now.time,
          eventType: "LIGACAO",
          description: historyEventDescription,
          owner: ownerName,
          linkedObservationId,
          linkedTab: "observacoes",
        },
      ],
      observationLog: freeTextObservation
        ? [...leadWithUpdatedContacts.observationLog, structuredObservation, freeTextObservation]
        : [...leadWithUpdatedContacts.observationLog, structuredObservation],
      lastInteraction: `${now.date} ${now.time}`,
      nextAction: formState.nextAction.trim() || leadWithUpdatedContacts.nextAction,
      nextActionDate: formState.followUpDate ? formState.followUpDate : leadWithUpdatedContacts.nextActionDate,
      firstContactDate: leadWithUpdatedContacts.firstContactDate || now.date,
    };

    const nextLeads = [...leads];
    nextLeads[leadIndex] = nextLead;
    setLeadsSnapshot(nextLeads);
    setLeadsSnapshotState(nextLeads);
  };

  const createFollowUpMeetingIfNeeded = (
    session: ActiveCallSession,
    formState: PostCallFormState,
    ownerName: string,
  ) => {
    if (!formState.followUpDate || !formState.followUpTime) return;

    const leads = getLeadsSnapshot();
    const sessionPhone = normalizeDigits(session.telefone);
    const lead =
      leads.find((item) => item.id === session.leadId) ||
      leads.find((item) => {
        const leadPhones = getLeadPhones(item).map((phone) => normalizeDigits(phone));
        return leadPhones.some((leadPhone) => Boolean(sessionPhone && leadPhone && (leadPhone.endsWith(sessionPhone) || sessionPhone.endsWith(leadPhone))));
      }) ||
      null;

    const sessionMarker = `[POSTCALL:${session.sessionId}]`;
    const leadIdMarker = lead?.id ? `[LEAD:${lead.id}]` : "";
    const meetings = getMeetingsSnapshot();
    const hasExistingMeeting = meetings.some((meeting) => {
      if (!isMeetingActiveForScheduling(meeting)) return false;
      if ((meeting.notes || "").includes(sessionMarker)) return true;
      if (lead?.id && String(meeting.leadId || "").trim() === lead.id) {
        if (meeting.date === formState.followUpDate && meeting.callTime === formState.followUpTime) return true;
      }
      if (meeting.date !== formState.followUpDate || meeting.callTime !== formState.followUpTime) return false;
      if (normalizeMeetingPersonName(meeting.owner) !== normalizeMeetingPersonName(ownerName)) return false;
      return true;
    });

    if (hasExistingMeeting) return;

    const notes = [
      "Origem: Ligação",
      `Finalização: ${normalizeFinalizacaoLabel(formState.result)}`,
      `Proxima acao: ${formState.nextAction || "-"}`,
      `Telefone: ${(lead ? getLeadPhones(lead)[0] : "") || session.telefone}`,
      sessionMarker,
    ];
    if (formState.observations.trim()) {
      notes.push(`Observacoes: ${formState.observations.trim()}`);
    }
    if (leadIdMarker) {
      notes.push(leadIdMarker);
    }

    const eventType = inferAgendaEventTypeFromNextAction(formState.nextAction);
    const meetingReason: "fechamento" | "follow-up" = eventType === "call_conversao" ? "fechamento" : "follow-up";
    const channel = inferAgendaChannelFromType(eventType);
    const nowIso = new Date().toISOString();

    const meeting: Meeting = {
      id: `MEET-CALL-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      leadId: lead?.id || session.leadId || null,
      personName: lead?.name || session.nome || "Lead sem nome",
      date: formState.followUpDate,
      callTime: formState.followUpTime,
      reason: meetingReason,
      owner: ownerName,
      notes: notes.join("\n"),
      status: "ativo",
      eventType,
      channel,
      parentEventId: null,
      rescheduledFromEventId: null,
      rescheduledToEventId: null,
      deletedAt: null,
      canceledAt: null,
      completedAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    setMeetingsSnapshot([...meetings, meeting]);

    if (!lead) return;

    const agendamentoDescricao = (() => {
      const acao = String(formState.nextAction || "").trim().toLowerCase();
      if (acao.includes("video")) return "Call de fechamento agendada com o lead.";
      if (acao.includes("whatsapp")) return "Retorno agendado com o lead.";
      if (acao.includes("reuniao")) return "Reuniao agendada com o lead.";
      if (acao.includes("ligar")) return "Ligação agendada com o lead.";
      if (acao.includes("retorno")) return "Retorno agendado com o lead.";
      return "Follow-up agendado para o lead.";
    })();

    const now = nowDateAndTime();
    const refreshedLeads = getLeadsSnapshot();
    const refreshedLeadIndex = refreshedLeads.findIndex((item) => item.id === lead.id);
    if (refreshedLeadIndex === -1) return;

    const refreshedLead = refreshedLeads[refreshedLeadIndex];
    const leadComAgendamento: Lead = {
      ...refreshedLead,
      history: [
        ...refreshedLead.history,
        {
          id: `H-AGD-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          date: now.date,
          time: now.time,
          eventType: "AGENDAMENTO",
          description: agendamentoDescricao,
          owner: ownerName,
        },
      ],
    };

    const nextLeads = [...refreshedLeads];
    nextLeads[refreshedLeadIndex] = leadComAgendamento;
    setLeadsSnapshot(nextLeads);
    setLeadsSnapshotState(nextLeads);
  };

  const handleSaveWrapup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const effectiveEmailItems = mergePrimaryEmailIntoItems(postCallForm.primaryEmail, postCallForm.emailItems);
    const selectedEmailTarget = String(postCallForm.emailTarget || effectiveEmailItems[0]?.value || "").trim();
    if (!activeSession) {
      setWrapupError("Nenhum contexto de chamada disponivel para finalizar.");
      return;
    }
    if (!postCallForm.result) {
      setWrapupError("Selecione o resultado da ligação.");
      return;
    }
    if (showReasonField && !postCallForm.reason) {
      setWrapupError("Selecione o motivo para cliente sem interesse.");
      return;
    }
    if (showNextActionField && !postCallForm.nextAction.trim()) {
      setWrapupError("Selecione a próxima ação para continuar.");
      return;
    }
    if (showFollowUpFields && (!postCallForm.followUpDate || !postCallForm.followUpTime)) {
      setWrapupError(
        isClosingSchedule
          ? "Preencha data e horario do agendamento de fechamento para continuar."
          : "Preencha data e horario do follow-up para continuar.",
      );
      return;
    }
    if (!postCallForm.phoneItems.length) {
      setWrapupError("Adicione ao menos um telefone para salvar a finalizacao.");
      return;
    }
    if (postCallForm.sendEmail && !effectiveEmailItems.length) {
      setWrapupError("Adicione ao menos um e-mail para habilitar envio pela finalizacao.");
      return;
    }
    if (postCallForm.sendEmail && !selectedEmailTarget) {
      setWrapupError("Selecione o e-mail de destino para envio.");
      return;
    }
    if (postCallForm.sendEmail && !postCallForm.emailMessage.trim()) {
      setWrapupError("Digite a mensagem do e-mail para concluir o envio.");
      return;
    }

    setWrapupSaving(true);
    setWrapupError(null);
    setWrapupMessage(null);
    setWrapupMessageType("success");

    try {
      const resolvedResponsavel = await resolveResponsavelFromUserAsync(currentUser);
      if (!resolvedResponsavel.linked || !resolvedResponsavel.responsavel) {
        console.error("[WRAPUP_SAVE] responsavel_not_found", {
          userId: currentUser?.id ?? null,
          email: currentUser?.email ?? null,
          error: resolvedResponsavel.error ?? null,
        });
        setWrapupError(
          `Seu usuário (${currentUser?.email ?? "sem e-mail"}) ainda não está vinculado a um responsável no CRM. Cadastre esse e-mail em Configurações > Responsáveis antes de finalizar ligações.`,
        );
        return;
      }

      const ownerName = resolvedResponsavel.responsavel.nome;
      const ownerId = resolvedResponsavel.responsavel.id;
      const currentCallEvidence: CurrentCallEvidence | undefined = activeSession.matchedCallId
        ? (() => {
            const fromTable = calls.find((item) => item.id === activeSession.matchedCallId);
            if (fromTable) {
              return {
                id: fromTable.id,
                startedAt: fromTable.startedAt,
                endedAt: fromTable.endedAt,
                durationSeconds: fromTable.durationSeconds,
                status: fromTable.status,
              };
            }
            const fromInternal = activeSession.matchedCallId ? internalById.get(activeSession.matchedCallId) : undefined;
            if (fromInternal) {
              return {
                id: fromInternal.id,
                startedAt: fromInternal.startedAt || null,
                endedAt: fromInternal.endedAt || null,
                durationSeconds: Number(fromInternal.durationSeconds || 0),
                status: fromInternal.status || undefined,
              };
            }
            return undefined;
          })()
        : undefined;

      const normalizedPhoneItems = normalizeLeadPhoneItemsForDraft(postCallForm.phoneItems);
      const normalizedEmailItems = mergePrimaryEmailIntoItems(postCallForm.primaryEmail, postCallForm.emailItems);
      const normalizedPrimaryEmail = String(postCallForm.primaryEmail || "").trim();
      const safePostCallForm: PostCallFormState = {
        ...postCallForm,
        company: String(postCallForm.company || "").trim(),
        primaryEmail: normalizedPrimaryEmail,
        phoneItems: normalizedPhoneItems,
        emailItems: normalizedEmailItems,
        emailTarget: postCallForm.sendEmail ? selectedEmailTarget : "",
      };

      if (showFollowUpFields) {
        const scheduleOutcome = await reserveFollowUpSlot({
          date: safePostCallForm.followUpDate,
          time: safePostCallForm.followUpTime,
          ownerName,
          sessionId: activeSession.sessionId,
        });
        if (!scheduleOutcome.success) {
          setWrapupError(scheduleOutcome.message || "Nao foi possivel confirmar disponibilidade para agendamento.");
          return;
        }
      }

      const wrapupClassification = getFinalizacaoClassification(safePostCallForm.result);
      const isSemInteresseWrapup = normalizeText(safePostCallForm.nextAction) === "sem interesse";
      const savedWrapup = savePostCallWrapup({
        sessionId: activeSession.sessionId,
        externalCallId: activeSession.externalCallId,
        leadId: activeSession.leadId,
        nome: activeSession.nome,
        empresa: safePostCallForm.company || activeSession.empresa,
        telefone: activeSession.telefone,
        userId: activeSession.userId,
        responsavelId: ownerId,
        atendenteNome: ownerName,
        result: safePostCallForm.result,
        connected: wrapupClassification?.conectado,
        finalizacaoTipo: wrapupClassification?.tipo,
        finalizacaoResultado: isSemInteresseWrapup ? "NEGATIVO" : wrapupClassification?.resultado,
        reason: safePostCallForm.reason || undefined,
        observations: safePostCallForm.observations.trim(),
        nextAction: safePostCallForm.nextAction.trim(),
        followUpDate: safePostCallForm.followUpDate || undefined,
        followUpTime: safePostCallForm.followUpTime || undefined,
        callId: activeSession.matchedCallId,
        conciliationStatus: activeSession.matchedCallId ? "conciliated" : "pending_conciliation",
      });
      console.log(`${LIGACOES_DEBUG_PREFIX} CALL_WRAPUP_MATCH_CONFIRMED`, {
        sessionId: activeSession.sessionId,
        externalCallId: activeSession.externalCallId || null,
        callId: activeSession.matchedCallId || null,
      });
      applyWrapupToLead(activeSession, safePostCallForm, ownerName, currentCallEvidence);
      createFollowUpMeetingIfNeeded(activeSession, safePostCallForm, ownerName);

      let emailDispatchOutcome: WrapupEmailDispatchOutcome = {
        attempted: false,
        success: false,
      };
      if (safePostCallForm.sendEmail) {
        const refreshedLeads = getLeadsSnapshot();
        const refreshedLeadIndex = findLeadIndexForSession(refreshedLeads, activeSession);
        const refreshedLead = refreshedLeadIndex >= 0 ? refreshedLeads[refreshedLeadIndex] : null;
        const finalizationPayload: CallFinalization = {
          wrapupId: savedWrapup.id,
          sessionId: activeSession.sessionId,
          callId: activeSession.matchedCallId || null,
          externalCallId: activeSession.externalCallId || null,
          leadId: refreshedLead?.id || activeSession.leadId || null,
          result: safePostCallForm.result,
          reason: safePostCallForm.reason || null,
          observations: safePostCallForm.observations.trim() || null,
          nextAction: safePostCallForm.nextAction.trim() || null,
          followUpDate: safePostCallForm.followUpDate || null,
          followUpTime: safePostCallForm.followUpTime || null,
          savedAt: savedWrapup.updatedAt,
          userId: activeSession.userId || null,
          responsavelId: ownerId,
          atendenteNome: ownerName,
        };
        const emailDispatchBody: EmailDispatchRequestBody = {
          finalization: finalizationPayload,
          lead: {
            id: refreshedLead?.id || activeSession.leadId || null,
            name: refreshedLead?.name || activeSession.nome || null,
            company: refreshedLead?.company || activeSession.empresa || null,
            phone: refreshedLead?.phone || activeSession.telefone || null,
            email: refreshedLead?.email || safePostCallForm.emailTarget || null,
            phones: refreshedLead ? getLeadPhoneItems(refreshedLead) : safePostCallForm.phoneItems,
            emails: refreshedLead ? getLeadEmailItems(refreshedLead) : safePostCallForm.emailItems,
          },
          email: {
            to: safePostCallForm.emailTarget,
            content: safePostCallForm.emailMessage.trim(),
          },
          metadata: {
            source: "ligacoes.wrapup",
            callEvidence: currentCallEvidence || null,
            triggeredByEmail: currentUser?.email || null,
          },
        };
        emailDispatchOutcome = await dispatchWrapupEmailWebhook(emailDispatchBody);
      }

      markCallSessionWrapped(activeSession.sessionId);
      clearActiveCallSession({
        expectedSessionId: activeSession.sessionId,
        reason: "wrapup_saved",
      });
      clearWrapupDraft(activeSession.sessionId);
      setActiveSession(null);
      console.log("[POSTCALL_DEBUG] Wrapup salvo e sessao marcada como wrapped", {
        sessionId: activeSession.sessionId,
      });
      console.log(`${LIGACOES_DEBUG_PREFIX} FINALIZATION_SAVED`, {
        sessionId: activeSession.sessionId,
        externalCallId: activeSession.externalCallId || null,
        callId: activeSession.matchedCallId || null,
        leadId: activeSession.leadId || null,
        result: safePostCallForm.result,
        nextAction: safePostCallForm.nextAction || null,
        emailDispatchAttempted: emailDispatchOutcome.attempted,
        emailDispatchSuccess: emailDispatchOutcome.success,
        emailDispatchMessage: emailDispatchOutcome.message || null,
      });
      setPostCallForm(createDefaultPostCallForm());
      setWrapupOpen(false);
      if (!emailDispatchOutcome.attempted) {
        setWrapupMessageType("success");
        setWrapupMessage("Finalização da ligação registrada com sucesso.");
      } else if (emailDispatchOutcome.success) {
        setWrapupMessageType("success");
        setWrapupMessage("Finalização registrada e webhook de e-mail disparado com sucesso.");
      } else {
        setWrapupMessageType("error");
        setWrapupMessage(`Finalização registrada, mas o webhook de e-mail falhou: ${emailDispatchOutcome.message || "erro desconhecido."}`);
      }
      await runWrapupReconciliation();
      await loadCallsWithRetry("after-wrapup-save", 2);
    } catch {
      setWrapupError("Não foi possível registrar a finalização desta ligação.");
    } finally {
      setWrapupSaving(false);
    }
  };

  return (
    <section className="space-y-6 bg-[#0A0A0B]">
      <div className="panel rounded-xl border border-white/[0.06] bg-[#111827] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.08em] text-[#6B7280]">Painel de Ligações</p>
            <h1 className="mt-1 text-[20px] font-semibold tracking-[-0.02em] text-[#E6EAF2]">Ligações</h1>
            <p className="mt-1 text-[13px] text-[#6B7280]">Acompanhe o histórico de chamadas realizadas no CRM.</p>
          </div>
          <div className="flex w-full flex-wrap items-end justify-start gap-2 rounded-xl border border-white/[0.06] bg-[#111827] p-2 lg:w-auto lg:justify-end">
            <label className="text-[11px] uppercase tracking-[0.08em] text-muted">
              Atendente
              <select
                className="field mt-1 h-9 min-w-[190px] border-white/[0.06] bg-[#0A0A0B] px-2.5 py-1.5 text-xs"
                value={atendenteFilter}
                onChange={(event) => setAtendenteFilter(event.target.value)}
              >
                {atendenteOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11px] uppercase tracking-[0.08em] text-muted">
              Finalização
              <select
                className="field mt-1 h-9 min-w-[190px] border-white/[0.06] bg-[#0A0A0B] px-2.5 py-1.5 text-xs"
                value={finalizacaoFilter}
                onChange={(event) => setFinalizacaoFilter(event.target.value)}
              >
                {finalizacaoOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn-ghost h-9 border-white/[0.06] bg-[#0A0A0B] px-3 py-1.5 text-xs transition-all duration-200 ease-out hover:-translate-y-[2px]"
              onClick={() => {
                void loadCallsWithRetry("manual-refresh", 1);
              }}
              disabled={loading}
            >
              {loading ? "Atualizando..." : "Atualizar"}
            </button>
          </div>
        </div>
        {wrapupMessage ? (
          <p className={`mt-2 text-xs ${wrapupMessageType === "success" ? "text-emerald-300" : "text-amber-300"}`}>
            {wrapupMessage}
          </p>
        ) : null}
      </div>

      {activeSession && activeSession.status !== "wrapped" && !wrapupOpen ? (
        <div className="panel border-amber-500/30 bg-amber-500/5 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[10px] uppercase tracking-[0.12em] text-amber-200">Finalização pendente</p>
              <p className="mt-1 text-sm text-amber-100/90">
                Ligação {activeSession.status === "dialing" ? "em andamento" : "encerrada"} para{" "}
                <span className="font-semibold">{activeSession.nome || activeSession.telefone}</span>.
              </p>
            </div>
            <button type="button" className="btn-primary h-9 px-3 py-1.5 text-xs" onClick={handleRestoreWrapup}>
              Restaurar finalização
            </button>
          </div>
        </div>
      ) : null}

      <div className="space-y-6">
        <div className="panel rounded-xl border border-white/[0.06] bg-[#111827] p-5">
          <div className="mb-4">
            <p className="text-[20px] font-semibold tracking-[-0.02em] text-[#E6EAF2]">Volume e Eficiência</p>
            <p className="mt-1 text-[13px] text-[#6B7280]">Tempo médio por tipo de atendimento</p>
          </div>
          {loading ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr_1fr]">
              {[0, 1, 2].map((item) => (
                <div
                  key={`tma-loading-${item}`}
                  className="min-h-[148px] max-h-[164px] animate-pulse rounded-[14px] border border-white/[0.06] bg-[#0F172A] px-6 py-5"
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr_1fr]">
              <article className="flex min-h-[148px] max-h-[164px] flex-col items-start justify-center gap-[14px] rounded-[14px] border border-white/[0.06] bg-[#0F172A] px-6 py-5 transition-all duration-200 ease-out hover:-translate-y-[2px]">
                <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-[#7C89A0]">TMA Geral</p>
                <p className="text-[44px] font-semibold leading-none text-[#F3F7FF]">{tmaSegmentado.geral.tma}</p>
                <p className="text-[15px] font-normal text-[#8A94A6]">
                  {tmaSegmentado.geral.count} ligação{tmaSegmentado.geral.count === 1 ? "" : "ões"} no período filtrado
                </p>
              </article>

              <article className="flex min-h-[148px] max-h-[164px] flex-col items-start justify-center gap-[14px] rounded-[14px] border border-white/[0.06] bg-[#0F172A] px-6 py-5 transition-all duration-200 ease-out hover:-translate-y-[2px]">
                <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-[#7C89A0]">TMA Cliente</p>
                <p className="text-[44px] font-semibold leading-none text-[#F3F7FF]">{tmaSegmentado.cliente.tma}</p>
                <p className="text-[15px] font-normal text-[#8A94A6]">
                  {tmaSegmentado.cliente.count} ligação{tmaSegmentado.cliente.count === 1 ? "" : "ões"}
                </p>
              </article>

              <article className="flex min-h-[148px] max-h-[164px] flex-col items-start justify-center gap-[14px] rounded-[14px] border border-white/[0.06] bg-[#0F172A] px-6 py-5 transition-all duration-200 ease-out hover:-translate-y-[2px]">
                <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-[#7C89A0]">TMA Secretaria</p>
                <p className="text-[44px] font-semibold leading-none text-[#F3F7FF]">{tmaSegmentado.secretaria.tma}</p>
                <p className="text-[15px] font-normal text-[#8A94A6]">
                  {tmaSegmentado.secretaria.count} ligação{tmaSegmentado.secretaria.count === 1 ? "" : "ões"}
                </p>
              </article>
            </div>
          )}
        </div>

        <div className="panel rounded-xl border border-white/[0.06] bg-[#111827] p-5">
          <div className="mb-4">
            <p className="text-[20px] font-semibold tracking-[-0.02em] text-[#E6EAF2]">Qualidade (CPC)</p>
            <p className="mt-1 text-[13px] text-[#6B7280]">Distribuição entre positivos, negativos e improdutivos</p>
          </div>
          {loading ? (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[220px_1fr]">
              <div className="h-[190px] animate-pulse rounded-xl border border-white/[0.06] bg-[#0A0A0B]" />
              <div className="h-[190px] animate-pulse rounded-xl border border-white/[0.06] bg-[#0A0A0B]" />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[220px_1fr]">
              <div className="flex h-full min-h-[190px] items-center justify-center rounded-xl border border-white/[0.06] bg-[#111827] p-5 transition-all duration-200 ease-out hover:-translate-y-[2px]">
                <div className="flex h-full w-full items-center justify-center">
                  <div className="relative h-[140px] w-[140px]">
                    <svg viewBox="0 0 140 140" className="h-[140px] w-[140px] -rotate-90">
                      <circle cx="70" cy="70" r="56" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="12" />
                      {cpcPieSegments.map((segment) =>
                        segment.path ? <path key={segment.id} d={segment.path} fill={segment.color} /> : null,
                      )}
                    </svg>
                    <div className="absolute inset-[40px] flex flex-col items-center justify-center rounded-full border border-white/[0.06] bg-[#111827] text-center">
                      <p className="text-[11px] text-[#6B7280]">Total</p>
                      <p className="mt-1 text-[20px] font-semibold tracking-[-0.02em] text-[#E6EAF2]">
                        {cpcPieSegments[0]?.total || 0}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {cpcPieSegments.map((segment) => (
                  <div
                    key={`legend-${segment.id}`}
                    className="rounded-xl border border-white/[0.06] bg-[#111827] p-4 transition-all duration-200 ease-out hover:-translate-y-[2px]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: segment.color }} />
                        <div>
                          <p className="text-[13px] font-medium text-[#E6EAF2]">{segment.label}</p>
                          <p className="text-[12px] text-[#6B7280]">
                            {segment.count} ligação{segment.count === 1 ? "" : "ões"}
                          </p>
                        </div>
                      </div>
                      <p className="text-[13px] font-medium text-[#E6EAF2]">{Math.round(segment.percent)}%</p>
                    </div>
                    <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${segment.percent}%`,
                          backgroundColor: segment.color,
                          boxShadow: `0 0 8px ${segment.color}66`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <article className="panel rounded-xl border border-white/[0.06] bg-[#111827] p-5">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[20px] font-semibold tracking-[-0.02em] text-[#E6EAF2]">Distribuição de Finalizações</p>
              <p className="mt-1 text-[13px] text-[#6B7280]">Participação percentual e comparação entre resultados</p>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="rounded-md border border-white/[0.06] bg-[#111827] px-2 py-1 text-[11px] text-[#6B7280]">
                {filteredCalls.length} ligações
              </span>
            </div>
          </div>

          {finalizacaoChart.length === 0 ? (
            <p className="text-sm text-[#6B7280]">Sem dados para exibir.</p>
          ) : (
            <div className="space-y-2 rounded-xl border border-white/[0.06] bg-[#111827] p-2">
              {finalizacaoChart.map((item) => {
                const isDominant = maxFinalizacaoPercent > 0 && item.percent === maxFinalizacaoPercent;
                return (
                  <div
                    key={item.label}
                    className={`grid h-12 grid-cols-[180px_minmax(0,1fr)_40px] items-center gap-3 rounded-lg border px-4 transition-all duration-200 ease-out ${
                      isDominant
                        ? "border-white/20 bg-white/[0.04]"
                        : "border-white/[0.06] bg-[#111827] hover:border-white/15 hover:bg-white/[0.02]"
                    }`}
                  >
                    <span className={`truncate text-[13px] ${isDominant ? "font-semibold text-[#E6EAF2]" : "font-medium text-[#E6EAF2]"}`}>
                      {item.label}
                    </span>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
                      <div
                        className={`h-full rounded-full ${finalizacaoBarColor(item.label)}`}
                        style={{
                          width: `${item.percent}%`,
                          boxShadow: isDominant ? "0 0 10px rgba(255,255,255,0.3)" : "none",
                        }}
                      />
                    </div>
                    <span className={`text-right text-[13px] ${isDominant ? "font-semibold text-[#E6EAF2]" : "font-medium text-[#E6EAF2]"}`}>
                      {item.percent}%
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </article>
      </div>

      <div className="panel overflow-hidden border-slate-800/90 bg-slate-950/70">
        <div className="flex items-center justify-end border-b border-slate-800/90 bg-slate-950/90 px-3 py-2.5">
          <button
            type="button"
            className="h-9 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-200 transition hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={deleteSelectedCalls}
            disabled={selectedIds.length === 0}
          >
            Excluir selecionadas
          </button>
        </div>
        {loading ? <p className="px-4 py-4 text-sm text-slate-400">Carregando ligações...</p> : null}
        {error ? <p className="px-4 py-4 text-sm text-rose-300">{error}</p> : null}

        {!loading && !error ? (
          <div
            ref={callsTableScrollRef}
            onMouseDown={handleCallsTableMouseDown}
            className={`overflow-x-auto ${isCallsTableDragging ? "cursor-grabbing select-none" : "cursor-grab"}`}
          >
            <table className="min-w-[1260px] w-full text-left">
              <thead className="border-b border-slate-800/90 bg-slate-950/90 text-[11px] uppercase tracking-[0.08em] text-slate-400">
                <tr>
                  <th className="whitespace-nowrap px-3 py-2.5">
                    <input
                      type="checkbox"
                      aria-label={allFilteredSelected ? "Desmarcar todas" : "Selecionar todas"}
                      className="h-4 w-4 accent-cyan-400"
                      checked={allFilteredSelected}
                      onChange={toggleSelectAllFiltered}
                    />
                  </th>
                  <th className="whitespace-nowrap px-3 py-2.5">Ação</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Nome</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Empresa</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Telefone</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Atendente</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Data</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Início</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Fim</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Duração</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Status</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Finalização</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Subfinalização</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Origem</th>
                </tr>
              </thead>
              <tbody>
                {filteredCalls.length === 0 ? (
                  <tr>
                    <td className="px-3 py-4 text-sm text-slate-400" colSpan={14}>
                      Nenhuma ligação encontrada.
                    </td>
                  </tr>
                ) : (
                  filteredCalls.map((call) => {
                    const isOpen = selectedCallId === call.id;
                    const isSelected = selectedIds.includes(call.id);
                    const recordingUrl = getCallRecordingUrl(call);
                    const analysisFeedback = analysisFeedbackByCallId[call.id];
                    const analysisDone = isAnalysisReady(call);
                    const analysisProcessing = analysisLoadingCallId === call.id;
                    const analysisViewLoading = viewAnalysisLoadingCallId === call.id;
                    return (
                      <Fragment key={call.id}>
                        <tr className="border-b border-border/70 text-sm text-slate-200 transition hover:bg-slate-900/40">
                          <td className="whitespace-nowrap px-3 py-3">
                            <input
                              type="checkbox"
                              aria-label={`Selecionar ligação ${call.id}`}
                              className="h-4 w-4 accent-cyan-400"
                              checked={isSelected}
                              onChange={() => toggleSelectOne(call.id)}
                            />
                          </td>
                          <td className="whitespace-nowrap px-3 py-3">
                            <button
                              type="button"
                              className="rounded-md border border-border px-2.5 py-1.5 text-xs text-slate-200 transition hover:bg-slate-800"
                              onClick={() => setSelectedCallId((prev) => (prev === call.id ? null : call.id))}
                            >
                              {isOpen ? "Ocultar detalhes" : "Ver detalhes"}
                            </button>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3">{call.nome}</td>
                          <td className="whitespace-nowrap px-3 py-3">{call.empresa}</td>
                          <td className="whitespace-nowrap px-3 py-3">{call.telefone}</td>
                          <td className="whitespace-nowrap px-3 py-3">{call.atendente || "Responsável não vinculado"}</td>
                          <td className="whitespace-nowrap px-3 py-3">{formatDate(call.startedAt)}</td>
                          <td className="whitespace-nowrap px-3 py-3">{formatTime(call.startedAt)}</td>
                          <td className="whitespace-nowrap px-3 py-3">{formatTime(call.endedAt)}</td>
                          <td className="whitespace-nowrap px-3 py-3">{formatDuration(call.durationSeconds)}</td>
                          <td className="whitespace-nowrap px-3 py-3">
                            <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${statusBadgeClass(call.status)}`}>
                              {call.status || "Não atendida"}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3">
                            <span className="rounded-md border border-border/70 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-200">
                              {call.finalizacao || "-"}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3">
                            <span className="rounded-md border border-border/70 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-200">
                              {call.subfinalizacao || "-"}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3">{call.origem}</td>
                        </tr>
                        {isOpen ? (
                          <tr className="border-b border-border/70 bg-slate-950/40">
                            <td colSpan={14} className="px-3 py-3">
                              <div className="grid gap-3 rounded-lg border border-border bg-slate-900/50 p-4 md:grid-cols-2 xl:grid-cols-4">
                                <div>
                                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-400">Nome</p>
                                  <p className="mt-1 text-sm text-slate-100">{call.nome}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-400">Empresa</p>
                                  <p className="mt-1 text-sm text-slate-100">{call.empresa}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-400">Telefone</p>
                                  <p className="mt-1 text-sm text-slate-100">{call.telefone}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-400">Atendente</p>
                                  <p className="mt-1 text-sm text-slate-100">{call.atendente || "Responsável não vinculado"}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-400">Data</p>
                                  <p className="mt-1 text-sm text-slate-100">{formatDate(call.startedAt)}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-400">Início</p>
                                  <p className="mt-1 text-sm text-slate-100">{formatTime(call.startedAt)}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-400">Atendimento</p>
                                  <p className="mt-1 text-sm text-slate-100">{Number(call.durationSeconds) > 0 ? "Sim" : "Não"}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-400">Fim</p>
                                  <p className="mt-1 text-sm text-slate-100">{formatTime(call.endedAt)}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-400">Duração</p>
                                  <p className="mt-1 text-sm text-slate-100">{formatDuration(call.durationSeconds)}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-400">Status</p>
                                  <p className="mt-1 text-sm text-slate-100">{call.status || "Não atendida"}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-400">Finalização</p>
                                  <p className="mt-1 text-sm text-slate-100">{call.finalizacao || "-"}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-400">Subfinalização</p>
                                  <p className="mt-1 text-sm text-slate-100">{call.subfinalizacao || "-"}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-400">Ramal/Origem</p>
                                  <p className="mt-1 text-sm text-slate-100">{call.origem}</p>
                                </div>
                                <div className="md:col-span-2">
                                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-400">Hangup cause</p>
                                  <p className="mt-1 text-sm text-slate-100">
                                    {String(call.raw.hangup_cause ?? call.raw.hangupCause ?? "-")}
                                  </p>
                                </div>
                                <div className="md:col-span-2 xl:col-span-4">
                                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-400">Audio</p>
                                  {recordingUrl ? (
                                    <a
                                      href={recordingUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="mt-1 inline-flex text-sm text-emerald-300 underline underline-offset-2"
                                    >
                                      Abrir gravação
                                    </a>
                                  ) : (
                                    <p className="mt-1 text-sm text-slate-500">Sem gravação disponível</p>
                                  )}
                                </div>
                                <div>
                                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-400">Transcrição</p>
                                  <p className="mt-1 text-sm text-slate-500">Em breve</p>
                                </div>
                                <div>
                                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-400">Análise IA</p>
                                  <div className="mt-1 flex flex-wrap items-center gap-2">
                                    <button
                                      type="button"
                                      className="btn-primary h-8 px-2.5 py-1 text-xs"
                                      onClick={() => void handleGenerateAnaliseIa(call)}
                                      disabled={analysisProcessing || webhookOutLoading || !webhookOutConfigured}
                                    >
                                      Gerar análise
                                    </button>
                                    <button
                                      type="button"
                                      className="btn-ghost h-8 px-2.5 py-1 text-xs"
                                      onClick={() => void handleViewAnaliseIa(call)}
                                      disabled={analysisViewLoading}
                                    >
                                      {analysisViewLoading ? "Abrindo..." : "Ver análise"}
                                    </button>
                                  </div>
                                  {webhookOutLoading ? (
                                    <p className="mt-1 text-xs text-slate-500">Carregando integração...</p>
                                  ) : null}
                                  {!webhookOutLoading && !webhookOutConfigured ? (
                                    <p className="mt-1 text-xs text-amber-300">
                                      Configure o webhook de saída em Configurações &gt; Integrações.
                                    </p>
                                  ) : null}
                                  {webhookOutError ? <p className="mt-1 text-xs text-rose-300">{webhookOutError}</p> : null}
                                  {call.analysisError &&
                                  (!analysisFeedback || analysisFeedback.message !== call.analysisError) ? (
                                    <p className="mt-1 text-xs text-rose-300">{call.analysisError}</p>
                                  ) : null}
                                  {analysisFeedback ? (
                                    <p
                                      className={`mt-1 text-xs ${
                                        analysisFeedback.type === "success"
                                          ? "text-emerald-300"
                                          : analysisFeedback.type === "error"
                                            ? "text-rose-300"
                                            : "text-slate-400"
                                      }`}
                                    >
                                      {analysisFeedback.message}
                                    </p>
                                  ) : null}
                                  {analysisProcessing ? (
                                    <p className="mt-1 text-xs text-slate-400">Gerando análise...</p>
                                  ) : null}
                                  {analysisDone && call.aiAnalysis ? (
                                    <p className="mt-1 text-xs text-emerald-300">
                                      Analise concluida e vinculada ao lead. Clique em Ver análise.
                                    </p>
                                  ) : null}
                                  <p className="mt-1 text-[11px] text-slate-500">
                                    Envia os dados da ligação para processamento externo via n8n.
                                  </p>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <Modal
        title="Finalização de ligação"
        open={wrapupOpen}
        onClose={handleWrapupModalClose}
      >
        <form className="space-y-4" onSubmit={handleSaveWrapup} autoComplete="off">
          <section className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-sky-200">Dados da chamada</p>
                <h3 className="mt-1 text-sm font-semibold text-slate-100">Contexto principal da finalizacao</h3>
              </div>
              <span className="rounded-full border border-sky-400/40 bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-sky-200">
                Ligacao atual
              </span>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <label className="text-sm">
                Telefone da ligação
                <input className="field mt-1 font-mono" value={activeSession?.telefone || "-"} readOnly />
              </label>
              <label className="text-sm">
                Empresa
                <input
                  className="field mt-1"
                  value={postCallForm.company}
                  onChange={(event) => updateWrapupCompany(event.target.value)}
                  placeholder="Nome da empresa"
                  autoComplete="organization"
                />
              </label>
              <label className="text-sm">
                E-mail principal
                <input
                  type="email"
                  className="field mt-1"
                  value={wrapupLeadPrimaryEmail}
                  onChange={(event) => updateWrapupPrimaryEmail(event.target.value)}
                  placeholder="email@empresa.com"
                  autoComplete="email"
                />
              </label>
            </div>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-300">Finalizacao</p>
              <h3 className="mt-1 text-sm font-semibold text-slate-100">Defina o resultado da ligacao</h3>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="text-sm md:col-span-2">
                Finalização
                <select
                  className="field mt-1"
                  value={postCallForm.result}
                  onChange={(event) => {
                    const value = event.target.value as PostCallResultOption;
                    const suggestedNextAction = getSuggestedNextActionByFinalizacao(value);
                    setPostCallForm((prev) => ({
                      ...prev,
                      result: value,
                      reason: "",
                      nextAction: finalizacaoComProximaAcao.has(value)
                        ? (suggestedNextAction as PostCallSubfinalizacaoOption | "")
                        : "",
                    }));
                  }}
                >
                  {postCallResultOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {showReasonField ? (
                <label className="text-sm md:col-span-2">
                  Motivo
                  <select
                    className="field mt-1"
                    value={postCallForm.reason}
                    onChange={(event) =>
                      setPostCallForm((prev) => ({
                        ...prev,
                        reason: event.target.value as "Ja possui CRM e nao tem interesse" | "Outros" | "",
                      }))
                    }
                  >
                    <option value="">Selecione...</option>
                    <option value="Ja possui CRM e nao tem interesse">Já possui CRM e não tem interesse</option>
                    <option value="Outros">Outros</option>
                  </select>
                </label>
              ) : null}
              {showNextActionField ? (
                <label className="text-sm md:col-span-2">
                  {secondaryFieldLabel}
                  <select
                    className="field mt-1"
                    value={postCallForm.nextAction}
                    onChange={(event) =>
                      setPostCallForm((prev) => ({
                        ...prev,
                        nextAction: event.target.value as PostCallSubfinalizacaoOption | "",
                        reason: normalizeText(event.target.value) === "sem interesse" ? prev.reason : "",
                      }))
                    }
                  >
                    <option value="">Selecione...</option>
                    {currentSecondaryOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {showFollowUpFields ? (
                <div className="md:col-span-2">
                  <p className="text-sm text-slate-200">{scheduleSectionLabel}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Selecione dia e horario disponiveis em slots de 30 minutos e confirme em Agendar.
                  </p>
                  <div className="mt-2">
                    <SchedulePicker
                      valueDate={postCallForm.followUpDate}
                      valueTime={postCallForm.followUpTime}
                      ownerName={wrapupResolvedOwnerName || String(currentUser?.email || "").trim() || "sem-responsavel"}
                      sessionId={activeSession?.sessionId || undefined}
                      meetings={meetingsSnapshot}
                      blocks={agendaBlocks}
                      disabled={wrapupSaving}
                      onConfirm={(next) =>
                        setPostCallForm((prev) => ({
                          ...prev,
                          followUpDate: next.date,
                          followUpTime: next.time,
                        }))
                      }
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-300">Contatos do lead</p>
                <h3 className="mt-1 text-sm font-semibold text-slate-100">Gerencie telefones e e-mails antes de salvar</h3>
              </div>
              <span className="text-[11px] text-slate-400">
                {unclassifiedPhoneCount + unclassifiedEmailCount > 0
                  ? `${unclassifiedPhoneCount + unclassifiedEmailCount} contato(s) sem classificacao`
                  : "Todos os contatos classificados"}
              </span>
            </div>
            <div className="mt-3 flex flex-col gap-3">
          <div className="w-full rounded-lg border border-slate-800/90 bg-slate-900/40">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 p-3 text-left"
              onClick={() => setPhoneAccordionOpen((v) => !v)}
              aria-expanded={phoneAccordionOpen}
            >
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-200">Telefones</p>
                <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-300">
                  {postCallForm.phoneItems.length}
                </span>
              </div>
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${phoneAccordionOpen ? "rotate-180" : ""}`}
              >
                <path d="M4 6l4 4 4-4" />
              </svg>
            </button>
            {phoneAccordionOpen ? (
            <div className="px-3 pb-3">
            <p className="mb-2 text-[11px] text-slate-400">Classifique cada numero para apoiar a decisao de nova tentativa.</p>
            <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
              {postCallForm.phoneItems.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-700 px-2.5 py-2 text-xs text-slate-400">
                  Nenhum telefone cadastrado.
                </p>
              ) : (
                postCallForm.phoneItems.map((item, index) => {
                  const isPrimaryPhone =
                    Boolean(activeSessionPhoneDigits) && normalizeDigits(item.value) === activeSessionPhoneDigits;
                  return (
                    <div
                      key={`${item.value}-${index}`}
                      className="rounded-lg border border-slate-800 bg-slate-900/80 px-2.5 py-2"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-mono text-xs text-slate-100">{item.value}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            {isPrimaryPhone ? (
                              <span className="rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-sky-200">
                                Principal
                              </span>
                            ) : null}
                            <span className="text-[11px] text-slate-400">Status atual:</span>
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${contactQualityBadgeClass(item.quality)}`}
                            >
                              {contactQualityLabel(item.quality)}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[11px] font-medium text-rose-200 transition hover:bg-rose-500/20"
                          onClick={() => removeWrapupPhoneAt(index)}
                          aria-label={`Excluir telefone ${item.value}`}
                          title="Excluir telefone"
                        >
                          Excluir
                        </button>
                      </div>
                      <div className="mt-2">
                        <p className="text-[10px] uppercase tracking-[0.08em] text-slate-500">Alterar status</p>
                        <div className="mt-1 inline-flex overflow-hidden rounded-md border border-slate-700">
                          <button
                            type="button"
                            className={`px-2.5 py-1 text-[11px] transition ${contactQualityControlClass(item.quality, "bom")}`}
                            onClick={() => setWrapupPhoneQualityAt(index, "bom")}
                            aria-label={`Marcar telefone ${item.value} como bom`}
                          >
                            Bom
                          </button>
                          <button
                            type="button"
                            className={`border-l border-slate-700 px-2.5 py-1 text-[11px] transition ${contactQualityControlClass(item.quality, "ruim")}`}
                            onClick={() => setWrapupPhoneQualityAt(index, "ruim")}
                            aria-label={`Marcar telefone ${item.value} como ruim`}
                          >
                            Ruim
                          </button>
                          <button
                            type="button"
                            className={`border-l border-slate-700 px-2.5 py-1 text-[11px] transition ${contactQualityControlClass(item.quality, "nao_classificado")}`}
                            onClick={() => setWrapupPhoneQualityAt(index, undefined)}
                            aria-label={`Marcar telefone ${item.value} como nao classificado`}
                          >
                            N/C
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div className="mt-3 rounded-lg border border-slate-700/80 bg-slate-950/80 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-200">Adicionar telefone</p>
              <div className="mt-2 grid gap-2 lg:grid-cols-[minmax(0,1fr)_170px_auto] lg:items-end">
                <label className="text-[11px] text-slate-400">
                  Número do telefone
                  <input
                    ref={wrapupPhoneInputRef}
                    type="tel"
                    inputMode="tel"
                    name="wrapup_new_phone"
                    className="field mt-1 h-10 border-slate-600 bg-slate-950/90 placeholder:text-slate-500 focus:border-sky-500/60 focus:ring-2 focus:ring-sky-500/20"
                    placeholder="Ex.: (11) 99999-9999"
                    value={postCallForm.newPhoneValue}
                    onChange={(event) => setPostCallForm((prev) => ({ ...prev, newPhoneValue: event.target.value }))}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      upsertWrapupPhoneItem(postCallForm.newPhoneValue, toLeadContactQuality(postCallForm.newPhoneQuality));
                    }}
                    autoComplete="off"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    spellCheck={false}
                  />
                </label>
                <label className="text-[11px] text-slate-400">
                  Classificação inicial
                  <select
                    className="field mt-1 h-10 min-w-[120px] border-slate-600 bg-slate-950/90"
                    value={postCallForm.newPhoneQuality}
                    onChange={(event) =>
                      setPostCallForm((prev) => ({
                        ...prev,
                        newPhoneQuality: normalizeContactQualitySelection(event.target.value),
                      }))
                    }
                  >
                    <option value="bom">Bom</option>
                    <option value="ruim">Ruim</option>
                    <option value="nao_classificado">N/C</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="btn-ghost h-10 whitespace-nowrap px-3 py-1.5 text-xs"
                  onClick={() => upsertWrapupPhoneItem(postCallForm.newPhoneValue, toLeadContactQuality(postCallForm.newPhoneQuality))}
                >
                  + Adicionar
                </button>
              </div>
            </div>
            </div>
            ) : null}
          </div>

          <div className="w-full rounded-lg border border-slate-800/90 bg-slate-900/40">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 p-3 text-left"
              onClick={() => setEmailAccordionOpen((v) => !v)}
              aria-expanded={emailAccordionOpen}
            >
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-200">E-mails</p>
                <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-300">
                  {postCallForm.emailItems.length}
                </span>
              </div>
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${emailAccordionOpen ? "rotate-180" : ""}`}
              >
                <path d="M4 6l4 4 4-4" />
              </svg>
            </button>
            {emailAccordionOpen ? (
            <div className="px-3 pb-3">
            <p className="mb-2 text-[11px] text-slate-400">Deixe a qualidade clara para orientar o envio opcional nesta finalizacao.</p>
            <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
              {postCallForm.emailItems.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-700 px-2.5 py-2 text-xs text-slate-400">
                  Nenhum e-mail cadastrado.
                </p>
              ) : (
                postCallForm.emailItems.map((item, index) => (
                  <div
                    key={`${item.value}-${index}`}
                    className="rounded-lg border border-slate-800 bg-slate-900/80 px-2.5 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs text-slate-100" title={item.value}>
                        {item.value}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="text-[11px] text-slate-400">Status atual:</span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${contactQualityBadgeClass(item.quality)}`}
                        >
                          {contactQualityLabel(item.quality)}
                        </span>
                      </div>
                    </div>
                    <div className="mt-2">
                      <p className="text-[10px] uppercase tracking-[0.08em] text-slate-500">Alterar status</p>
                      <div className="mt-1 inline-flex overflow-hidden rounded-md border border-slate-700">
                        <button
                          type="button"
                          className={`px-2.5 py-1 text-[11px] transition ${contactQualityControlClass(item.quality, "bom")}`}
                          onClick={() => setWrapupEmailQualityAt(index, "bom")}
                          aria-label={`Marcar e-mail ${item.value} como bom`}
                        >
                          Bom
                        </button>
                        <button
                          type="button"
                          className={`border-l border-slate-700 px-2.5 py-1 text-[11px] transition ${contactQualityControlClass(item.quality, "ruim")}`}
                          onClick={() => setWrapupEmailQualityAt(index, "ruim")}
                          aria-label={`Marcar e-mail ${item.value} como ruim`}
                        >
                          Ruim
                        </button>
                        <button
                          type="button"
                          className={`border-l border-slate-700 px-2.5 py-1 text-[11px] transition ${contactQualityControlClass(item.quality, "nao_classificado")}`}
                          onClick={() => setWrapupEmailQualityAt(index, undefined)}
                          aria-label={`Marcar e-mail ${item.value} como nao classificado`}
                        >
                          N/C
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="mt-3 rounded-lg border border-slate-700/80 bg-slate-950/80 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-200">Adicionar e-mail</p>
              <div className="mt-2 grid gap-2 lg:grid-cols-[minmax(0,1fr)_170px_auto] lg:items-end">
                <label className="text-[11px] text-slate-400">
                  Endereço de e-mail
                  <input
                    ref={wrapupEmailInputRef}
                    type="email"
                    name="wrapup_new_email"
                    className="field mt-1 h-10 border-slate-600 bg-slate-950/90 placeholder:text-slate-500 focus:border-sky-500/60 focus:ring-2 focus:ring-sky-500/20"
                    placeholder="Ex.: contato@empresa.com"
                    value={postCallForm.newEmailValue}
                    onChange={(event) => setPostCallForm((prev) => ({ ...prev, newEmailValue: event.target.value }))}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      upsertWrapupEmailItem(postCallForm.newEmailValue, toLeadContactQuality(postCallForm.newEmailQuality));
                    }}
                    autoComplete="off"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    spellCheck={false}
                    autoCapitalize="none"
                    autoCorrect="off"
                  />
                </label>
                <label className="text-[11px] text-slate-400">
                  Classificação inicial
                  <select
                    className="field mt-1 h-10 min-w-[120px] border-slate-600 bg-slate-950/90"
                    value={postCallForm.newEmailQuality}
                    onChange={(event) =>
                      setPostCallForm((prev) => ({
                        ...prev,
                        newEmailQuality: normalizeContactQualitySelection(event.target.value),
                      }))
                    }
                  >
                    <option value="bom">Bom</option>
                    <option value="ruim">Ruim</option>
                    <option value="nao_classificado">N/C</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="btn-ghost h-10 whitespace-nowrap px-3 py-1.5 text-xs"
                  onClick={() => upsertWrapupEmailItem(postCallForm.newEmailValue, toLeadContactQuality(postCallForm.newEmailQuality))}
                >
                  + Adicionar
                </button>
              </div>
            </div>
            </div>
            ) : null}
          </div>
            </div>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-700/70 bg-slate-900/60 p-3 text-sm text-slate-200">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-sky-500"
                checked={postCallForm.sendEmail}
                onChange={(event) =>
                  setPostCallForm((prev) => ({
                    ...prev,
                    sendEmail: event.target.checked,
                    emailTarget: event.target.checked
                      ? prev.emailTarget || prev.primaryEmail || prev.emailItems[0]?.value || ""
                      : "",
                  }))
                }
              />
              <span className="flex-1">
                <span className="block font-medium text-slate-100">Enviar e-mail nesta finalizacao</span>
                <span className="mt-1 block text-xs text-slate-400">
                  Ative para concluir a ligação e disparar o webhook de e-mail no mesmo fluxo.
                </span>
              </span>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${
                  postCallForm.sendEmail
                    ? "border-sky-500/40 bg-sky-500/10 text-sky-200"
                    : "border-slate-600/70 bg-slate-800/70 text-slate-400"
                }`}
              >
                {postCallForm.sendEmail ? "Ativo" : "Opcional"}
              </span>
            </label>

            <div
              className={`mt-3 overflow-hidden transition-all duration-200 ${
                postCallForm.sendEmail ? "max-h-[460px] opacity-100 pointer-events-auto" : "max-h-0 opacity-0 pointer-events-none"
              }`}
              aria-hidden={!postCallForm.sendEmail}
            >
              <div className="grid gap-3 rounded-lg border border-slate-700/70 bg-slate-900/50 p-3">
                <label className="text-sm">
                  E-mail de destino
                  <select
                    className="field mt-1"
                    value={postCallForm.emailTarget}
                    onChange={(event) => setPostCallForm((prev) => ({ ...prev, emailTarget: event.target.value }))}
                    disabled={!hasEmailTargets}
                  >
                    <option value="">{hasEmailTargets ? "Selecione..." : "Sem e-mails cadastrados"}</option>
                    {availableWrapupEmailTargets.map((email) => (
                      <option key={email} value={email}>
                        {email}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  Mensagem do e-mail
                  <textarea
                    className="field mt-1 min-h-[120px]"
                    value={postCallForm.emailMessage}
                    onChange={(event) => setPostCallForm((prev) => ({ ...prev, emailMessage: event.target.value }))}
                    placeholder="Escreva a mensagem que sera enviada pelo fluxo integrado."
                  />
                </label>
                {wrapupSaving ? (
                  <p className="text-xs text-slate-400">Salvando finalização e disparando webhook de e-mail...</p>
                ) : null}
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-slate-800/80 bg-slate-950/35 p-4">
            <label className="text-sm">
              Observações
              <textarea
                className="field mt-1 min-h-[96px]"
                value={postCallForm.observations}
                onChange={(event) => setPostCallForm((prev) => ({ ...prev, observations: event.target.value }))}
                placeholder="Registre contexto adicional desta finalizacao (opcional)."
              />
            </label>
          </section>

          {activeSession && !activeSession.matchedCallId ? (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              Esta finalização será salva como pendente de conciliação até a chamada oficial ser identificada.
            </p>
          ) : null}

          {wrapupError ? (
            <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{wrapupError}</p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/70 pt-3">
            <p className="text-xs text-slate-400">Revise os dados acima e salve a finalização para concluir esta ligação.</p>
            <div className="flex items-center gap-2">
              <button type="button" className="btn-ghost" onClick={handleWrapupModalClose} disabled={wrapupSaving}>
                Minimizar
              </button>
              <button type="submit" className="btn-primary" disabled={wrapupSaving}>
                {wrapupSaving ? (postCallForm.sendEmail ? "Salvando e enviando e-mail..." : "Salvando...") : "Salvar finalização"}
              </button>
            </div>
          </div>
        </form>
      </Modal>
    </section>
  );
}



