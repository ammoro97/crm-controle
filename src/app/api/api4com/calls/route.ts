import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { getActiveApi4ComIntegracao } from "@/lib/api4com-config-store";
import { mapWebhookStatus, upsertCallLogs } from "@/lib/calls-store";
import { requireAuth } from "@/lib/require-auth";
import type { CallLog } from "@/types/crm";

const API4COM_CALLS_ENDPOINTS = [
  "https://api.api4com.com/api/v1/calls",
  "https://api.api4com.com/api/v1/call-history",
  "https://api.api4com.com/api/v1/call_logs",
  "https://api.api4com.com/api/v1/cdr",
];
let preferredCallsEndpoint = API4COM_CALLS_ENDPOINTS[0];

type Api4ComCallItem = Record<string, unknown> & {
  metadata?: Record<string, unknown>;
};

function toNumberSafe(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildQuery(page: number, filter: string) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  if (filter) params.set("filter", filter);
  return params.toString();
}

function extractItems(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];

  const source = raw as Record<string, unknown>;
  if (Array.isArray(source.items)) return source.items;
  if (Array.isArray(source.data)) return source.data;
  if (source.data && typeof source.data === "object") {
    const data = source.data as Record<string, unknown>;
    if (Array.isArray(data.items)) return data.items;
    if (Array.isArray(data.records)) return data.records;
    if (Array.isArray(data.calls)) return data.calls;
  }
  if (Array.isArray(source.records)) return source.records;
  if (Array.isArray(source.calls)) return source.calls;
  return [];
}

function toStringSafe(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function toIsoMaybe(value: unknown): string | null {
  const raw = toStringSafe(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

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
      if (Number.isFinite(m) && Number.isFinite(s)) {
        return m * 60 + s;
      }
    }
  }
  return 0;
}

function normalizeDigits(value: unknown): string {
  return toStringSafe(value).replace(/\D/g, "");
}

function extractCallId(item: Api4ComCallItem, index: number): string {
  const explicit =
    toStringSafe(item.call_id) ||
    toStringSafe(item.callid) ||
    toStringSafe(item.uniqueid) ||
    toStringSafe(item.id);
  if (explicit) return explicit;

  const hash = createHash("sha1")
    .update(JSON.stringify(item) || `empty-${index}`)
    .digest("hex")
    .slice(0, 20);
  const phone = normalizeDigits(item.telefone || item.to || item.called || item.caller || "semfone");
  return `api4com-${phone || "semfone"}-${hash}`;
}

function toApiCallItem(raw: unknown): Api4ComCallItem | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as Api4ComCallItem;
}

function resolveCallStatus(item: Api4ComCallItem, eventType: string, durationSeconds: number): string {
  const explicitStatus =
    toStringSafe(item.status) ||
    toStringSafe(item.hangup_cause) ||
    toStringSafe(item.hangupCause);
  if (explicitStatus) return explicitStatus;
  return mapWebhookStatus({
    eventType,
    durationSeconds,
    hangupCause: toStringSafe(item.hangup_cause || item.hangupCause) || null,
    hangupCauseCode: toStringSafe(item.hangup_cause_code || item.hangupCauseCode) || null,
  });
}

