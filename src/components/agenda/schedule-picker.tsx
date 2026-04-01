"use client";

import { useEffect, useMemo, useState } from "react";
import { AgendaBlocks } from "@/components/agenda/agenda-types";
import {
  addDays,
  endOfMonth,
  endOfWeek,
  fromIsoDate,
  getCurrentReferenceDate,
  startOfMonth,
  startOfWeek,
  toIsoDate,
} from "@/components/agenda/agenda-utils";
import {
  FULL_DAY_HALF_HOUR_SLOTS,
  ScheduleMeetingLike,
  ScheduleReservationLike,
  buildAvailableSlotsForDate,
  isValidIsoDate,
} from "@/lib/agenda-scheduling";
import { isMeetingActiveForScheduling } from "@/lib/agenda-events";
import { Meeting } from "@/types/crm";

type AvailabilityApiResponse = {
  success: boolean;
  message?: string;
  reservations?: Array<{
    id: string;
    sessionId: string;
    date: string;
    time: string;
    owner: string;
  }>;
};

type ScheduleValidationResponse = {
  success: boolean;
  available: boolean;
  message?: string;
};

type SchedulePickerProps = {
  valueDate: string;
  valueTime: string;
  ownerName: string;
  sessionId?: string;
  meetings: Meeting[];
  blocks: AgendaBlocks;
  disabled?: boolean;
  onConfirm: (next: { date: string; time: string }) => void;
};

function buildMonthGrid(anchor: Date) {
  const start = startOfWeek(startOfMonth(anchor));
  const end = endOfWeek(endOfMonth(anchor));
  const days: Date[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    days.push(date);
  }
  return days;
}

function normalizeMeetings(meetings: Meeting[]): ScheduleMeetingLike[] {
  return meetings
    .filter((meeting) => isMeetingActiveForScheduling(meeting))
    .map((meeting) => ({
      id: meeting.id,
      date: String(meeting.date || "").trim(),
      callTime: String(meeting.callTime || "").trim(),
      owner: String(meeting.owner || "").trim(),
      notes: String(meeting.notes || "").trim(),
    }));
}

