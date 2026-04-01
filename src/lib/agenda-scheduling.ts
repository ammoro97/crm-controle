import { AgendaBlocks } from "@/components/agenda/agenda-types";
import { getBlockingInfo, isPastDateTime } from "@/components/agenda/agenda-utils";

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
    if (isPastDateTime(date, slot, referenceDate)) return false;
    if (blocks && getBlockingInfo(date, slot, blocks)) return false;
    if (hasOwnerTimeConflict(meetings, date, slot, owner, { ignoreSessionId })) return false;
    if (hasReservationConflict(reservations, date, slot, owner, ignoreSessionId)) return false;
    return true;
  });
}
