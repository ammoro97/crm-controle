import { AgendaBlocks } from "@/components/agenda/agenda-types";
import { getBlockingInfo } from "@/components/agenda/agenda-utils";

export type ScheduleMeetingLike = {
  id?: string;
  date: string;
  callTime: string;
  owner?: string;
  notes?: string;
};

export type ScheduleReservationLike = {
  id?: string;
  sessionId?: string;
  date: string;
  time: string;
  owner?: string;
};

export const FULL_DAY_HALF_HOUR_SLOTS = Array.from({ length: 48 }).map((_, index) => {
  const totalMinutes = index * 30;
  const hour = Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, "0");
  const minute = (totalMinutes % 60).toString().padStart(2, "0");
  return `${hour}:${minute}`;
});

export const AGENDA_DEFAULT_TIME_ZONE = "America/Sao_Paulo";

export function normalizeOwnerKey(value?: string | null) {
  return String(value || "").trim().toLowerCase();
}

export function isValidIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  if (Number.isNaN(parsed.getTime())) return false;
  return (
    parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day
  );
}

export function isValidHalfHourSlot(value: string) {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  const [hoursRaw, minutesRaw] = value.split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return false;
  if (hours < 0 || hours > 23) return false;
  return minutes === 0 || minutes === 30;
}

type TimeZoneNowParts = {
  dateIso: string;
  secondsInDay: number;
};

function getTimeZoneNowParts(referenceDate: Date, timeZone: string): TimeZoneNowParts | null {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(referenceDate);
  const year = parts.find((item) => item.type === "year")?.value || "";
  const month = parts.find((item) => item.type === "month")?.value || "";
  const day = parts.find((item) => item.type === "day")?.value || "";
  const rawHour = Number(parts.find((item) => item.type === "hour")?.value || "0");
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = Number(parts.find((item) => item.type === "minute")?.value || "0");
  const second = Number(parts.find((item) => item.type === "second")?.value || "0");

  if (!year || !month || !day) return null;
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || !Number.isFinite(second)) return null;

  return {
    dateIso: `${year}-${month}-${day}`,
    secondsInDay: hour * 3600 + minute * 60 + second,
  };
}

export function isPastScheduleDateTime(
  dateIso: string,
  time: string,
  options?: {
    referenceDate?: Date;
    timeZone?: string;
  },
) {
  if (!isValidIsoDate(dateIso) || !isValidHalfHourSlot(time)) return false;

  const referenceDate = options?.referenceDate ?? new Date();
  const timeZone = options?.timeZone ?? AGENDA_DEFAULT_TIME_ZONE;
  const nowParts = getTimeZoneNowParts(referenceDate, timeZone);
  if (!nowParts) return false;

  if (dateIso < nowParts.dateIso) return true;
  if (dateIso > nowParts.dateIso) return false;

  return timeToMinutes(time) * 60 < nowParts.secondsInDay;
}

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function hasOwnerTimeConflict(
  meetings: ScheduleMeetingLike[],
  date: string,
  time: string,
  owner: string,
  options?: {
    excludeMeetingId?: string;
    ignoreSessionId?: string;
  },
) {
  const normalizedOwner = normalizeOwnerKey(owner);
  const excludeId = String(options?.excludeMeetingId || "").trim();
  const ignoreSessionId = String(options?.ignoreSessionId || "").trim();

  return meetings.some((meeting) => {
    const meetingId = String(meeting.id || "").trim();
    if (excludeId && meetingId === excludeId) return false;
    if (meeting.date !== date || meeting.callTime !== time) return false;
    if (ignoreSessionId && String(meeting.notes || "").includes(`[POSTCALL:${ignoreSessionId}]`)) return false;
    if (!normalizedOwner) return true;
    return normalizeOwnerKey(meeting.owner) === normalizedOwner;
  });
}

export function hasReservationConflict(
  reservations: ScheduleReservationLike[],
  date: string,
  time: string,
  owner: string,
  sessionId?: string,
) {
  const normalizedOwner = normalizeOwnerKey(owner);
  const normalizedSessionId = String(sessionId || "").trim();
  return reservations.some((reservation) => {
    if (reservation.date !== date || reservation.time !== time) return false;
    if (normalizedSessionId && String(reservation.sessionId || "").trim() === normalizedSessionId) return false;
    if (!normalizedOwner) return true;
    return normalizeOwnerKey(reservation.owner) === normalizedOwner;
  });
}

export function buildAvailableSlotsForDate(args: {
  date: string;
  owner: string;
  blocks?: AgendaBlocks;
  meetings?: ScheduleMeetingLike[];
  reservations?: ScheduleReservationLike[];
  ignoreSessionId?: string;
  referenceDate?: Date;
}) {
  const {
    date,
    owner,
    blocks,
    meetings = [],
    reservations = [],
    ignoreSessionId,
    referenceDate,
  } = args;

  return FULL_DAY_HALF_HOUR_SLOTS.filter((slot) => {
    if (isPastScheduleDateTime(date, slot, { referenceDate })) return false;
    if (blocks && getBlockingInfo(date, slot, blocks)) return false;
    if (hasOwnerTimeConflict(meetings, date, slot, owner, { ignoreSessionId })) return false;
    if (hasReservationConflict(reservations, date, slot, owner, ignoreSessionId)) return false;
    return true;
  });
}
