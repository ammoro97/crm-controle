"use client";

import { Meeting } from "@/types/crm";

type ReasonStyle = {
  label: string;
  cardClass: string;
  timeClass: string;
  nameClass: string;
  badgeClass: string;
};

const REASON_STYLE_MAP: Record<Meeting["reason"], ReasonStyle> = {
  apresentacao: {
    label: "APRESENTACAO",
    cardClass: "border-[#16A34A] bg-[#DCFCE7] hover:bg-[#c8f5d7] shadow-sm hover:shadow-md",
    timeClass: "text-[#166534]",
    nameClass: "text-slate-900",
    badgeClass: "bg-[#16A34A] text-emerald-50",
  },
  acompanhamento: {
    label: "ACOMPANHAMENTO",
    cardClass: "border-[#2563EB] bg-[#DBEAFE] hover:bg-[#c9ddff] shadow-sm hover:shadow-md",
    timeClass: "text-[#1D4ED8]",
    nameClass: "text-slate-900",
    badgeClass: "bg-[#2563EB] text-sky-50",
  },
  fechamento: {
    label: "FECHAMENTO",
    cardClass: "border-[#9333EA] bg-[#F3E8FF] hover:bg-[#ead5ff] shadow-sm hover:shadow-md",
    timeClass: "text-[#6B21A8]",
    nameClass: "text-slate-900",
    badgeClass: "bg-[#9333EA] text-violet-50",
  },
  "follow-up": {
    label: "FOLLOW-UP",
    cardClass: "border-[#F97316] bg-[#FFEDD5] hover:bg-[#ffe0bc] shadow-sm hover:shadow-md",
    timeClass: "text-[#C2410C]",
    nameClass: "text-slate-900",
    badgeClass: "bg-[#F97316] text-orange-50",
  },
};

const FALLBACK_STYLE: ReasonStyle = {
  label: "ACOMPANHAMENTO",
  cardClass: "border-[#2563EB] bg-[#DBEAFE] hover:bg-[#c9ddff] shadow-sm hover:shadow-md",
  timeClass: "text-[#1D4ED8]",
  nameClass: "text-slate-900",
  badgeClass: "bg-[#2563EB] text-sky-50",
};

export function getMeetingReasonStyle(reason: Meeting["reason"] | string): ReasonStyle {
  return REASON_STYLE_MAP[reason as Meeting["reason"]] || FALLBACK_STYLE;
}
