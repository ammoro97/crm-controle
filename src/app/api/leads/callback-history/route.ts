import { NextResponse } from "next/server";
import { upsertCallbackHistory } from "@/lib/callback-history-store";
import { requireAuth } from "@/lib/require-auth";
import type { Lead } from "@/types/crm";

type CallbackHistoryRequestBody = {
  wrapupId?: unknown;
  lead?: unknown;
  callbackAt?: unknown;
  callbackBy?: unknown;
  sessionId?: unknown;
  callId?: unknown;
  externalCallId?: unknown;
  finalizacao?: unknown;
  subfinalizacao?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function trimText(value: unknown): string {
  return String(value || "").trim();
}

function isValidIsoDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function isLeadLike(value: unknown): value is Lead {
  const record = asRecord(value);
  if (!record) return false;
  return typeof record.id === "string" && trimText(record.id).length > 0;
}

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  try {
    const body = (await request.json()) as CallbackHistoryRequestBody;
    const raw = asRecord(body);
    if (!raw) {
      return NextResponse.json(
        { success: false, message: "Payload invalido." },
        { status: 400 },
      );
    }

    const wrapupId = trimText(raw.wrapupId);
    const leadId = trimText(asRecord(raw.lead)?.id);
    const callbackAt = trimText(raw.callbackAt);
    const callbackBy = trimText(raw.callbackBy);
    const sessionId = trimText(raw.sessionId);
    const finalizacao = trimText(raw.finalizacao);
    const subfinalizacao = trimText(raw.subfinalizacao) || null;
    const callId = trimText(raw.callId) || null;
    const externalCallId = trimText(raw.externalCallId) || null;

    if (!wrapupId || !leadId || !callbackAt || !callbackBy || !sessionId) {
      return NextResponse.json(
        { success: false, message: "Campos obrigatorios ausentes para historico de callback." },
        { status: 400 },
      );
    }

    if (!isValidIsoDate(callbackAt)) {
      return NextResponse.json(
        { success: false, message: "Data de callback invalida." },
        { status: 400 },
      );
    }

    if (finalizacao !== "Enviar para callback") {
      return NextResponse.json(
        { success: false, message: "Finalizacao invalida para historico de callback." },
        { status: 400 },
      );
    }

    if (!isLeadLike(raw.lead)) {
      return NextResponse.json(
        { success: false, message: "Lead invalido para historico de callback." },
        { status: 400 },
      );
    }

    const lead = raw.lead;
    if (trimText(lead.id) !== leadId) {
      return NextResponse.json(
        { success: false, message: "Lead inconsistente no payload de callback." },
        { status: 400 },
      );
    }

    await upsertCallbackHistory({
      wrapupId,
      leadId,
      sessionId,
      callId,
      externalCallId,
      callbackAt,
      callbackBy,
      finalizacao,
      subfinalizacao,
      leadPayload: lead,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "SUPABASE_UNAVAILABLE") {
      return NextResponse.json(
        { success: false, message: "Supabase indisponivel para registrar callback." },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { success: false, message: "Nao foi possivel registrar historico de callback." },
      { status: 500 },
    );
  }
}
