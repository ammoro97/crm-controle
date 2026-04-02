import { isAgendaEventLinkedToLead, normalizeAgendaEventStatus, normalizeText as normalizeAgendaText } from "@/lib/agenda-events";
import { getLeadPhones } from "@/lib/lead-contact-utils";
import { CallLog, Lead, LeadFinalizationRecord, Meeting } from "@/types/crm";
import type { PostCallWrapup } from "@/lib/post-call-flow";

export type OutboundDashboardFunnel = {
  leadsProspectados: number;
  ligacoesAtendidas: number;
  contatosComDecisor: number;
  callsAgendadas: number;
};

export type OutboundDashboardMetrics = {
  totalLeadsProspectados: number;
  totalLeadsAtivos: number;
  totalCallsAgendadas: number;
  totalContatosDecisor: number;
  taxaConversao: number;
  coberturaBaseRatio: number;
  coberturaBasePercent: number;
  totalLeadsFinalizados: number;
  totalComprasEfetuadas: number;
  valorTotalFeitoCents: number;
  totalLigacoesAtendidas: number;
  totalLigacoesFeitas: number;
  totalEmailsEnviados: number;
  totalFollowupsPendentes: number;
  funnel: OutboundDashboardFunnel;
};

type OutboundMetricsInput = {
  leads: Lead[];
  meetings: Meeting[];
  callLogs: CallLog[];
  wrapups: PostCallWrapup[];
  finalizations?: LeadFinalizationRecord[];
  referenceDate?: Date;
};

type OutboundAggregationContext = {
  outboundLeads: Lead[];
  outboundLeadIds: Set<string>;
  phoneIndex: Map<string, Set<string>>;
  leadsWithAnsweredCall: Set<string>;
  leadsWithDecisionContact: Set<string>;
  leadsWithScheduledCall: Set<string>;
  totalLigacoesFeitas: number;
  totalLigacoesAtendidas: number;
  totalFollowupsPendentes: number;
  totalEmailsEnviados: number;
};

const EMPTY_OUTBOUND_DASHBOARD_METRICS: OutboundDashboardMetrics = {
  totalLeadsProspectados: 0,
  totalCallsAgendadas: 0,
  totalLeadsAtivos: 0,
  totalContatosDecisor: 0,
  taxaConversao: 0,
  coberturaBaseRatio: 0,
  coberturaBasePercent: 0,
  totalLeadsFinalizados: 0,
  totalComprasEfetuadas: 0,
  valorTotalFeitoCents: 0,
  totalLigacoesAtendidas: 0,
  totalLigacoesFeitas: 0,
  totalEmailsEnviados: 0,
  totalFollowupsPendentes: 0,
  funnel: {
    leadsProspectados: 0,
    ligacoesAtendidas: 0,
    contatosComDecisor: 0,
    callsAgendadas: 0,
  },
};

function normalizeDigits(value?: string | null): string {
  return String(value || "").replace(/\D/g, "");
}

function normalizeLeadId(value?: string | null): string {
  return String(value || "").trim();
}

function isIsoDate(value?: string | null): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function parseTime(value?: string | null): { hour: number; minute: number } | null {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function buildLocalDateTime(date?: string | null, time?: string | null): Date | null {
  if (!isIsoDate(date)) return null;
  const parsedTime = parseTime(time);
  if (!parsedTime) return null;

  const [yearRaw, monthRaw, dayRaw] = String(date).split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw) - 1;
  const day = Number(dayRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

  const parsed = new Date(year, month, day, parsedTime.hour, parsedTime.minute, 0, 0);
  if (Number.isNaN(parsed.getTime())) return null;
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month ||
    parsed.getDate() !== day ||
    parsed.getHours() !== parsedTime.hour ||
    parsed.getMinutes() !== parsedTime.minute
  ) {
    return null;
  }

  return parsed;
}

function buildLeadPhoneIndex(leads: Lead[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const lead of leads) {
    const leadId = normalizeLeadId(lead.id);
    if (!leadId) continue;
    for (const phone of getLeadPhones(lead)) {
      const digits = normalizeDigits(phone);
      if (!digits) continue;
      const current = index.get(digits) || new Set<string>();
      current.add(leadId);
      index.set(digits, current);
    }
  }
  return index;
}

