"use client";

import { Meeting } from "@/types/crm";
import { getMeetingReasonStyle } from "./reason-style";

export type AgendaCardFields = {
  horario: string;
  responsavel: string;
  cliente: string;
  tipoLabel: string;
};

export function getAgendaCardFields(meeting: Meeting): AgendaCardFields {
  const reasonStyle = getMeetingReasonStyle(meeting.reason);
  return {
    horario: String(meeting.callTime || "").trim() || "--:--",
    responsavel: String(meeting.owner || "").trim() || "Responsavel nao definido",
    cliente: String(meeting.personName || "").trim() || "Cliente nao informado",
    tipoLabel: reasonStyle.label,
  };
}

