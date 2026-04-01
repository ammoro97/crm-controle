import { getLeadNames, getLeadPhones } from "@/lib/lead-contact-utils";
import {
  AgendaEventChannel,
  AgendaEventStatus,
  AgendaEventType,
  CallReason,
  Lead,
  Meeting,
} from "@/types/crm";

const STATUS_ALIASES: Record<string, AgendaEventStatus> = {
  ativo: "ativo",
  active: "ativo",
  concluido: "concluido",
  completed: "concluido",
  remarcado: "remarcado",
  rescheduled: "remarcado",
  cancelado: "cancelado",
  cancelled: "cancelado",
  canceled: "cancelado",
  apagado_logico: "apagado_logico",
  excluido_logico: "apagado_logico",
  deleted: "apagado_logico",
};

export function normalizeText(value?: string | null): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function normalizeLeadId(value?: string | null): string {
  return String(value || "").trim();
}

function parseLocalDateTime(dateIso?: string | null, time?: string | null): Date | null {
  const dateRaw = String(dateIso || "").trim();
  const timeRaw = String(time || "").trim();
  const dateMatch = dateRaw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = timeRaw.match(/^(\d{2}):(\d{2})$/);
  if (!dateMatch || !timeMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]) - 1;
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    return null;
  }

  const date = new Date(year, month, day, hour, minute, 0, 0);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function isPastAgendaDateTime(
  dateIso?: string | null,
  time?: string | null,
  referenceDate = new Date(),
): boolean {
  const target = parseLocalDateTime(dateIso, time);
  if (!target) return false;
  return target.getTime() < referenceDate.getTime();
}

export function normalizeAgendaEventStatus(meeting: Meeting): AgendaEventStatus {
  const explicit = normalizeText(meeting.status);
  if (explicit && STATUS_ALIASES[explicit]) return STATUS_ALIASES[explicit];
  if (meeting.deletedAt) return "apagado_logico";
  if (meeting.canceledAt) return "cancelado";
  if (meeting.rescheduledToEventId) return "remarcado";
  if (meeting.completedAt) return "concluido";
  return "ativo";
}

export function getAgendaEventDisplayStatus(meeting: Meeting, referenceDate = new Date()): AgendaEventStatus {
  const baseStatus = normalizeAgendaEventStatus(meeting);
  if (baseStatus !== "ativo") return baseStatus;
  if (isPastAgendaDateTime(meeting.date, meeting.callTime, referenceDate)) return "concluido";
  return "ativo";
}

export function isMeetingActiveForScheduling(meeting: Meeting): boolean {
  return normalizeAgendaEventStatus(meeting) === "ativo";
}

export function ensureAgendaEventDefaults(meeting: Meeting): Meeting {
  const fallbackCreatedAt = (() => {
    const fromDateTime = parseLocalDateTime(meeting.date, meeting.callTime);
    if (fromDateTime) return fromDateTime.toISOString();
    return "1970-01-01T00:00:00.000Z";
  })();
  const createdAt = String(meeting.createdAt || "").trim() || fallbackCreatedAt;
  const updatedAt = String(meeting.updatedAt || "").trim() || createdAt;
  return {
    ...meeting,
    leadId: normalizeLeadId(meeting.leadId) || null,
    status: normalizeAgendaEventStatus(meeting),
    createdAt,
    updatedAt,
    deletedAt: meeting.deletedAt || null,
    canceledAt: meeting.canceledAt || null,
    completedAt: meeting.completedAt || null,
    parentEventId: meeting.parentEventId || null,
    rescheduledFromEventId: meeting.rescheduledFromEventId || null,
    rescheduledToEventId: meeting.rescheduledToEventId || null,
  };
}

export function normalizeMeetingsSnapshot(meetings: Meeting[]): Meeting[] {
  if (!Array.isArray(meetings)) return [];
  return meetings.map((meeting) => ensureAgendaEventDefaults(meeting));
}

export function inferAgendaEventTypeFromReason(reason?: CallReason | string | null): AgendaEventType {
  const normalized = normalizeText(reason);
  if (normalized === "follow-up" || normalized === "follow up") return "follow_up_ligacao";
  if (normalized === "apresentacao" || normalized === "acompanhamento") return "call_agendada";
  if (normalized === "fechamento") return "call_conversao";
  return "outro";
}

