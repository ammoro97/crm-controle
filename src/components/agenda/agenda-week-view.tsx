"use client";

import { useMemo } from "react";
import { Meeting } from "@/types/crm";
import { AppointmentCard } from "./appointment-card";
import { AgendaBlocks } from "./agenda-types";
import {
  buildMeetingsByDateIndex,
  getCurrentReferenceDate,
  getDayMeetingsFromIndex,
  getWeekDays,
  isPastDate,
  toIsoDate,
} from "./agenda-utils";
import { hasSpecificTimeBlockOnDate, isDateBlocked } from "./agenda-utils";

type AgendaWeekViewProps = {
  selectedDate: Date;
  meetings: Meeting[];
  blocks: AgendaBlocks;
  onSelectDate: (date: Date) => void;
  onCreateOnDate: (date: string, time?: string) => void;
  onSelectMeeting: (meeting: Meeting) => void;
};

export function AgendaWeekView({
  selectedDate,
  meetings,
  blocks,
  onSelectDate,
  onCreateOnDate,
  onSelectMeeting,
}: AgendaWeekViewProps) {
  const reference = getCurrentReferenceDate();
  const weekDays = getWeekDays(selectedDate, reference);
  const meetingsByDate = useMemo(() => buildMeetingsByDateIndex(meetings), [meetings]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-7">
        {weekDays.map((day) => {
          const dayMeetings = getDayMeetingsFromIndex(meetingsByDate, day);
          const iso = toIsoDate(day);
          const isPast = isPastDate(day, reference);
          const blocked = isDateBlocked(iso, blocks);
          const hasTimeBlock = hasSpecificTimeBlockOnDate(iso, blocks);

          return (
            <button
              key={iso}
              type="button"
              disabled={isPast}
              onClick={() => {
                onSelectDate(day);
                onCreateOnDate(iso);
              }}
              className={`min-h-44 rounded-lg border p-2 text-left transition ${
                isPast
                  ? "cursor-not-allowed border-slate-300 bg-slate-200/80 hover:bg-slate-200/80"
                  : blocked
                    ? "border-slate-200 bg-rose-50/70 hover:bg-rose-50/80"
                    : "border-slate-200 bg-white hover:bg-slate-50"
              }`}
            >
              <div className="mb-2 border-b border-slate-100 pb-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {day.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "")}
                </p>
                <p className={`text-sm font-semibold ${isPast ? "text-slate-500" : "text-slate-700"}`}>{day.getDate()}</p>
              </div>
              {blocked ? (
                <p
                  className={`mb-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    isPast ? "bg-rose-100/70 text-rose-500" : "bg-rose-100 text-rose-700"
                  }`}
                >
                  Dia bloqueado
                </p>
              ) : hasTimeBlock ? (
                <p
                  className={`mb-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    isPast ? "bg-amber-100/70 text-amber-600" : "bg-amber-100 text-amber-700"
                  }`}
                >
                  Horarios bloqueados
                </p>
              ) : null}
              <div className="space-y-1.5">
                {dayMeetings.map((meeting) => (
                  <AppointmentCard key={meeting.id} meeting={meeting} onClick={onSelectMeeting} compact muted={isPast} />
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