function formatDateLabel(dateIso: string) {
  if (!isValidIsoDate(dateIso)) return "-";
  return fromIsoDate(dateIso).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function monthTitle(date: Date) {
  const label = date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function SchedulePicker({
  valueDate,
  valueTime,
  ownerName,
  sessionId,
  meetings,
  blocks,
  disabled = false,
  onConfirm,
}: SchedulePickerProps) {
  const reference = getCurrentReferenceDate();
  const initialDate = isValidIsoDate(valueDate) ? valueDate : "";
  const initialMonth = initialDate ? fromIsoDate(initialDate) : reference;

  const [visibleMonth, setVisibleMonth] = useState<Date>(() => startOfMonth(initialMonth));
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [selectedTime, setSelectedTime] = useState(valueTime || "");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [validating, setValidating] = useState(false);
  const [serverReservations, setServerReservations] = useState<ScheduleReservationLike[]>([]);

  useEffect(() => {
    if (!isValidIsoDate(valueDate)) return;
    setSelectedDate(valueDate);
    setSelectedTime(valueTime || "");
    setVisibleMonth(startOfMonth(fromIsoDate(valueDate)));
  }, [valueDate, valueTime]);

  const monthGridDays = useMemo(() => buildMonthGrid(visibleMonth), [visibleMonth]);
  const monthStartIso = useMemo(() => toIsoDate(monthGridDays[0]), [monthGridDays]);
  const monthEndIso = useMemo(() => toIsoDate(monthGridDays[monthGridDays.length - 1]), [monthGridDays]);
  const localMeetings = useMemo(() => normalizeMeetings(meetings), [meetings]);

  useEffect(() => {
    let cancelled = false;

    const loadAvailability = async () => {
      setLoadingAvailability(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          startDate: monthStartIso,
          endDate: monthEndIso,
          owner: ownerName || "",
          sessionId: sessionId || "",
        });
        const response = await fetch(`/api/agenda/disponibilidade?${params.toString()}`, {
          method: "GET",
          cache: "no-store",
        });
        const data = (await response.json()) as AvailabilityApiResponse;
        if (cancelled) return;
        if (!response.ok || !data.success) {
          setError(data.message || "Nao foi possivel carregar disponibilidade da agenda.");
          setServerReservations([]);
          return;
        }
        setServerReservations(
          Array.isArray(data.reservations)
            ? data.reservations.map((item) => ({
                id: item.id,
                sessionId: item.sessionId,
                date: item.date,
                time: item.time,
                owner: item.owner,
              }))
            : [],
        );
      } catch {
        if (!cancelled) {
          setError("Nao foi possivel carregar disponibilidade da agenda.");
          setServerReservations([]);
        }
      } finally {
        if (!cancelled) setLoadingAvailability(false);
      }
    };

    void loadAvailability();
    return () => {
      cancelled = true;
    };
  }, [monthStartIso, monthEndIso, ownerName, sessionId]);

  const availableSlotsByDate = useMemo(() => {
    const map = new Map<string, string[]>();
    monthGridDays.forEach((day) => {
      const iso = toIsoDate(day);
      const slots = buildAvailableSlotsForDate({
        date: iso,
        owner: ownerName,
        blocks,
        meetings: localMeetings,
        reservations: serverReservations,
        ignoreSessionId: sessionId,
        referenceDate: reference,
      });
      map.set(iso, slots.filter((slot) => FULL_DAY_HALF_HOUR_SLOTS.includes(slot)));
    });
    return map;
  }, [monthGridDays, ownerName, blocks, localMeetings, serverReservations, sessionId, reference]);

  const availableSlots = availableSlotsByDate.get(selectedDate) || [];

  useEffect(() => {
    if (!selectedDate) return;
    if (!availableSlots.length) {
      setSelectedTime("");
      return;
    }
    if (selectedTime && availableSlots.includes(selectedTime)) return;
    setSelectedTime("");
  }, [selectedDate, selectedTime, availableSlots]);

  const handleValidateAndConfirm = async () => {
    if (!selectedDate || !selectedTime) return;
    if (!availableSlots.includes(selectedTime)) {
      setError("Horario indisponivel. Selecione outro horario.");
      setFeedback(null);
      return;
    }

    setValidating(true);
    setError(null);
    setFeedback(null);
    try {
      const response = await fetch("/api/agenda/agendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "validate",
          date: selectedDate,
          time: selectedTime,
          owner: ownerName,
          sessionId: sessionId || "",
          blocks,
          localMeetings,
        }),
      });
      const data = (await response.json()) as ScheduleValidationResponse;
      if (!response.ok || !data.success || !data.available) {
        setError(data.message || "Horario indisponivel. Atualize e selecione outro horario.");
        return;
      }
      onConfirm({ date: selectedDate, time: selectedTime });
      setFeedback(`Agendado para ${formatDateLabel(selectedDate)} as ${selectedTime}.`);
    } catch {
      setError("Nao foi possivel validar disponibilidade agora.");
    } finally {
      setValidating(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-800/90 bg-slate-950/60 p-3">
      <div className="grid gap-3 lg:grid-cols-[320px_minmax(0,1fr)]">
        <section className="rounded-lg border border-slate-700/80 bg-slate-900/70 p-3">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              className="btn-ghost h-8 px-2 text-xs"
              onClick={() => setVisibleMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
              disabled={disabled}
            >
              {"<"}
            </button>
            <p className="text-sm font-semibold text-slate-100">{monthTitle(visibleMonth)}</p>
            <button
              type="button"
              className="btn-ghost h-8 px-2 text-xs"
              onClick={() => setVisibleMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
              disabled={disabled}
            >
              {">"}
            </button>
          </div>
          <div className="mt-2 grid grid-cols-7 gap-1 text-center text-[10px] uppercase tracking-[0.08em] text-slate-500">
            <span>Dom</span>
            <span>Seg</span>
            <span>Ter</span>
            <span>Qua</span>
            <span>Qui</span>
            <span>Sex</span>
            <span>Sab</span>
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {monthGridDays.map((day) => {
              const iso = toIsoDate(day);
              const inCurrentMonth = day.getMonth() === visibleMonth.getMonth();
              const daySlots = availableSlotsByDate.get(iso) || [];
              const isSelectable = inCurrentMonth && daySlots.length > 0;
              const isSelected = selectedDate === iso;
              return (
                <button
                  key={iso}
                  type="button"
                  className={`h-9 rounded-md text-xs transition ${
                    !inCurrentMonth
                      ? "cursor-default text-slate-700"
                      : isSelected
                        ? "border border-sky-500/70 bg-sky-500/20 text-sky-100"
                        : isSelectable
                          ? "border border-sky-900/70 bg-slate-900/80 text-sky-100 hover:border-sky-500/40 hover:bg-slate-800"
                          : "cursor-not-allowed border border-slate-800 bg-slate-950/70 text-slate-600"
                  }`}
                  onClick={() => {
                    if (!isSelectable || disabled) return;
                    setSelectedDate(iso);
                    setFeedback(null);
                    setError(null);
                  }}
                  disabled={!isSelectable || disabled}
                  title={
                    !inCurrentMonth
                      ? ""
                      : isSelectable
                        ? `Dia com ${daySlots.length} horario(s) disponivel(is)`
                        : "Sem disponibilidade"
                  }
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-lg border border-slate-700/80 bg-slate-900/70 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-200">Horarios disponiveis</p>
              <p className="mt-1 text-[11px] text-slate-400">
                Slots de 30 min em formato 24h. Selecione um horario para continuar.
              </p>
            </div>
            {selectedDate ? <span className="text-xs text-slate-300">{formatDateLabel(selectedDate)}</span> : null}
          </div>

          <div className="mt-3 max-h-72 overflow-y-auto rounded-md border border-slate-800 bg-slate-950/70 p-2">
            {!selectedDate ? (
              <p className="px-2 py-4 text-sm text-slate-500">Selecione um dia disponivel no calendario.</p>
            ) : loadingAvailability ? (
              <p className="px-2 py-4 text-sm text-slate-500">Carregando horarios...</p>
            ) : availableSlots.length === 0 ? (
              <p className="px-2 py-4 text-sm text-slate-500">Nao ha horarios disponiveis para este dia.</p>
            ) : (
              <div className="space-y-1">
                {availableSlots.map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    className={`w-full rounded-md border px-3 py-2 text-left text-sm transition ${
                      selectedTime === slot
                        ? "border-sky-500/70 bg-sky-500/20 text-sky-100"
                        : "border-slate-700 bg-slate-900/80 text-slate-200 hover:border-sky-500/40 hover:bg-slate-800"
                    }`}
                    onClick={() => {
                      if (disabled) return;
                      setSelectedTime(slot);
                      setFeedback(null);
                      setError(null);
                    }}
                    disabled={disabled}
                  >
                    {slot}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-400">
              {selectedDate && selectedTime
                ? `Selecionado: ${formatDateLabel(selectedDate)} as ${selectedTime}`
                : "Selecione dia e horario para habilitar o agendamento."}
            </p>
            <button
              type="button"
              className="btn-primary h-10 px-4"
              onClick={handleValidateAndConfirm}
              disabled={disabled || validating || !selectedDate || !selectedTime}
            >
              {validating ? "Validando..." : "Agendar"}
            </button>
          </div>

          {error ? <p className="mt-2 text-xs text-rose-300">{error}</p> : null}
          {feedback ? <p className="mt-2 text-xs text-emerald-300">{feedback}</p> : null}
        </section>
      </div>
    </div>
  );
}
