"use client";

import { useMemo } from "react";
import { Meeting } from "@/types/crm";
import { AppointmentCard } from "./appointment-card";
import { AgendaBlocks } from "./agenda-types";
import {
  buildMeetingsByDateIndex,
  formatDayLabel,
  getCurrentReferenceDate,
  getDayMeetingsFromIndex,
  getNextValidHalfHourSlot,
  isPastDate,
  toIsoDate,
} from "./agenda-utils";
import { getTimeBlockReasons, isDateBlocked } from "./agenda-utils";

type AgendaDayViewProps = {
  selectedDate: Date;
  meetings: Meeting[];
  blocks: AgendaBlocks;
  onSelectMeeting: (meeting: Meeting) => void;
  onCreateOnDate: (date: string, time?: string) => void;
};

const timelineSlots = Array.from({ length: 25 }).map((_, index) => {
  const totalMinutes = 6 * 60 + index * 30;
  const hour = Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, "0");
  const minute = (totalMinutes % 60).toString().padStart(2, "0");
  return `${hour}:${minute}`;
});

export function AgendaDayView({
  selectedDate,
  meetings,
  blocks,
  onSelectMeeting,
  onCreateOnDate,
}: AgendaDayViewProps) {
  const reference = getCurrentReferenceDate();
  const isToday = toIsoDate(selectedDate) === toIsoDate(reference);
  const meetingsByDate = useMemo(() => buildMeetingsByDateIndex(meetings), [meetings]);
  const nextValidSlot = getNextValidHalfHourSlot(reference);
  const dayMeetings = getDayMeetingsFromIndex(meetingsByDate, selectedDate).filter(
    (meeting) => !(isToday && meeting.callTime < nextValidSlot),
  );
  const selectedIso = toIsoDate(selectedDate);
  const wholeDayBlocked = isDateBlocked(selectedIso, blocks);
  const minSlot = isToday ? nextValidSlot : "00:00";
  const visibleSlots = timelineSlots.filter((slot) => slot >= minSlot && slot <= "23:59");

  if (isPastDate(selectedDate, reference)) {
    return (
      <section className="rounded-2xl border border-slate-300 bg-slate-200/80 p-4 shadow-sm">
        <p className="text-sm text-slate-600">Nao ha horarios disponiveis para datas passadas.</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <header className="mb-4 border-b border-slate-200 pb-3">
        <h3 className="text-lg font-semibold text-slate-800">{formatDayLabel(selectedDate)}</h3>
        <p className="text-sm font-medium text-slate-500">
          {selectedDate.toLocaleDateString("pt-BR", { weekday: "long" })}
        </p>
      </header>

      <div className="rounded-lg border border-slate-200">
        {visibleSlots.map((slot) => {
          const slotHour = Number(slot.slice(0, 2));
          const slotMeetings = dayMeetings.filter((meeting) => meeting.callTime === slot);
          const periodLabel = slot === "06:00" ? "MANHA" : slot === "12:00" ? "TARDE" : null;
          const blockReasons = getTimeBlockReasons(selectedIso, slot, blocks);
          const slotBlocked = blockReasons.length > 0;

          return (
            <button
              key={slot}
              type="button"
              onClick={() => onCreateOnDate(selectedIso, slot)}
              className={`grid w-full grid-cols-[74px_1fr] border-b border-slate-100 text-left last:border-b-0 ${
                slotBlocked ? "bg-rose-50/70 hover:bg-rose-50" : "hover:bg-slate-50"
              }`}
            >
              <div className="flex items-start justify-end gap-2 border-r border-slate-100 px-2 py-2 text-xs text-slate-500">
                <span>{slot}</span>
                {periodLabel ? <span className="font-semibold text-slate-400">{periodLabel}</span> : null}
              </div>
              <div className="space-y-2 px-3 py-2">
                {slotBlocked ? (
                  <p className="rounded bg-rose-100 px-2 py-1 text-[11px] font-medium text-rose-700">
                    Bloqueado: {blockReasons[0]}
                  </p>
                ) : null}
                {slotMeetings.map((meeting) => (
                  <div key={meeting.id}>
                    <AppointmentCard meeting={meeting} onClick={onSelectMeeting} />
                    <p className="mt-1 text-xs text-slate-500">Faixa: {meeting.callTime} - 30 min</p>
                  </div>
                ))}
              </div>
            </button>
          );
        })}
      </div>
      {wholeDayBlocked ? (
        <p className="mt-3 text-xs font-medium text-rose-700">
          Este dia possui bloqueio de agenda. Nao e permitido criar novos agendamentos em horarios bloqueados.
        </p>
      ) : null}
    </section>
  );
}
