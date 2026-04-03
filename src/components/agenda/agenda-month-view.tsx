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
    <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="grid grid-cols-7 border-b border-slate-200">
        {weekLabels.map((label) => (
          <div key={label} className="px-2 py-2 text-xs font-semibold text-slate-500">
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
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
              className={`min-h-32 border p-2 text-left transition ${
                isPast
                  ? "cursor-not-allowed border-slate-300 bg-slate-200/80 hover:bg-slate-200/80"
                  : blocked
                  ? "border-slate-200 bg-rose-50/70 hover:bg-rose-50/80"
                  : isOutsideMonth
                    ? "border-slate-200 bg-slate-50 hover:bg-slate-100/70"
                    : "border-slate-200 bg-white hover:bg-slate-50"
              }`}
            >
              <p
                className={`mb-2 text-sm font-semibold ${
                  isPast ? "text-slate-500" : isOutsideMonth ? "text-slate-400" : "text-slate-700"
                }`}
              >
                {day.getDate()}
              </p>
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
