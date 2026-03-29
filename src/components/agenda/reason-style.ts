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
    cardClass: "border-emerald-200 bg-emerald-50 hover:bg-emerald-100",
    timeClass: "text-emerald-800",
    nameClass: "text-slate-700",
    badgeClass: "bg-emerald-100 text-emerald-700",
  },
  acompanhamento: {
    label: "ACOMPANHAMENTO",
    cardClass: "border-sky-200 bg-sky-50 hover:bg-sky-100",
    timeClass: "text-sky-800",
    nameClass: "text-slate-700",
    badgeClass: "bg-sky-100 text-sky-700",
  },
  fechamento: {
    label: "FECHAMENTO",
    cardClass: "border-violet-200 bg-violet-50 hover:bg-violet-100",
    timeClass: "text-violet-800",
    nameClass: "text-slate-700",
    badgeClass: "bg-violet-100 text-violet-700",
  },
  "follow-up": {
    label: "FOLLOW-UP",
    cardClass: "border-orange-200 bg-orange-50 hover:bg-orange-100",
    timeClass: "text-orange-800",
    nameClass: "text-slate-700",
    badgeClass: "bg-orange-100 text-orange-700",
  },
};

const FALLBACK_STYLE: ReasonStyle = {
  label: "ACOMPANHAMENTO",
  cardClass: "border-sky-200 bg-sky-50 hover:bg-sky-100",
  timeClass: "text-sky-800",
  nameClass: "text-slate-700",
  badgeClass: "bg-sky-100 text-sky-700",
};

export function getMeetingReasonStyle(reason: Meeting["reason"] | string): ReasonStyle {
  return REASON_STYLE_MAP[reason as Meeting["reason"]] || FALLBACK_STYLE;
}