function resolveLeadIdByPhone(
  values: Array<string | null | undefined>,
  leadPhoneIndex: Map<string, Set<string>>,
): string | null {
  const phones = values.map((value) => normalizeDigits(value)).filter(Boolean);
  if (phones.length === 0) return null;

  const exactMatches = new Set<string>();
  for (const phone of phones) {
    const leadIds = leadPhoneIndex.get(phone);
    if (!leadIds || leadIds.size !== 1) continue;
    exactMatches.add(Array.from(leadIds)[0]);
  }
  if (exactMatches.size === 1) return Array.from(exactMatches)[0];

  const fuzzyMatches = new Set<string>();
  for (const phone of phones) {
    for (const [leadPhone, leadIds] of leadPhoneIndex.entries()) {
      if (!(leadPhone.endsWith(phone) || phone.endsWith(leadPhone))) continue;
      for (const leadId of leadIds) fuzzyMatches.add(leadId);
    }
  }
  if (fuzzyMatches.size === 1) return Array.from(fuzzyMatches)[0];

  return null;
}

function resolveOutboundLeadIdByCall(
  call: CallLog,
  outboundLeadIds: Set<string>,
  phoneIndex: Map<string, Set<string>>,
): string | null {
  const directLeadId = normalizeLeadId(call.leadId);
  if (directLeadId && outboundLeadIds.has(directLeadId)) return directLeadId;
  const byPhone = resolveLeadIdByPhone([call.telefone, call.called, call.caller], phoneIndex);
  if (byPhone && outboundLeadIds.has(byPhone)) return byPhone;
  return null;
}

function resolveOutboundLeadIdByWrapup(
  wrapup: PostCallWrapup,
  outboundLeadIds: Set<string>,
  phoneIndex: Map<string, Set<string>>,
): string | null {
  const directLeadId = normalizeLeadId(wrapup.leadId);
  if (directLeadId && outboundLeadIds.has(directLeadId)) return directLeadId;
  const byPhone = resolveLeadIdByPhone([wrapup.telefone], phoneIndex);
  if (byPhone && outboundLeadIds.has(byPhone)) return byPhone;
  return null;
}

function resolveOutboundLeadIdByMeeting(meeting: Meeting, outboundLeads: Lead[], outboundLeadIds: Set<string>): string | null {
  const directLeadId = normalizeLeadId(meeting.leadId);
  if (directLeadId && outboundLeadIds.has(directLeadId)) return directLeadId;

  const linkedLead = outboundLeads.find((lead) => isAgendaEventLinkedToLead(meeting, lead));
  return linkedLead ? linkedLead.id : null;
}

function isAnsweredCall(status?: string | null): boolean {
  const normalized = normalizeAgendaText(status);
  return normalized === "atendida" || normalized === "answered";
}

function isCallScheduledEvent(meeting: Meeting): boolean {
  const eventType = normalizeAgendaText(meeting.eventType);
  const reason = normalizeAgendaText(meeting.reason);

  if (eventType === "call_agendada" || eventType === "call_conversao" || eventType === "follow_up_ligacao") {
    return true;
  }
  if (eventType === "follow_up_whatsapp" || eventType === "follow_up_email") {
    return false;
  }
  if (reason === "apresentacao" || reason === "acompanhamento" || reason === "fechamento") return true;
  if ((reason === "follow-up" || reason === "follow up") && (!eventType || eventType === "outro")) return true;
  return false;
}

function isFollowupEvent(meeting: Meeting): boolean {
  const eventType = normalizeAgendaText(meeting.eventType);
  const reason = normalizeAgendaText(meeting.reason);
  if (eventType.startsWith("follow_up_")) return true;
  return reason === "follow-up" || reason === "follow up";
}

function isFutureActiveMeeting(meeting: Meeting, referenceDate: Date): boolean {
  if (normalizeAgendaEventStatus(meeting) !== "ativo") return false;
  const dateTime = buildLocalDateTime(meeting.date, meeting.callTime);
  if (!dateTime) return false;
  return dateTime.getTime() >= referenceDate.getTime();
}

