import { Meeting } from "@/types/crm";
import { AgendaBlocks, AgendaPeriodMode } from "./agenda-types";

export type MeetingsByDateIndex = Map<string, Meeting[]>;

export function getCurrentReferenceDate(): Date {
  return new Date();
}

export function startOfDay(date: Date): Date {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

export function addDays(date: Date, amount: number): Date {
  const value = new Date(date);
  value.setDate(value.getDate() + amount);
  return value;
}

export function addMonths(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

export function toIsoDate(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function fromIsoDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function startOfWeek(date: Date): Date {
  const value = startOfDay(date);
  value.setDate(value.getDate() - value.getDay());
  return value;
}

export function endOfWeek(date: Date): Date {
  return addDays(startOfWeek(date), 6);
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

export function formatDayLabel(date: Date): string {
  return date.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function formatWeekLabel(date: Date): string {
  const start = startOfWeek(date);
  const end = endOfWeek(date);
  const months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const startText = `${start.getDate().toString().padStart(2, "0")} ${months[start.getMonth()]}`;
  const endText = `${end.getDate().toString().padStart(2, "0")} ${months[end.getMonth()]}`;
  return `${startText} - ${endText} ${end.getFullYear()}`;
}

export function formatFortnightLabel(date: Date): string {
  const start = startOfDay(date);
  const end = addDays(start, 14);
  const monthText = end.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return `${start.getDate()} - ${end.getDate()} de ${monthText}`;
}

export function formatMonthLabel(date: Date): string {
  const label = date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function formatPeriodLabel(date: Date, mode: AgendaPeriodMode): string {
  if (mode === "dia") return formatDayLabel(date);
  if (mode === "semana") return formatWeekLabel(date);
  if (mode === "quinzena") return formatFortnightLabel(date);
  return formatMonthLabel(date);
}

export function moveDateByPeriod(date: Date, mode: AgendaPeriodMode, direction: -1 | 1): Date {
  if (mode === "dia") return addDays(date, direction);
  if (mode === "semana") return addDays(date, direction * 7);
  if (mode === "quinzena") return addDays(date, direction * 15);
  return addMonths(date, direction);
}

export function isPastDate(date: Date, reference = getCurrentReferenceDate()): boolean {
  return startOfDay(date).getTime() < startOfDay(reference).getTime();
}

export function getDayMeetings(meetings: Meeting[], date: Date): Meeting[] {
  const iso = toIsoDate(date);
  return meetings
    .filter((meeting) => meeting.date === iso)
    .sort((a, b) => a.callTime.localeCompare(b.callTime));
}

export function buildMeetingsByDateIndex(meetings: Meeting[]): MeetingsByDateIndex {
  const index: MeetingsByDateIndex = new Map();
  for (const meeting of meetings) {
    const bucket = index.get(meeting.date);
    if (bucket) {
      bucket.push(meeting);
    } else {
      index.set(meeting.date, [meeting]);
    }
  }

  for (const bucket of index.values()) {
    bucket.sort((a, b) => a.callTime.localeCompare(b.callTime));
  }

  return index;
}

export function getDayMeetingsFromIndex(index: MeetingsByDateIndex, date: Date): Meeting[] {
  return index.get(toIsoDate(date)) ?? [];
}

export function getWeekDays(anchorDate: Date, minDate?: Date): Date[] {
  const baseStart = startOfWeek(anchorDate);
  const start = minDate && baseStart < startOfDay(minDate) ? startOfDay(minDate) : baseStart;
  return Array.from({ length: 7 }).map((_, index) => addDays(start, index));
}

export function getFortnightDays(anchorDate: Date, minDate?: Date): Date[] {
  const anchor = startOfDay(anchorDate);
  const start = minDate && anchor < startOfDay(minDate) ? startOfDay(minDate) : anchor;
  return Array.from({ length: 15 }).map((_, index) => addDays(start, index));
}

export function getMonthGridDays(anchorDate: Date): Date[] {
  const start = startOfWeek(startOfMonth(anchorDate));
  const end = endOfWeek(endOfMonth(anchorDate));
  const days: Date[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    days.push(date);
  }
  return days;
}

export function getPeriodBounds(anchorDate: Date, mode: AgendaPeriodMode): { start: Date; end: Date } {
  const anchor = startOfDay(anchorDate);
  if (mode === "dia") return { start: anchor, end: anchor };
  if (mode === "semana") return { start: startOfWeek(anchor), end: endOfWeek(anchor) };
  if (mode === "quinzena") return { start: anchor, end: addDays(anchor, 14) };
  return { start: startOfMonth(anchor), end: endOfMonth(anchor) };
}

export function meetingsInRange(meetings: Meeting[], start: Date, end: Date): Meeting[] {
  const startValue = startOfDay(start).getTime();
  const endValue = startOfDay(end).getTime();
  return meetings
    .filter((meeting) => {
      const current = startOfDay(fromIsoDate(meeting.date)).getTime();
      return current >= startValue && current <= endValue;
    })
    .sort((a, b) => `${a.date} ${a.callTime}`.localeCompare(`${b.date} ${b.callTime}`));
}

export function isPastDateTime(dateIso: string, time: string, reference = getCurrentReferenceDate()): boolean {
  const meetingDate = fromIsoDate(dateIso);
  const refDay = startOfDay(reference).getTime();
  const currentDay = startOfDay(meetingDate).getTime();

  if (currentDay < refDay) return true;
  if (currentDay > refDay) return false;

  return timeToMinutes(time) < reference.getHours() * 60 + reference.getMinutes();
}

export function filterFutureMeetings(meetings: Meeting[], reference = getCurrentReferenceDate()): Meeting[] {
  return meetings.filter((meeting) => !isPastDateTime(meeting.date, meeting.callTime, reference));
}

export function clampDateToPresent(date: Date, reference = getCurrentReferenceDate()): Date {
  const today = startOfDay(reference);
  return startOfDay(date) < today ? today : date;
}

export function getNextValidHalfHourSlot(reference = getCurrentReferenceDate()): string {
  const minutesNow = reference.getHours() * 60 + reference.getMinutes();
  const rounded = Math.ceil(minutesNow / 30) * 30;
  const hour = Math.floor(rounded / 60)
    .toString()
    .padStart(2, "0");
  const minute = (rounded % 60).toString().padStart(2, "0");
  return `${hour}:${minute}`;
}

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function dateInRange(dateIso: string, startIso: string, endIso: string): boolean {
  return dateIso >= startIso && dateIso <= endIso;
}

export type BlockingType = "specific_time" | "specific_date" | "period" | "weekday";

export type BlockingInfo = {
  type: BlockingType;
  reason: string;
  date?: string;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
};

export function getDateBlockReasons(dateIso: string, blocks: AgendaBlocks): string[] {
  const date = fromIsoDate(dateIso);
  const weekday = date.getDay();
  const reasons: string[] = [];

  blocks.recurringWeekdayBlocks.forEach((block) => {
    if (block.weekdays.includes(weekday)) reasons.push(block.reason);
  });

  blocks.specificDateBlocks.forEach((block) => {
    if (block.date === dateIso) reasons.push(block.reason);
  });

  blocks.periodBlocks.forEach((block) => {
    if (dateInRange(dateIso, block.startDate, block.endDate)) reasons.push(block.reason);
  });

  return reasons;
}

export function getTimeBlockReasons(dateIso: string, time: string, blocks: AgendaBlocks): string[] {
  const dateReasons = getDateBlockReasons(dateIso, blocks);
  const currentMinutes = timeToMinutes(time);
  const reasons = [...dateReasons];

  blocks.specificTimeBlocks.forEach((block) => {
    if (block.date !== dateIso) return;
    const start = timeToMinutes(block.startTime);
    const end = timeToMinutes(block.endTime);
    if (currentMinutes >= start && currentMinutes < end) reasons.push(block.reason);
  });

  return reasons;
}

export function getBlockingInfo(dateIso: string, time: string, blocks: AgendaBlocks): BlockingInfo | null {
  const currentMinutes = timeToMinutes(time);
  const weekday = fromIsoDate(dateIso).getDay();

  for (const block of blocks.specificTimeBlocks) {
    if (block.date !== dateIso) continue;
    const start = timeToMinutes(block.startTime);
    const end = timeToMinutes(block.endTime);
    if (currentMinutes >= start && currentMinutes < end) {
      return {
        type: "specific_time",
        reason: block.reason,
        date: block.date,
        startTime: block.startTime,
        endTime: block.endTime,
      };
    }
  }

  for (const block of blocks.specificDateBlocks) {
    if (block.date === dateIso) {
      return { type: "specific_date", reason: block.reason, date: block.date };
    }
  }

  for (const block of blocks.periodBlocks) {
    if (dateInRange(dateIso, block.startDate, block.endDate)) {
      return { type: "period", reason: block.reason, startDate: block.startDate, endDate: block.endDate };
    }
  }

  for (const block of blocks.recurringWeekdayBlocks) {
    if (block.weekdays.includes(weekday)) {
      return { type: "weekday", reason: block.reason };
    }
  }

  return null;
}

export function isDateBlocked(dateIso: string, blocks: AgendaBlocks): boolean {
  return getDateBlockReasons(dateIso, blocks).length > 0;
}

export function isDateTimeBlocked(dateIso: string, time: string, blocks: AgendaBlocks): boolean {
  return getTimeBlockReasons(dateIso, time, blocks).length > 0;
}

export function hasSpecificTimeBlockOnDate(dateIso: string, blocks: AgendaBlocks): boolean {
  return blocks.specificTimeBlocks.some((block) => block.date === dateIso);
}
