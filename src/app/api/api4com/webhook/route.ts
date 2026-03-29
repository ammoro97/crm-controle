import { NextResponse } from "next/server";
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

function extractEventType(payload: Api4ComWebhookPayload) {
  return String(payload.eventType || payload.event_type || "").trim();
}

function extractCallId(payload: Api4ComWebhookPayload) {
  return String(payload.id || payload.callId || payload.uniqueid || "").trim() || `CALL-${Date.now()}`;
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Api4ComWebhookPayload;
    console.log("[POSTCALL_DEBUG][WEBHOOK] Payload bruto recebido:", payload);

    const eventType = extractEventType(payload);
    const callId = extractCallId(payload);

    const caller = String(payload.caller || payload.from || "").trim();
    const called = String(payload.called || payload.to || "").trim();
    const startedAt = toIsoMaybe(payload.startedAt || payload.started_at || null);
    const answeredAt = toIsoMaybe(payload.answeredAt || payload.answered_at || null);
    const endedAt = toIsoMaybe(payload.endedAt || payload.ended_at || null);
    const durationSeconds = toNumber(payload.duration || payload.billsec || 0);
    const hangupCause = String(payload.hangupCause || payload.hangup_cause || "").trim() || null;
    const hangupCauseCode = String(payload.hangupCauseCode || payload.hangup_cause_code || "").trim() || null;
    const recordUrl = String(payload.recordUrl || payload.recording_url || "").trim() || null;

    const metadata = payload.metadata || {};
    const metaLeadId = String(metadata.leadId || "").trim() || null;
    const metaNome = String(metadata.nome || "").trim();
    const metaEmpresa = String(metadata.empresa || "").trim();
    const metaGateway = String(metadata.gateway || "").trim() || null;
    const metaTelefone = String(metadata.telefone || "").trim();

    const principalPhone = normalizeDigits(metaTelefone || called || caller);

    console.log("[POSTCALL_DEBUG][WEBHOOK] Campos extraidos", {
      eventType,
      callId,
      direction: payload.direction || "",
      caller,
      called,
      startedAt,
      answeredAt,
      endedAt,
      durationSeconds,
      hangupCause,
      hangupCauseCode,
      recordUrl,
      metaLeadId,
      metaNome,
      metaEmpresa,
      metaGateway,
      metaTelefone,
      principalPhone,
    });

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

    console.log("[POSTCALL_DEBUG][WEBHOOK] Relacao com lead apos tentativa de match", {
      leadId,
      nome,
      empresa,
      telefone,
    });

    const status = mapWebhookStatus({
      eventType,
      durationSeconds,
      hangupCause,
      hangupCauseCode,
    });

    const { record } = await upsertCallLog({
      id: callId,
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
      processingStatus: "pending",
    });

    console.log("[POSTCALL_DEBUG][WEBHOOK] Registro persistido no call store", {
      id: record.id,
      leadId: record.leadId,
      telefone: record.telefone,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      durationSeconds: record.durationSeconds,
      status: record.status,
      eventType: record.eventType,
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

    console.log("[POSTCALL_DEBUG][WEBHOOK] Processamento concluido", {
      callId: record.id,
      eventType,
      detectedAsEnded: Boolean(eventType.toLowerCase().includes("hangup") || record.endedAt || record.durationSeconds),
    });

    return NextResponse.json({
      success: true,
      received: true,
      callId: record.id,
      eventType,
    });
  } catch (error) {
    console.error("[API4COM][WEBHOOK] Erro ao processar webhook:", error);
    return NextResponse.json(
      {
        success: true,
        received: false,
        message: "Webhook recebido com falhas de processamento.",
      },
      { status: 200 },
    );
  }
}
