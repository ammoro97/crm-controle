import { Meeting } from "@/types/crm";

export type AgendaDisplayMode = "calendario" | "lista" | "todos";
export type AgendaPeriodMode = "dia" | "semana" | "quinzena" | "mes";
export type AgendaBlockType = "weekday" | "specific_date" | "period" | "specific_time";

export type CalendarDay = {
  date: Date;
  iso: string;
  inCurrentMonth: boolean;
  meetings: Meeting[];
};

export type RecurringWeekdayBlock = {
  id: string;
  type: "weekday";
  weekdays: number[];
  reason: string;
};

export type SpecificDateBlock = {
  id: string;
  type: "specific_date";
  date: string;
  reason: string;
};

export type PeriodBlock = {
  id: string;
  type: "period";
  startDate: string;
  endDate: string;
  reason: string;
};

export type SpecificTimeBlock = {
  id: string;
  type: "specific_time";
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
};

export type AgendaBlocks = {
  recurringWeekdayBlocks: RecurringWeekdayBlock[];
  specificDateBlocks: SpecificDateBlock[];
  periodBlocks: PeriodBlock[];
  specificTimeBlocks: SpecificTimeBlock[];
};

export const emptyAgendaBlocks: AgendaBlocks = {
  recurringWeekdayBlocks: [],
  specificDateBlocks: [],
  periodBlocks: [],
  specificTimeBlocks: [],
};