function hasDecisionContactByLeadData(lead: Lead): boolean {
  return normalizeAgendaText(lead.outboundQualification?.decisionMakerIdentified) === "sim";
}

function hasDecisionContactByWrapup(wrapup: PostCallWrapup): boolean {
  return normalizeAgendaText(wrapup.rightPerson) === "sim";
}

function isOutboundEmailSentObservation(text?: string | null): boolean {
  const normalized = normalizeAgendaText(text);
  return normalized.includes("envio de e-mail no wrap-up: sim") || normalized.includes("envio de email no wrap-up: sim");
}

function createOutboundAggregationContext(input: OutboundMetricsInput): OutboundAggregationContext {
  const referenceDate = input.referenceDate || new Date();
  const outboundLeads = input.leads.filter((lead) => lead.channel === "outbound");
  const outboundLeadIds = new Set(outboundLeads.map((lead) => lead.id));
  const phoneIndex = buildLeadPhoneIndex(outboundLeads);

  const leadsWithAnsweredCall = new Set<string>();
  let totalLigacoesFeitas = 0;
  let totalLigacoesAtendidas = 0;

  for (const call of input.callLogs) {
    const leadId = resolveOutboundLeadIdByCall(call, outboundLeadIds, phoneIndex);
    if (!leadId) continue;
    totalLigacoesFeitas += 1;
    if (!isAnsweredCall(call.status)) continue;
    totalLigacoesAtendidas += 1;
    leadsWithAnsweredCall.add(leadId);
  }

  const leadsWithDecisionContact = new Set<string>();
  for (const lead of outboundLeads) {
    if (hasDecisionContactByLeadData(lead)) {
      leadsWithDecisionContact.add(lead.id);
    }
  }
  for (const wrapup of input.wrapups) {
    if (!hasDecisionContactByWrapup(wrapup)) continue;
    const leadId = resolveOutboundLeadIdByWrapup(wrapup, outboundLeadIds, phoneIndex);
    if (leadId) leadsWithDecisionContact.add(leadId);
  }

  // Mantem ordem natural do funil: contato com decisor vem depois de ligacao atendida.
  for (const leadId of Array.from(leadsWithDecisionContact)) {
    if (!leadsWithAnsweredCall.has(leadId)) {
      leadsWithDecisionContact.delete(leadId);
    }
  }

  const leadsWithScheduledCall = new Set<string>();
  let totalFollowupsPendentes = 0;

  for (const meeting of input.meetings) {
    const leadId = resolveOutboundLeadIdByMeeting(meeting, outboundLeads, outboundLeadIds);
    if (!leadId) continue;
    if (!isFutureActiveMeeting(meeting, referenceDate)) continue;

    if (isFollowupEvent(meeting)) {
      totalFollowupsPendentes += 1;
    }

    if (!isCallScheduledEvent(meeting)) continue;
    if (!leadsWithDecisionContact.has(leadId)) continue;
    leadsWithScheduledCall.add(leadId);
  }

  let totalEmailsEnviados = 0;
  for (const lead of outboundLeads) {
    for (const observation of lead.observationLog || []) {
      if (!isOutboundEmailSentObservation(observation.content)) continue;
      totalEmailsEnviados += 1;
    }
  }

  return {
    outboundLeads,
    outboundLeadIds,
    phoneIndex,
    leadsWithAnsweredCall,
    leadsWithDecisionContact,
    leadsWithScheduledCall,
    totalLigacoesFeitas,
    totalLigacoesAtendidas,
    totalFollowupsPendentes,
    totalEmailsEnviados,
  };
}

export function getTotalLeadsOutbound(leads: Lead[]): number {
  return leads.filter((lead) => lead.channel === "outbound").length;
}

export function getTotalLeadsAtivos(leads: Lead[]): number {
  return getTotalLeadsOutbound(leads);
}

export function getTotalCallsAgendadas(input: OutboundMetricsInput): number {
  return createOutboundAggregationContext(input).leadsWithScheduledCall.size;
}

export function getTotalLigacoesAtendidas(input: OutboundMetricsInput): number {
  return createOutboundAggregationContext(input).totalLigacoesAtendidas;
}

export function getTotalContatosDecisor(input: OutboundMetricsInput): number {
  return createOutboundAggregationContext(input).leadsWithDecisionContact.size;
}