function mapApiItemToCallInput(item: Api4ComCallItem, index: number): Partial<CallLog> & Pick<CallLog, "id"> {
  const metadata =
    item.metadata && typeof item.metadata === "object" ? (item.metadata as Record<string, unknown>) : {};
  const eventType = toStringSafe(item.event_type || item.eventType);
  const durationSeconds = parseDurationSeconds(
    item.duration ?? item.billsec ?? item.bill_duration ?? item.duration_seconds ?? 0,
  );
  const callId = extractCallId(item, index);
  const metadataCallId = toStringSafe(metadata.callId || metadata.callid || metadata.externalCallId || metadata.external_call_id);

  return {
    id: callId,
    externalCallId: callId || metadataCallId || null,
    sessionId: toStringSafe(metadata.sessionId) || null,
    leadId: toStringSafe(metadata.leadId) || null,
    userId: toStringSafe(metadata.authUserId || metadata.userId) || null,
    responsavelId: toStringSafe(metadata.responsavelId) || null,
    atendenteNome: toStringSafe(metadata.atendenteNome) || null,
    nome: toStringSafe(metadata.nome || item.first_name || item.nome),
    empresa: toStringSafe(metadata.empresa || item.empresa),
    telefone: normalizeDigits(metadata.telefone || item.telefone || item.to || item.called || item.caller),
    caller: toStringSafe(item.caller || item.from),
    called: toStringSafe(item.called || item.to),
    direction: toStringSafe(item.direction),
    startedAt: toIsoMaybe(item.started_at || item.startedAt),
    answeredAt: toIsoMaybe(item.answered_at || item.answeredAt),
    endedAt: toIsoMaybe(item.ended_at || item.endedAt),
    durationSeconds,
    hangupCause: toStringSafe(item.hangup_cause || item.hangupCause) || null,
    hangupCauseCode: toStringSafe(item.hangup_cause_code || item.hangupCauseCode) || null,
    recordUrl: toStringSafe(item.record_url || item.recording_url || item.recordUrl) || null,
    gateway: toStringSafe(metadata.gateway) || null,
    eventType,
    status: resolveCallStatus(item, eventType, durationSeconds) || "Nao atendida",
  };
}

async function syncExternalCalls(items: unknown[]) {
  const callInputs = items
    .map(toApiCallItem)
    .filter((item): item is Api4ComCallItem => item !== null)
    .map((item, index) => mapApiItemToCallInput(item, index))
    .filter((item) => Boolean(toStringSafe(item.id)));

  if (callInputs.length === 0) {
    return { persisted: 0, created: 0, updated: 0 };
  }

  const result = await upsertCallLogs(callInputs);
  return {
    persisted: result.records.length,
    created: result.createdCount,
    updated: result.updatedCount,
  };
}

async function parseApiResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function GET(request: Request) {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const page = toNumberSafe(searchParams.get("page"), 1);
    const filter = (searchParams.get("filter") || "").trim();

    const integration = await getActiveApi4ComIntegracao();
    const token = String(integration?.token || "").trim();

    if (!token) {
      return NextResponse.json({
        ok: false,
        error: integration
          ? "Token da API4COM nao configurado."
          : "Nenhum ramal da API4COM foi cadastrado.",
      });
    }

    const query = buildQuery(page, filter);
    const endpoints = [
      preferredCallsEndpoint,
      ...API4COM_CALLS_ENDPOINTS.filter((endpoint) => endpoint !== preferredCallsEndpoint),
    ].map((endpoint) => `${endpoint}?${query}`);

    let lastError = "Nao foi possivel buscar historico na API4COM.";

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: token,
          },
          cache: "no-store",
        });

        const raw = await parseApiResponse(response);

        if (!response.ok) {
          const message =
            raw && typeof raw === "object" && "message" in raw && typeof (raw as { message?: unknown }).message === "string"
              ? (raw as { message: string }).message
              : `Falha ao consultar historico`;
          lastError = message;
          continue;
        }

        preferredCallsEndpoint = endpoint.split("?")[0];

        const items = extractItems(raw);
        try {
          const sync = await syncExternalCalls(items);
          return NextResponse.json({
            ok: true,
            items,
            raw,
            sync,
          });
        } catch (syncError) {
          console.error(
            "[API4COM][CALLS] Falha ao persistir ligacoes no Supabase:",
            syncError instanceof Error ? syncError.message : syncError,
          );
          return NextResponse.json(
            {
              ok: false,
              error: "As ligacoes foram lidas da API, mas nao foi possivel persistir no Supabase.",
            },
            { status: 500 },
          );
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Erro desconhecido ao consultar API4COM.";
      }
    }

    return NextResponse.json({ ok: false, error: lastError });
  } catch {
    return NextResponse.json({
      ok: false,
      error: "Erro interno ao buscar ligacoes.",
    });
  }
}
