"use client";

import { Meeting } from "@/types/crm";
import { getAgendaCardFields } from "./agenda-card-fields";
import { getMeetingReasonStyle } from "./reason-style";

type AppointmentCardProps = {
  meeting: Meeting;
  onClick: (meeting: Meeting) => void;
  compact?: boolean;
  muted?: boolean;
};

export function AppointmentCard({ meeting, onClick, compact = false, muted = false }: AppointmentCardProps) {
  const reasonStyle = getMeetingReasonStyle(meeting.reason);
  const fields = getAgendaCardFields(meeting);
  const leftBorderClass = muted
    ? "border-l-[6px] border-l-slate-400"
    : meeting.reason === "follow-up"
      ? "border-l-[6px] border-l-[#F97316]"
      : meeting.reason === "apresentacao"
        ? "border-l-[6px] border-l-[#16A34A]"
        : meeting.reason === "acompanhamento"
          ? "border-l-[6px] border-l-[#2563EB]"
          : "border-l-[6px] border-l-[#9333EA]";

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick(meeting);
      }}
      className={`w-full rounded-md border text-left transition duration-150 ${
        compact ? "px-2 py-1.5" : "px-2.5 py-2"
      } ${
        muted ? "border-slate-300/70 bg-slate-200/70 opacity-75 hover:bg-slate-200" : reasonStyle.cardClass
      } ${leftBorderClass}`}
    >
      <p className={`${compact ? "text-xs" : "text-sm"} font-bold leading-none ${muted ? "text-slate-700" : reasonStyle.timeClass}`}>
        {fields.horario}
      </p>
      <p className={`${compact ? "mt-0.5 text-[11px]" : "mt-1 text-xs"} truncate font-semibold ${muted ? "text-slate-800" : reasonStyle.nameClass}`}>
        {fields.responsavel}
      </p>
      <p className={`${compact ? "mt-0.5 text-[10px]" : "mt-0.5 text-[11px]"} truncate font-normal ${muted ? "text-slate-700" : "text-slate-700"}`}>
        {fields.cliente}
      </p>
      <span
        className={`mt-1 inline-flex w-fit rounded px-1.5 py-0.5 ${compact ? "text-[9px]" : "text-[10px]"} font-semibold uppercase tracking-wide ${
          muted ? "bg-slate-300/80 text-slate-700" : reasonStyle.badgeClass
        }`}
      >
        {fields.tipoLabel}
      </span>
    </button>
  );
}
