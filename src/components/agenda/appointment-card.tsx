"use client";

import { Meeting } from "@/types/crm";
import { getMeetingReasonStyle } from "./reason-style";

type AppointmentCardProps = {
  meeting: Meeting;
  onClick: (meeting: Meeting) => void;
  compact?: boolean;
  muted?: boolean;
};

export function AppointmentCard({ meeting, onClick, compact = false, muted = false }: AppointmentCardProps) {
  const reasonStyle = getMeetingReasonStyle(meeting.reason);

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick(meeting);
      }}
      className={`w-full rounded-md border text-left transition ${
        compact ? "px-2 py-1" : "px-3 py-2"
      } ${
        muted ? "border-slate-300/70 bg-slate-200/70 opacity-75 hover:bg-slate-200" : reasonStyle.cardClass
      }`}
    >
      <p className={`${compact ? "text-[11px]" : "text-xs"} font-semibold ${muted ? "text-slate-600" : reasonStyle.timeClass}`}>
        {meeting.callTime}
      </p>
      <p className={`${compact ? "text-[11px]" : "text-sm"} truncate font-medium ${muted ? "text-slate-600" : reasonStyle.nameClass}`}>
        {meeting.personName}
      </p>
      <p
        className={`${compact ? "text-[10px]" : "text-xs"} truncate uppercase tracking-wide ${
          muted ? "text-slate-500" : "text-slate-500"
        }`}
      >
        {reasonStyle.label}
      </p>
    </button>
  );
}
