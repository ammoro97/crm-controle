"use client";

import { Meeting } from "@/types/crm";

type AppointmentCardProps = {
  meeting: Meeting;
  onClick: (meeting: Meeting) => void;
  compact?: boolean;
  muted?: boolean;
};

function reasonLabel(reason: Meeting["reason"]) {
  return reason.toUpperCase();
}

export function AppointmentCard({ meeting, onClick, compact = false, muted = false }: AppointmentCardProps) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick(meeting);
      }}
      className={`w-full rounded-md border border-sky-200 bg-sky-50 text-left transition hover:bg-sky-100 ${
        compact ? "px-2 py-1" : "px-3 py-2"
      } ${muted ? "border-slate-300/70 bg-slate-200/70 opacity-75 hover:bg-slate-200" : ""}`}
    >
      <p className={`${compact ? "text-[11px]" : "text-xs"} font-semibold ${muted ? "text-slate-600" : "text-sky-800"}`}>
        {meeting.callTime}
      </p>
      <p className={`${compact ? "text-[11px]" : "text-sm"} truncate font-medium ${muted ? "text-slate-600" : "text-slate-700"}`}>
        {meeting.personName}
      </p>
      <p
        className={`${compact ? "text-[10px]" : "text-xs"} truncate uppercase tracking-wide ${
          muted ? "text-slate-500" : "text-slate-500"
        }`}
      >
        {reasonLabel(meeting.reason)}
      </p>
    </button>
  );
}
