"use client";

import { useEffect, useMemo, useState } from "react";
import {
  formatAgendaChannelLabel,
  formatAgendaEventTypeLabel,
  getAgendaEventDisplayStatus,
  isAgendaEventLinkedToLead,
  normalizeMeetingsSnapshot,
  summarizeAgendaEvent,
} from "@/lib/agenda-events";
import { getMeetingsSnapshot, subscribeMeetingsSnapshot } from "@/lib/crm-data-store";
import { AgendaEventStatus, Lead, Meeting } from "@/types/crm";

type LeadAgendaTabProps = {
  lead: Lead;
};

type AgendaHistoryItem = {
  event: Meeting;
  displayStatus: AgendaEventStatus;
  relationText: string | null;
};

function formatDateBR(value?: string | null): string {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return raw || "-";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function formatDateTimeSortValue(event: Meeting): number {
  const dateRaw = String(event.date || "").trim();
  const timeRaw = String(event.callTime || "").trim();
  const dateMatch = dateRaw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = timeRaw.match(/^(\d{2}):(\d{2})$/);
  if (!dateMatch || !timeMatch) return 0;
  const date = new Date(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
    0,
    0,
  );
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function statusLabel(status: AgendaEventStatus): string {
  if (status === "ativo") return "Ativo";
  if (status === "concluido") return "Concluido";
  if (status === "remarcado") return "Remarcado";
  if (status === "cancelado") return "Cancelado";
  return "Apagado logicamente";
}

function statusBadgeClass(status: AgendaEventStatus): string {
  if (status === "ativo") return "border-sky-500/40 bg-sky-500/10 text-sky-200";
  if (status === "concluido") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
  if (status === "remarcado") return "border-amber-400/50 bg-amber-500/15 text-amber-200";
  if (status === "cancelado") return "border-rose-500/40 bg-rose-500/10 text-rose-200";
  return "border-slate-600/70 bg-slate-700/40 text-slate-300";
}

function buildRelationText(event: Meeting, eventsById: Map<string, Meeting>): string | null {
  if (event.rescheduledFromEventId) {
    const origin = eventsById.get(event.rescheduledFromEventId);
    if (!origin) return "Derivado de um evento anterior";
    return `Remarcado de ${formatDateBR(origin.date)} ${origin.callTime || ""}`.trim();
  }
  if (event.rescheduledToEventId) {
    const target = eventsById.get(event.rescheduledToEventId);
    if (!target) return "Gerou um novo evento";
    return `Gerou novo evento em ${formatDateBR(target.date)} ${target.callTime || ""}`.trim();
  }
  if (event.parentEventId) {
    const parent = eventsById.get(event.parentEventId);
    if (!parent) return "Evento vinculado a origem anterior";
    return `Evento vinculado a ${formatDateBR(parent.date)} ${parent.callTime || ""}`.trim();
  }
  return null;
}

export function LeadAgendaTab({ lead }: LeadAgendaTabProps) {
  const [meetings, setMeetings] = useState<Meeting[]>(() => normalizeMeetingsSnapshot(getMeetingsSnapshot()));

  useEffect(() => {
    const sync = () => {
      setMeetings(normalizeMeetingsSnapshot(getMeetingsSnapshot()));
    };
    sync();
    return subscribeMeetingsSnapshot(sync);
  }, []);

  const historyItems = useMemo<AgendaHistoryItem[]>(() => {
    const related = meetings.filter((event) => isAgendaEventLinkedToLead(event, lead));
    const byId = new Map(related.map((event) => [event.id, event]));
    return related
      .map((event) => ({
        event,
        displayStatus: getAgendaEventDisplayStatus(event),
        relationText: buildRelationText(event, byId),
      }))
      .sort((a, b) => {
        const first = formatDateTimeSortValue(a.event);
        const second = formatDateTimeSortValue(b.event);
        if (second !== first) return second - first;
        return String(b.event.updatedAt || "").localeCompare(String(a.event.updatedAt || ""));
      });
  }, [lead, meetings]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-slate-900/50 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-[0.09em] text-slate-200">Historico de Agenda</h3>
        <p className="mt-1 text-xs text-muted">
          Linha do tempo completa do lead com eventos ativos, concluidos, remarcados, cancelados e apagados logicamente.
        </p>
      </div>

      {historyItems.length === 0 ? (
        <div className="rounded-xl border border-border bg-slate-900/50 p-4 text-sm text-muted">
          Nenhum evento de agenda encontrado para este lead.
        </div>
      ) : (
        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          {historyItems.map((item) => {
            const typeLabel = formatAgendaEventTypeLabel(item.event.eventType, item.event.reason);
            const channelLabel = formatAgendaChannelLabel(item.event.channel);
            const summary = summarizeAgendaEvent(item.event);
            return (
              <button
                key={item.event.id}
                type="button"
                className="w-full rounded-xl border border-border bg-slate-900/50 p-4 text-left transition hover:border-slate-500 hover:bg-slate-900/80"
                onClick={() => {
                  const query = new URLSearchParams({
                    eventId: item.event.id,
                    leadId: lead.id,
                  });
                  window.location.assign(`/agenda?${query.toString()}`);
                }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${statusBadgeClass(item.displayStatus)}`}>
                      {statusLabel(item.displayStatus)}
                    </span>
                    <span className="rounded-md border border-slate-700 bg-slate-800/70 px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-slate-200">
                      {typeLabel}
                    </span>
                    <span className="rounded-md border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-slate-300">
                      {channelLabel}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    {formatDateBR(item.event.date)} - {item.event.callTime || "--:--"}
                  </p>
                </div>

                <p className="mt-2 text-sm text-slate-100">{summary}</p>
                {item.relationText ? <p className="mt-1 text-xs text-slate-300">{item.relationText}</p> : null}
                <p className="mt-2 text-[11px] text-emerald-300">Clique para abrir este evento na Agenda</p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
