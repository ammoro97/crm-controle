"use client";

import { useMemo } from "react";
import { Meeting } from "@/types/crm";
import { AppointmentCard } from "./appointment-card";
import { AgendaBlocks } from "./agenda-types";
import {
  buildMeetingsByDateIndex,
  getCurrentReferenceDate,
  getDayMeetingsFromIndex,
  getMonthGridDays,
  isPastDate,
  toIsoDate,
} from "./agenda-utils";
import { hasSpecificTimeBlockOnDate, isDateBlocked } from "./agenda-utils";

type AgendaMonthViewProps = {
  selectedDate: Date;
  meetings: Meeting[];
  blocks: AgendaBlocks;
  onSelectDate: (date: Date) => void;
  onCreateOnDate: (date: string, time?: string) => void;
  onSelectMeeting: (meeting: Meeting) => void;
};

const weekLabels = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SAB"];

export function AgendaMonthView({
  selectedDate,
  meetings,
  blocks,
  onSelectDate,
  onCreateOnDate,
  onSelectMeeting,
}: AgendaMonthViewProps) {
  const reference = getCurrentReferenceDate();
  const days = getMonthGridDays(selectedDate);
  const meetingsByDate = useMemo(() => buildMeetingsByDateIndex(meetings), [meetings]);

  return (
    <section className="rounded-2xl border border-border bg-panel shadow-panel">
      <div className="grid grid-cols-7 border-b border-border px-1">
        {weekLabels.map((label) => (
          <div key={label} className="px-2 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 p-1 gap-px bg-border rounded-b-2xl overflow-hidden">
        {days.map((day) => {
          const iso = toIsoDate(day);
          const dayMeetings = getDayMeetingsFromIndex(meetingsByDate, day);
          const isPast = isPastDate(day, reference);
          const isOutsideMonth = day.getMonth() !== selectedDate.getMonth();
          const blocked = isDateBlocked(iso, blocks);
          const hasTimeBlock = hasSpecificTimeBlockOnDate(iso, blocks);

          return (
            <button
              key={iso}
              type="button"
              onClick={() => {
                onSelectDate(day);
                if (!isPast) {
                  onCreateOnDate(iso);
                }
              }}
              className={`min-h-32 p-2 text-left transition ${
                isPast
                  ? "cursor-not-allowed bg-slate-950/60"
                  : blocked
                  ? "bg-rose-500/5 hover:bg-rose-500/10"
                  : isOutsideMonth
                  ? "bg-bg/60 hover:bg-slate-900/60"
                  : "bg-bg hover:bg-slate-900/80"
              }`}
            >
              <p
                className={`mb-2 text-sm font-semibold ${
                  isPast ? "text-slate-600" : isOutsideMonth ? "text-slate-600" : "text-slate-200"
                }`}
              >
                {day.getDate()}
              </p>
              {blocked ? (
                <p
                  className={`mb-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    isPast ? "bg-rose-500/10 text-rose-600" : "bg-rose-500/15 text-rose-400"
                  }`}
                >
                  Dia bloqueado
                </p>
              ) : hasTimeBlock ? (
                <p
                  className={`mb-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    isPast ? "bg-amber-500/10 text-amber-600" : "bg-amber-500/15 text-amber-400"
                  }`}
                >
                  Horários bloqueados
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
