"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { SchedulePicker } from "@/components/agenda/schedule-picker";
import { AgendaBlocks, emptyAgendaBlocks } from "@/components/agenda/agenda-types";
import { useAuth } from "@/components/auth/auth-provider";
import {
  getLeadsSnapshot,
  getMeetingsSnapshot,
  setLeadsSnapshot,
  setMeetingsSnapshot,
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
import { resolveResponsavelFromUserAsync } from "@/lib/responsavel-resolver";
import { getFinalizacaoClassification } from "@/lib/finalizacao-classification";
import {
  ActiveCallSession,
  PostCallResultOption,
  PostCallSubfinalizacaoOption,
  clearActiveCallSession,
  getActiveCallSession,
  getPendingPostCallWrapupsCount,
  markCallSessionWrapped,
  markSessionPrompted,
  reconcileWrapupsWithCallLogs,
  savePostCallWrapup,
  setWrapupSessionState,
  subscribePostCallFlow,
} from "@/lib/post-call-flow";
import type { EmailDispatchRequestBody, EmailDispatchResponse, CallFinalization } from "@/types/call-finalization";
import type { CallLog, Lead, LeadContactQuality, LeadEmail, LeadObservation, LeadPhone, Meeting } from "@/types/crm";

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

const WRAPUP_DRAFT_STORAGE_KEY = "crm:calls:wrapup-draft:v1";
const AGENDA_BLOCKS_STORAGE_KEY = "crm.agenda.blocks.v1";

function normalizeDigits(value?: string | null) {
  return String(value || "").replace(/\D/g, "");
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

const OFFICIAL_FINALIZACOES = new Set([
  "Ligação caiu",
  "Caixa postal",
  "Ligação muda",
  "Número inválido",
  "Pessoa não conhece",
  "Falou com cliente",
  "Falou com secretária",
]);

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

function normalizeMeetingPersonName(value?: string) {
  return String(value || "").trim().toLowerCase();
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

const runWrapupReconciliation = async () => {
  if (getPendingPostCallWrapupsCount() === 0) return;
  try {
    const response = await fetch("/api/ligacoes", { method: "GET", cache: "no-store" });
    if (!response.ok) return;
    const data = (await response.json()) as { success?: boolean; calls?: CallLog[] };
    if (!data.success || !Array.isArray(data.calls)) return;
    reconcileWrapupsWithCallLogs(data.calls);
  } catch {
    // noop
  }
};

export function GlobalWrapupModal() {
  const { currentUser } = useAuth();
  const [activeSession, setActiveSession] = useState<ActiveCallSession | null>(null);
  const [wrapupOpen, setWrapupOpen] = useState(false);
  const [wrapupSaving, setWrapupSaving] = useState(false);
  const [wrapupError, setWrapupError] = useState<string | null>(null);
  const [postCallForm, setPostCallForm] = useState<PostCallFormState>(createDefaultPostCallForm());
  const [agendaBlocks, setAgendaBlocks] = useState<AgendaBlocks>(emptyAgendaBlocks);
  const [wrapupResolvedOwnerName, setWrapupResolvedOwnerName] = useState("");
  const [phoneAccordionOpen, setPhoneAccordionOpen] = useState(false);
  const [emailAccordionOpen, setEmailAccordionOpen] = useState(false);
  const [meetingsSnapshot, setMeetingsSnapshotState] = useState<Meeting[]>(() => getMeetingsSnapshot());
  const currentWrapupSessionRef = useRef<string | null>(null);
  const handleRestoreWrapupRef = useRef<(() => void) | null>(null);
  const wrapupPhoneInputRef = useRef<HTMLInputElement | null>(null);
  const wrapupEmailInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const sync = () => setActiveSession(getActiveCallSession());
    sync();
    return subscribePostCallFlow(sync);
  }, []);

  useEffect(() => {
    const sync = () => setMeetingsSnapshotState(getMeetingsSnapshot());
    sync();
    return subscribeMeetingsSnapshot(sync);
  }, []);

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
    if (!wrapupOpen) return;
    setAgendaBlocks(readAgendaBlocksFromStorage());
  }, [wrapupOpen]);

  useEffect(() => {
    if (!activeSession || activeSession.status === "wrapped") {
      currentWrapupSessionRef.current = null;
      return;
    }

    const isNewSession = currentWrapupSessionRef.current !== activeSession.sessionId;
    if (isNewSession) {
      currentWrapupSessionRef.current = activeSession.sessionId;
      const leadsSnapshot = getLeadsSnapshot();
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
    }

    if (activeSession.wrapupState !== "opened" || wrapupOpen) return;

    if (activeSession.wrapupState !== "opened") {
      setWrapupSessionState(activeSession.sessionId, "opened");
    }
    setWrapupError(null);
    setWrapupOpen(true);
    if (!activeSession.promptedAt) {
      markSessionPrompted(activeSession.sessionId);
    }
  }, [activeSession, wrapupOpen]);

  useEffect(() => {
    if (!activeSession || activeSession.status === "wrapped") return;
    writeWrapupDraft(activeSession.sessionId, postCallForm);
  }, [activeSession, postCallForm]);

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

  useEffect(() => {
    const handleOpenWrapupEvent = () => {
      handleRestoreWrapupRef.current?.();
    };
    window.addEventListener("crm:open-wrapup", handleOpenWrapupEvent);
    return () => window.removeEventListener("crm:open-wrapup", handleOpenWrapupEvent);
  }, []);

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
    console.log("[WRAPUP_GLOBAL] WRAPUP_MODAL_MINIMIZED", {
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
    console.log("[WRAPUP_GLOBAL] WRAPUP_MODAL_RESTORED", {
      sessionId: activeSession.sessionId,
      externalCallId: activeSession.externalCallId || null,
      callId: activeSession.matchedCallId || null,
      leadId: activeSession.leadId || null,
      status: activeSession.status,
    });
  };

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
          localMeetings: getMeetingsSnapshot()
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

    try {
      let ownerName: string;
      let ownerId: string;

      if (currentUser?.responsavelVinculado && currentUser.responsavelId && currentUser.nome !== "Responsavel nao vinculado") {
        ownerName = currentUser.nome;
        ownerId = currentUser.responsavelId;
      } else {
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
        ownerName = resolvedResponsavel.responsavel.nome;
        ownerId = resolvedResponsavel.responsavel.id;
      }

      const currentCallEvidence: CurrentCallEvidence | undefined = undefined;

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
      console.log("[WRAPUP_GLOBAL] CALL_WRAPUP_MATCH_CONFIRMED", {
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
      console.log("[WRAPUP_GLOBAL] FINALIZATION_SAVED", {
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
        // wrapup saved successfully, no email dispatch
      } else if (emailDispatchOutcome.success) {
        // wrapup saved and email webhook dispatched successfully
      } else {
        console.warn("[WRAPUP_GLOBAL] EMAIL_DISPATCH_FAILED", {
          message: emailDispatchOutcome.message || "erro desconhecido.",
        });
      }
      await runWrapupReconciliation();
    } catch {
      setWrapupError("Não foi possível registrar a finalização desta ligação.");
    } finally {
      setWrapupSaving(false);
    }
  };

  return (
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
  );
}
