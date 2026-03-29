"use client";

import { useMemo } from "react";
import { Meeting } from "@/types/crm";
import { AgendaPeriodMode } from "./agenda-types";
import { getPeriodBounds, meetingsInRange, toIsoDate } from "./agenda-utils";
import { getMeetingReasonStyle } from "./reason-style";

type AgendaListProps = {
  meetings: Meeting[];
  selectedDate: Date;
  periodMode: AgendaPeriodMode;
  onSelectMeeting: (meeting: Meeting) => void;
};

export function AgendaList({ meetings, selectedDate, periodMode, onSelectMeeting }: AgendaListProps) {
  const { start, end } = getPeriodBounds(selectedDate, periodMode);
  const rows = useMemo(() => meetingsInRange(meetings, start, end), [meetings, start, end]);
  const selectedDateIso = toIsoDate(selectedDate);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500">Nenhum agendamento encontrado para este periodo.</p>
      ) : (
        rows.map((meeting, index) => {
          const reasonStyle = getMeetingReasonStyle(meeting.reason);
          return (
          <button
            key={meeting.id}
            type="button"
            onClick={() => onSelectMeeting(meeting)}
            className={`grid w-full gap-2 px-4 py-4 text-left transition md:grid-cols-5 ${
              meeting.date === selectedDateIso ? "bg-sky-50" : "bg-white"
            } ${index > 0 ? "border-t border-slate-200" : ""} hover:bg-slate-50`}
          >
            <div>
              <p className="text-sm font-semibold text-slate-800">{meeting.personName}</p>
              <p className={`inline-flex rounded-md px-2 py-0.5 text-xs uppercase tracking-wide ${reasonStyle.badgeClass}`}>
                {reasonStyle.label}
              </p>
            </div>
            <p className="text-sm text-slate-700">
              {new Date(`${meeting.date}T00:00:00`).toLocaleDateString("pt-BR")}
            </p>
            <p className="text-sm text-slate-700">{meeting.callTime}</p>
            <p className="text-sm text-slate-700">{meeting.owner}</p>
            <p className="truncate text-sm text-slate-500">{meeting.notes || "-"}</p>
          </button>
          );
        })
      )}
    </div>
  );
}