export function getEmailsEnviados(leads: Lead[]): number {
  let total = 0;
  for (const lead of leads) {
    if (lead.channel !== "outbound") continue;
    for (const observation of lead.observationLog || []) {
      if (!isOutboundEmailSentObservation(observation.content)) continue;
      total += 1;
    }
  }
  return total;
}

export function getLigacoesFeitas(input: OutboundMetricsInput): number {
  return createOutboundAggregationContext(input).totalLigacoesFeitas;
}

export function getFollowupsPendentes(input: OutboundMetricsInput): number {
  return createOutboundAggregationContext(input).totalFollowupsPendentes;
}

export function getCoberturaDaBase(totalLigacoes: number, leadsAtivos: number): number {
  if (leadsAtivos <= 0) return 0;
  return totalLigacoes / leadsAtivos;
}

export function getTotalLeadsFinalizados(finalizations: LeadFinalizationRecord[]): number {
  return finalizations.filter((item) => item.channel === "outbound" && item.finalizationSource === "lead_profile").length;
}

export function getTotalComprasEfetuadas(finalizations: LeadFinalizationRecord[]): number {
  return finalizations.filter(
    (item) =>
      item.channel === "outbound" &&
      item.finalizationSource === "lead_profile" &&
      item.reason === "compra_efetuada",
  ).length;
}

export function getValorTotalFeitoCents(finalizations: LeadFinalizationRecord[]): number {
  return finalizations
    .filter(
      (item) =>
        item.channel === "outbound" &&
        item.finalizationSource === "lead_profile" &&
        item.reason === "compra_efetuada" &&
        Number.isFinite(item.saleValueCents) &&
        Number(item.saleValueCents) > 0,
    )
    .reduce((total, item) => total + Number(item.saleValueCents), 0);
}

export function calculateOutboundConversionRate(callsAgendadas: number, contatosDecisor: number): number {
  if (contatosDecisor <= 0) return 0;
  return (callsAgendadas / contatosDecisor) * 100;
}

export function buildOutboundDashboardMetrics(input: OutboundMetricsInput): OutboundDashboardMetrics {
  const context = createOutboundAggregationContext(input);
  const finalizations = input.finalizations || [];

  const totalLeadsAtivos = context.outboundLeads.length;
  const totalLeadsFinalizados = getTotalLeadsFinalizados(finalizations);
  const totalComprasEfetuadas = getTotalComprasEfetuadas(finalizations);
  const valorTotalFeitoCents = getValorTotalFeitoCents(finalizations);
  const coberturaBaseRatio = getCoberturaDaBase(context.totalLigacoesFeitas, totalLeadsAtivos);
  const coberturaBasePercent = coberturaBaseRatio * 100;

  if (context.outboundLeads.length === 0) {
    return {
      ...EMPTY_OUTBOUND_DASHBOARD_METRICS,
      totalLeadsFinalizados,
      totalComprasEfetuadas,
      valorTotalFeitoCents,
    };
  }

  const totalLeadsProspectados = context.outboundLeads.length;
  const totalContatosDecisor = context.leadsWithDecisionContact.size;
  const totalCallsAgendadas = context.leadsWithScheduledCall.size;
  const taxaConversao = calculateOutboundConversionRate(totalCallsAgendadas, totalContatosDecisor);

  return {
    totalLeadsProspectados,
    totalLeadsAtivos,
    totalCallsAgendadas,
    totalContatosDecisor,
    taxaConversao,
    coberturaBaseRatio,
    coberturaBasePercent,
    totalLeadsFinalizados,
    totalComprasEfetuadas,
    valorTotalFeitoCents,
    totalLigacoesAtendidas: context.totalLigacoesAtendidas,
    totalLigacoesFeitas: context.totalLigacoesFeitas,
    totalEmailsEnviados: context.totalEmailsEnviados,
    totalFollowupsPendentes: context.totalFollowupsPendentes,
    funnel: {
      leadsProspectados: totalLeadsProspectados,
      ligacoesAtendidas: context.leadsWithAnsweredCall.size,
      contatosComDecisor: totalContatosDecisor,
      callsAgendadas: totalCallsAgendadas,
    },
  };
}
