export type LeadExpedienteStatus = "Aberto" | "Fechado" | "Indefinido";

type TimeRange = {
  startMinutes: number;
  endMinutes: number;
};

type DaySchedule = {
  closed: boolean;
  ranges: TimeRange[];
};

const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";

const WEEKDAY_ALIASES: Array<{ index: number; aliases: string[] }> = [
  { index: 0, aliases: ["domingo", "dom", "sunday", "sun"] },
  { index: 1, aliases: ["segunda-feira", "segunda", "seg", "monday", "mon"] },
  { index: 2, aliases: ["terca-feira", "terca", "ter", "tuesday", "tue"] },
  { index: 3, aliases: ["quarta-feira", "quarta", "qua", "wednesday", "wed"] },
  { index: 4, aliases: ["quinta-feira", "quinta", "qui", "thursday", "thu"] },
  { index: 5, aliases: ["sexta-feira", "sexta", "sex", "friday", "fri"] },
  { index: 6, aliases: ["sabado", "sab", "saturday", "sat"] },
];

const WEEKDAY_SHORT_EN_TO_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

function normalizeText(value?: string | null): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n|;|\|/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function containsWord(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s|\\b)${escaped}(\\b|\\s|$)`, "i").test(text);
}

function resolveWeekdayIndexes(labelRaw: string): number[] {
  const label = normalizeText(labelRaw);
  if (!label) return [];

  const matched = WEEKDAY_ALIASES.filter(({ aliases }) => aliases.some((alias) => containsWord(label, alias))).map(
    ({ index }) => index,
  );
  const unique = Array.from(new Set(matched));
  if (unique.length <= 1) return unique;

  const isRange = /\s(a|ate|to|-|ate)\s/.test(label);
  if (!isRange) return unique;

  const first = unique[0];
  const second = unique[1];
  if (first <= second) {
    return Array.from({ length: second - first + 1 }, (_, idx) => first + idx);
  }

  const wrap: number[] = [];
  for (let day = first; day < 7; day += 1) wrap.push(day);
  for (let day = 0; day <= second; day += 1) wrap.push(day);
  return wrap;
}

function parseTimeToMinutes(raw: string): number | null {
  const value = normalizeText(raw).replace(/\./g, "");
  if (!value) return null;

  const amPmMatch = value.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (amPmMatch) {
    let hours = Number(amPmMatch[1]);
    const minutes = Number(amPmMatch[2] || "0");
    const period = amPmMatch[3].toLowerCase();
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) return null;
    if (period === "pm" && hours !== 12) hours += 12;
    if (period === "am" && hours === 12) hours = 0;
    return hours * 60 + minutes;
  }

  const hMatch = value.match(/^(\d{1,2})h(\d{2})?$/);
  if (hMatch) {
    const hours = Number(hMatch[1]);
    const minutes = Number(hMatch[2] || "0");
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return hours * 60 + minutes;
  }

  const hourMatch = value.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (hourMatch) {
    const hours = Number(hourMatch[1]);
    const minutes = Number(hourMatch[2] || "0");
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return hours * 60 + minutes;
  }

  return null;
}

function extractRangesFromText(scheduleRaw: string): TimeRange[] {
  const schedule = normalizeText(scheduleRaw);
  if (!schedule) return [];

  if (schedule.includes("24h") || schedule.includes("24 horas") || schedule.includes("24hours")) {
    return [{ startMinutes: 0, endMinutes: 1440 }];
  }

  const ranges: TimeRange[] = [];
  const rangePattern =
    /(\d{1,2}(?::\d{2})?\s*(?:am|pm)?|\d{1,2}h\d{0,2})\s*(?:to|as|a|ate|-|–|—)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?|\d{1,2}h\d{0,2})/gi;
  let match = rangePattern.exec(schedule);
  while (match) {
    const start = parseTimeToMinutes(match[1]);
    const end = parseTimeToMinutes(match[2]);
    if (start !== null && end !== null) {
      ranges.push({ startMinutes: start, endMinutes: end });
    }
    match = rangePattern.exec(schedule);
  }
  return ranges;
}

function isClosedText(scheduleRaw: string): boolean {
  const schedule = normalizeText(scheduleRaw);
  if (!schedule) return false;
  return (
    schedule.includes("fechado") ||
    schedule.includes("closed") ||
    schedule.includes("encerrado") ||
    schedule.includes("nao abre") ||
    schedule.includes("sem expediente")
  );
}

function parseDaySchedule(scheduleRaw: string): DaySchedule | null {
  const trimmed = String(scheduleRaw || "").trim();
  if (!trimmed) return null;

  const ranges = extractRangesFromText(trimmed);
  if (ranges.length > 0) {
    return { closed: false, ranges };
  }

  if (isClosedText(trimmed)) {
    return { closed: true, ranges: [] };
  }

  return null;
}

function splitDayAndSchedule(lineRaw: string): { dayLabel: string; schedule: string } | null {
  const line = String(lineRaw || "").trim();
  if (!line) return null;

  const candidate = line.match(/^([^:–—-]+)\s*[:–—-]\s*(.+)$/);
  if (!candidate) return null;
  const dayLabel = candidate[1].trim();
  const schedule = candidate[2].trim();
  if (!dayLabel || !schedule) return null;
  if (!/[A-Za-zÀ-ÿ]/.test(dayLabel)) return null;
  return { dayLabel, schedule };
}

function parseHorarioFuncionamento(horarioRaw?: string | null): Map<number, DaySchedule> | null {
  const horario = String(horarioRaw || "").trim();
  if (!horario) return null;

  const lines = splitLines(horario);
  if (lines.length === 0) return null;

  const byDay = new Map<number, DaySchedule>();
  let globalSchedule: DaySchedule | null = null;

  for (const line of lines) {
    const split = splitDayAndSchedule(line);
    if (split) {
      const dayIndexes = resolveWeekdayIndexes(split.dayLabel);
      const schedule = parseDaySchedule(split.schedule);
      if (dayIndexes.length > 0 && schedule) {
        dayIndexes.forEach((idx) => byDay.set(idx, schedule));
        continue;
      }
    }

    const fallbackSchedule = parseDaySchedule(line);
    if (fallbackSchedule) globalSchedule = fallbackSchedule;
  }

  if (byDay.size === 0 && globalSchedule) {
    for (let day = 0; day < 7; day += 1) {
      byDay.set(day, globalSchedule);
    }
  }

  return byDay.size > 0 ? byDay : null;
}

function isOpenNow(ranges: TimeRange[], minutesNow: number): boolean {
  return ranges.some((range) => {
    const { startMinutes, endMinutes } = range;
    if (endMinutes === 1440) return minutesNow >= startMinutes;
    if (endMinutes >= startMinutes) return minutesNow >= startMinutes && minutesNow < endMinutes;
    return minutesNow >= startMinutes || minutesNow < endMinutes;
  });
}

function getWeekdayAndMinutes(referenceDate: Date, timeZone: string): { weekday: number; minutes: number } | null {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(referenceDate);
  const weekdayRaw = String(parts.find((part) => part.type === "weekday")?.value || "")
    .trim()
    .toLowerCase();
  const hour = Number(parts.find((part) => part.type === "hour")?.value || "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value || "0");

  const weekday = WEEKDAY_SHORT_EN_TO_INDEX[weekdayRaw];
  if (!Number.isFinite(weekday) || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;

  return {
    weekday,
    minutes: hour * 60 + minute,
  };
}

export function resolveLeadExpedienteStatusFromHorario(
  horarioFuncionamento?: string | null,
  options?: {
    referenceDate?: Date;
    timeZone?: string;
  },
): LeadExpedienteStatus {
  const schedule = parseHorarioFuncionamento(horarioFuncionamento);
  if (!schedule) return "Indefinido";

  const nowInfo = getWeekdayAndMinutes(options?.referenceDate ?? new Date(), options?.timeZone ?? SAO_PAULO_TIME_ZONE);
  if (!nowInfo) return "Indefinido";

  const todaySchedule = schedule.get(nowInfo.weekday);
  if (!todaySchedule) return "Indefinido";
  if (todaySchedule.closed) return "Fechado";
  if (!todaySchedule.ranges.length) return "Indefinido";
  return isOpenNow(todaySchedule.ranges, nowInfo.minutes) ? "Aberto" : "Fechado";
}

