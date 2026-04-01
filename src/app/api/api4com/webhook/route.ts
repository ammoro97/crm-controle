import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import {
  findLeadByPhone,
  mapWebhookStatus,
  setLeadLastContactOverride,
  upsertCallLog,
} from "@/lib/calls-store";

type Api4ComWebhookPayload = {
  id?: string;
  callId?: string;
  uniqueid?: string;
  eventType?: string;
  event_type?: string;
  direction?: string;
  caller?: string;
  called?: string;
  from?: string;
  to?: string;
  startedAt?: string;
  started_at?: string;
  answeredAt?: string;
  answered_at?: string;
  endedAt?: string;
  ended_at?: string;
  duration?: number | string;
  billsec?: number | string;
  hangupCause?: string;
  hangup_cause?: string;
  hangupCauseCode?: string | number;
  hangup_cause_code?: string | number;
  recordUrl?: string;
  recording_url?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

function normalizeDigits(value?: string | null) {
  if (!value) return "";
  return value.replace(/\D/g, "");
}

function toIsoMaybe(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// API4com can send duration as "HH:MM:SS" string instead of numeric seconds
function parseDurationSeconds(value: unknown): number {
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber >= 0) return asNumber;
  if (typeof value === "string") {
    const parts = value.trim().split(":");
    if (parts.length === 3) {
      const h = Number(parts[0]);
      const m = Number(parts[1]);
      const s = Number(parts[2]);
      if (Number.isFinite(h) && Number.isFinite(m) && Number.isFinite(s)) {
        return h * 3600 + m * 60 + s;
      }
    }
    if (parts.length === 2) {
      const m = Number(parts[0]);
      const s = Number(parts[1]);
      if (Number.isFinite(m) && Number.isFinite(s)) return m * 60 + s;
    }
  }
  return 0;
}

function extractEventType(payload: Api4ComWebhookPayload) {
  return String(payload.eventType || payload.event_type || "").trim();
}

function extractCallId(payload: Api4ComWebhookPayload) {
  return String(payload.id || payload.callId || payload.uniqueid || "").trim() || `CALL-${Date.now()}`;
}

function verifyWebhookSignature(request: Request, body: string): boolean {
  const secret = process.env.API4COM_WEBHOOK_SECRET;
  if (!secret) return true; // signature check is opt-in until configured

  const receivedSig = String(
    request.headers.get("x-api4com-signature") ||
    request.headers.get("x-webhook-signature") ||
    request.headers.get("authorization") ||
    "",
  ).trim();

  if (!receivedSig) return false;

  // Support both HMAC-SHA256 and static bearer token
  if (receivedSig.startsWith("sha256=")) {
    const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(receivedSig.padEnd(expected.length, "\0"), "utf8");
    return a.length > 0 && b.length === a.length && timingSafeEqual(a, b);
  }

  // Static token comparison
  const a = Buffer.from(secret, "utf8");
  const b = Buffer.from(receivedSig, "utf8");
  return a.length > 0 && b.length === a.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();

    if (!verifyWebhookSignature(request, rawBody)) {
      return NextResponse.json(
        { success: false, message: "Assinatura invalida." },
        { status: 401 },
      );
    }

    let payload: Api4ComWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as Api4ComWebhookPayload;
    } catch {
      return NextResponse.json(
        { success: false, message: "Payload invalido." },
        { status: 400 },
      );
    }

    const eventType = extractEventType(payload);
    const callId = extractCallId(payload);

    const caller = String(payload.caller || payload.from || "").trim();
    const called = String(payload.called || payload.to || "").trim();
    const startedAt = toIsoMaybe(payload.startedAt || payload.started_at || null);
    const answeredAt = toIsoMaybe(payload.answeredAt || payload.answered_at || null);
    const endedAt = toIsoMaybe(payload.endedAt || payload.ended_at || null);
    const durationSeconds = parseDurationSeconds(payload.duration ?? payload.billsec ?? 0);
    const hangupCause = String(payload.hangupCause || payload.hangup_cause || "").trim() || null;
    const hangupCauseCode = String(payload.hangupCauseCode || payload.hangup_cause_code || "").trim() || null;
    const recordUrl = String(payload.recordUrl || payload.recording_url || "").trim() || null;

    const metadata = payload.metadata || {};
    const metaLeadId = String(metadata.leadId || "").trim() || null;
    const metaSessionId = String(metadata.sessionId || "").trim() || null;
    const metaNome = String(metadata.nome || "").trim();
    const metaEmpresa = String(metadata.empresa || "").trim();
    const metaGateway = String(metadata.gateway || "").trim() || null;
    const metaTelefone = String(metadata.telefone || "").trim();

    const principalPhone = normalizeDigits(metaTelefone || called || caller);

    let leadId = metaLeadId;
    let nome = metaNome;
    let empresa = metaEmpresa;
    let telefone = principalPhone;

    if (!leadId) {
      const foundLead = await findLeadByPhone(principalPhone);
      if (foundLead) {
        leadId = foundLead.id;
        nome = nome || foundLead.nome;
        empresa = empresa || foundLead.empresa;
        telefone = normalizeDigits(foundLead.telefone) || telefone;
      }
    }

    const status = mapWebhookStatus({
      eventType,
      durationSeconds,
      hangupCause,
      hangupCauseCode,
    });

    const { record } = await upsertCallLog({
      id: callId,
      externalCallId: callId,
      sessionId: metaSessionId,
      leadId,
      nome,
      empresa,
      telefone,
      caller,
      called,
      direction: String(payload.direction || "").trim(),
      startedAt,
      answeredAt,
      endedAt,
      durationSeconds,
      hangupCause,
      hangupCauseCode,
      recordUrl,
      gateway: metaGateway,
      eventType,
      status,
    });

    if (leadId && (eventType.toLowerCase().includes("hangup") || record.endedAt || record.durationSeconds)) {
      const referenceDate = record.endedAt || record.answeredAt || record.startedAt || record.updatedAt;
      const parsed = new Date(referenceDate);
      const stamp = `${parsed.toLocaleDateString("pt-BR")} as ${parsed.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
      await setLeadLastContactOverride(leadId, `Ligacao em ${stamp}`);
    }

    return NextResponse.json({
      success: true,
      received: true,
      callId: record.id,
      eventType,
    });
  } catch (error) {
    console.error("[API4COM][WEBHOOK] Erro ao processar webhook:", error instanceof Error ? error.message : "Erro desconhecido");
    return NextResponse.json(
      {
        success: false,
        received: false,
        message: "Webhook recebido com falhas de processamento.",
      },
      { status: 500 },
    );
  }
}
