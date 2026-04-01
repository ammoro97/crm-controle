import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { getAgendaReservations } from "@/lib/agenda-reservations-store";
import {
  FULL_DAY_HALF_HOUR_SLOTS,
  buildAvailableSlotsForDate,
  isValidIsoDate,
  normalizeOwnerKey,
} from "@/lib/agenda-scheduling";

type AvailabilityResponse = {
  success: boolean;
  message?: string;
  reservations?: Array<{
    id: string;
    sessionId: string;
    date: string;
    time: string;
    owner: string;
  }>;
  availableSlots?: string[];
};

export async function GET(request: Request) {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const startDate = String(searchParams.get("startDate") || "").trim();
    const endDate = String(searchParams.get("endDate") || "").trim();
    const date = String(searchParams.get("date") || "").trim();
    const owner = String(searchParams.get("owner") || "").trim();
    const sessionId = String(searchParams.get("sessionId") || "").trim();
    const normalizedOwner = normalizeOwnerKey(owner);

    if (date && !isValidIsoDate(date)) {
      return NextResponse.json<AvailabilityResponse>(
        { success: false, message: "Data invalida para consultar disponibilidade." },
        { status: 400 },
      );
    }

    if ((startDate && !isValidIsoDate(startDate)) || (endDate && !isValidIsoDate(endDate))) {
      return NextResponse.json<AvailabilityResponse>(
        { success: false, message: "Intervalo de datas invalido para consulta." },
        { status: 400 },
      );
    }

    const reservations = await getAgendaReservations();
    const filteredReservations = reservations.filter((reservation) => {
      if (sessionId && reservation.sessionId === sessionId) return false;
      if (normalizedOwner && normalizeOwnerKey(reservation.owner) !== normalizedOwner) return false;
      if (date) return reservation.date === date;
      if (startDate && reservation.date < startDate) return false;
      if (endDate && reservation.date > endDate) return false;
      return true;
    });

    if (date) {
      const availableSlots = buildAvailableSlotsForDate({
        date,
        owner,
        reservations: filteredReservations,
      });

      return NextResponse.json<AvailabilityResponse>({
        success: true,
        reservations: filteredReservations.map((item) => ({
          id: item.id,
          sessionId: item.sessionId,
          date: item.date,
          time: item.time,
          owner: item.owner,
        })),
        availableSlots: availableSlots.filter((slot) => FULL_DAY_HALF_HOUR_SLOTS.includes(slot)),
      });
    }

    return NextResponse.json<AvailabilityResponse>({
      success: true,
      reservations: filteredReservations.map((item) => ({
        id: item.id,
        sessionId: item.sessionId,
        date: item.date,
        time: item.time,
        owner: item.owner,
      })),
    });
  } catch {
    return NextResponse.json<AvailabilityResponse>(
      { success: false, message: "Nao foi possivel consultar disponibilidade da agenda." },
      { status: 500 },
    );
  }
}