export function inferAgendaEventTypeFromNextAction(nextAction?: string | null): AgendaEventType {
  const normalized = normalizeText(nextAction);
  if (!normalized) return "outro";
  if (normalized.includes("whatsapp")) return "follow_up_whatsapp";
  if (normalized.includes("email") || normalized.includes("e-mail")) return "follow_up_email";
  if (
    normalized.includes("ligacao") ||
    normalized.includes("ligar") ||
    normalized.includes("retorno")
  ) {
    return "follow_up_ligacao";
  }
  if (normalized.includes("video")) return "call_conversao";
  if (normalized.includes("reuniao") || normalized.includes("call")) return "call_agendada";
  return "outro";
}

export function inferAgendaChannelFromType(type?: AgendaEventType | null): AgendaEventChannel {
  if (type === "follow_up_whatsapp") return "whatsapp";
  if (type === "follow_up_email") return "email";
  if (type === "call_agendada" || type === "call_conversao") return "video";
  if (type === "follow_up_ligacao") return "ligacao";
  return "outro";
}

export function formatAgendaEventTypeLabel(type?: AgendaEventType | null, reason?: string | null): string {
  if (type === "follow_up_whatsapp") return "Follow-up WhatsApp";
  if (type === "follow_up_email") return "Follow-up E-mail";
  if (type === "follow_up_ligacao") return "Follow-up Ligacao";
  if (type === "call_agendada") return "Call Agendada";
  if (type === "call_conversao") return "Call de Conversao";
  if (type === "reagendamento") return "Reagendamento";
  if (type === "cancelamento") return "Cancelamento";
  if (type === "exclusao_logica") return "Exclusao logica";

  const normalizedReason = normalizeText(reason);
  if (normalizedReason === "follow-up" || normalizedReason === "follow up") return "Follow-up Ligacao";
  if (normalizedReason === "apresentacao" || normalizedReason === "acompanhamento") return "Call Agendada";
  if (normalizedReason === "fechamento") return "Call de Conversao";
  return "Evento de Agenda";
}

export function formatAgendaChannelLabel(channel?: AgendaEventChannel | string | null): string {
  const normalized = normalizeText(channel);
  if (normalized === "whatsapp") return "WhatsApp";
  if (normalized === "email") return "E-mail";
  if (normalized === "ligacao") return "Ligacao";
  if (normalized === "video") return "Video";
  return "Nao informado";
}

export function extractLeadIdMarker(notes?: string | null): string | null {
  const raw = String(notes || "");
  const marker = raw.match(/\[LEAD:([^\]]+)\]/i);
  if (!marker) return null;
  const leadId = normalizeLeadId(marker[1]);
  return leadId || null;
}

export function isAgendaEventLinkedToLead(meeting: Meeting, lead: Lead): boolean {
  const eventLeadId = normalizeLeadId(meeting.leadId);
  const leadId = normalizeLeadId(lead.id);
  if (eventLeadId && leadId && eventLeadId === leadId) return true;

  const markerLeadId = extractLeadIdMarker(meeting.notes);
  if (markerLeadId && leadId && markerLeadId === leadId) return true;

  const leadNames = new Set(
    getLeadNames(lead)
      .map((name) => normalizeText(name))
      .filter(Boolean),
  );
  const personName = normalizeText(meeting.personName);
  if (personName && leadNames.has(personName)) return true;

  const leadCompany = normalizeText(lead.company);
  if (personName && leadCompany && personName === leadCompany) return true;

  const notesDigits = String(meeting.notes || "").replace(/\D/g, "");
  if (notesDigits.length >= 8) {
    const phones = getLeadPhones(lead).map((phone) => String(phone || "").replace(/\D/g, "")).filter(Boolean);
    if (phones.some((phone) => notesDigits.includes(phone) || phone.includes(notesDigits))) return true;
  }

  return false;
}

export function summarizeAgendaEvent(meeting: Meeting): string {
  const rawNotes = String(meeting.notes || "").trim();
  if (rawNotes) {
    const firstLine = rawNotes.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (firstLine) return firstLine;
  }
  return formatAgendaEventTypeLabel(meeting.eventType, meeting.reason);
}
