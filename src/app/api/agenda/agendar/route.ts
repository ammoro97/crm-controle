import { NextResponse } from "next/server";
import { AgendaBlocks, emptyAgendaBlocks } from "@/components/agenda/agenda-types";
import { getBlockingInfo } from "@/components/agenda/agenda-utils";
import {
  AgendaReservation,
  getAgendaReservations,
  withAgendaReservationsLock,
} from "@/lib/agenda-reservations-store";
import {
  ScheduleMeetingLike,
  hasOwnerTimeConflict,
  hasReservationConflict,
  isPastScheduleDateTime,
  isValidHalfHourSlot,
  isValidIsoDate,
  normalizeOwnerKey,
} from "@/lib/agenda-scheduling";
import { requireAuth } from "@/lib/require-auth";

type ScheduleAction = "validate" | "reserve";

type ScheduleRequestBody = {
  action?: ScheduleAction;
  date?: string;
  time?: string;
  owner?: string;
  sessionId?: string;
  blocks?: AgendaBlocks;
  localMeetings?: ScheduleMeetingLike[];
};

type ScheduleResponse = {
  success: boolean;
  available: boolean;
  reserved?: boolean;
  reservationId?: string | null;
  message?: string;
};

type ReserveResult =
  | { success: false; available: false; status: number; message: string }
  | { success: true; available: true; status: number; reservation: AgendaReservation };

function normalizeBlocks(value: unknown): AgendaBlocks {
  if (!value || typeof value !== "object") return emptyAgendaBlocks;
  const typed = value as Partial<AgendaBlocks>;
  return {
    recurringWeekdayBlocks: Array.isArray(typed.recurringWeekdayBlocks) ? typed.recurringWeekdayBlocks : [],
    specificDateBlocks: Array.isArray(typed.specificDateBlocks) ? typed.specificDateBlocks : [],
    periodBlocks: Array.isArray(typed.periodBlocks) ? typed.periodBlocks : [],
    specificTimeBlocks: Array.isArray(typed.specificTimeBlocks) ? typed.specificTimeBlocks : [],
  };
}

function normalizeLocalMeetings(value: unknown): ScheduleMeetingLike[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const typed = item as Partial<ScheduleMeetingLike>;
      return {
        id: String(typed.id || "").trim() || undefined,
        date: String(typed.date || "").trim(),
        callTime: String(typed.callTime || "").trim(),
        owner: String(typed.owner || "").trim() || undefined,
        notes: String(typed.notes || "").trim() || undefined,
      } satisfies ScheduleMeetingLike;
    })
    .filter((item) => isValidIsoDate(item.date) && isValidHalfHourSlot(item.callTime));
}

function validateConflict(args: {
  date: string;
  time: string;
  owner: string;
  sessionId: string;
  localMeetings: ScheduleMeetingLike[];
  reservations: AgendaReservation[];
  blocks: AgendaBlocks;
}) {
  const { date, time, owner, sessionId, localMeetings, reservations, blocks } = args;
  const normalizedOwner = normalizeOwnerKey(owner);

  const blockInfo = getBlockingInfo(date, time, blocks);
  if (blockInfo) {
    return {
      available: false,
      status: 409,
      message: `Horario indisponivel por bloqueio de agenda: ${blockInfo.reason}`,
    };
  }

  if (
    hasOwnerTimeConflict(localMeetings, date, time, normalizedOwner, {
      ignoreSessionId: sessionId,
    })
  ) {
    return {
      available: false,
      status: 409,
      message: "Horario indisponivel por conflito com outro evento.",
    };
  }

  if (hasReservationConflict(reservations, date, time, normalizedOwner, sessionId)) {
    return {
      available: false,
      status: 409,
      message: "Horario indisponivel por conflito de concorrencia.",
    };
  }

  return {
    available: true,
    status: 200,
    message: "Horario disponivel para agendamento.",
  };
}

function upsertReservation(args: {
  reservations: AgendaReservation[];
  date: string;
  time: string;
  owner: string;
  sessionId: string;
}) {
  const { reservations, date, time, owner, sessionId } = args;
  const now = new Date().toISOString();
  const existingIndex = reservations.findIndex(
    (reservation) => sessionId && reservation.sessionId === sessionId,
  );

  if (existingIndex >= 0) {
    const current = reservations[existingIndex];
    reservations[existingIndex] = {
      ...current,
      date,
      time,
      owner,
      updatedAt: now,
    };
    return reservations[existingIndex];
  }

  const created: AgendaReservation = {
    id: `RSV-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: sessionId || `S-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    date,
    time,
    owner,
    createdAt: now,
    updatedAt: now,
  };
  reservations.push(created);
  return created;
}

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  try {
    const body = (await request.json()) as ScheduleRequestBody;
    const action: ScheduleAction = body.action === "reserve" ? "reserve" : "validate";
    const date = String(body.date || "").trim();
    const time = String(body.time || "").trim();
    const owner = String(body.owner || "").trim();
    const sessionId = String(body.sessionId || "").trim();
    const blocks = normalizeBlocks(body.blocks);
    const localMeetings = normalizeLocalMeetings(body.localMeetings);

    if (!isValidIsoDate(date) || !isValidHalfHourSlot(time)) {
      return NextResponse.json<ScheduleResponse>(
        {
          success: false,
          available: false,
          message: "Data ou horario invalido. Utilize slots de 30 minutos no formato 24h.",
        },
        { status: 400 },
      );
    }

    if (isPastScheduleDateTime(date, time)) {
      return NextResponse.json<ScheduleResponse>(
        {
          success: false,
          available: false,
          message: "Nao e possivel agendar em data ou horario passado.",
        },
        { status: 409 },
      );
    }

    if (action === "validate") {
      const reservations = await getAgendaReservations();
      const conflict = validateConflict({
        date,
        time,
        owner,
        sessionId,
        localMeetings,
        reservations,
        blocks,
      });

      if (!conflict.available) {
        return NextResponse.json<ScheduleResponse>(
          {
            success: false,
            available: false,
            message: conflict.message,
          },
          { status: conflict.status },
        );
      }

      return NextResponse.json<ScheduleResponse>({
        success: true,
        available: true,
        reserved: false,
        message: "Horario validado com sucesso.",
      });
    }

    const result = await withAgendaReservationsLock<ReserveResult>(async (reservations) => {
      const conflict = validateConflict({
        date,
        time,
        owner,
        sessionId,
        localMeetings,
        reservations,
        blocks,
      });

      if (!conflict.available) {
        return {
          ok: false,
          result: {
            success: false,
            available: false,
            status: conflict.status,
            message: conflict.message,
          },
        };
      }

      const reservation = upsertReservation({
        reservations,
        date,
        time,
        owner,
        sessionId,
      });
      return {
        ok: true,
        reservations,
        result: {
          success: true,
          available: true,
          status: 200,
          reservation,
        },
      };
    });

    if (!result.success) {
      return NextResponse.json<ScheduleResponse>(
        {
          success: false,
          available: false,
          message: result.message,
        },
        { status: result.status },
      );
    }

    return NextResponse.json<ScheduleResponse>({
      success: true,
      available: true,
      reserved: true,
      reservationId: result.reservation.id,
      message: "Agendamento confirmado com sucesso.",
    });
  } catch {
    return NextResponse.json<ScheduleResponse>(
      {
        success: false,
        available: false,
        message: "Nao foi possivel validar o agendamento neste momento.",
      },
      { status: 500 },
    );
  }
}
