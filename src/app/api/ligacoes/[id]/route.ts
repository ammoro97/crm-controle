import { NextResponse } from "next/server";
import { CallAnalysisStatus } from "@/types/crm";
import { getCallLogs, updateCall, upsertCallLog } from "@/lib/calls-store";
import { requireAuth } from "@/lib/require-auth";

type PatchCallBody = {
  analysisStatus?: CallAnalysisStatus;
  analysisRequestId?: string | null;
  analysisObservationId?: string | null;
  analysisLeadId?: string | null;
  analysisUpdatedAt?: string | null;
  analysisError?: string | null;
  analysisPreview?: string | null;
  aiAnalysis?: string | null;
  externalCallId?: string | null;
  sessionId?: string | null;
  leadId?: string | null;
  telefone?: string | null;
  nome?: string | null;
  empresa?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  durationSeconds?: number | null;
  status?: string | null;
  gateway?: string | null;
  recordUrl?: string | null;
  sourceCallId?: string | null;
};

function normalizeAnalysisStatus(value?: string | null): CallAnalysisStatus | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "idle") return "idle";
  if (normalized === "processing") return "processing";
  if (normalized === "done") return "done";
  if (normalized === "error") return "error";
  return null;
}

function mapLegacyProcessingStatus(status: CallAnalysisStatus | null) {
  if (status === "processing") return "processing" as const;
  if (status === "done") return "done" as const;
  if (status === "error") return "error" as const;
  if (status === "idle") return "pending" as const;
  return undefined;
}

function normalizeDigits(value?: string | null) {
  return String(value || "").replace(/\D/g, "");
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  try {
    const params = await context.params;
    const callId = String(params.id || "").trim();
    if (!callId) {
      return NextResponse.json(
        { success: false, message: "ID da ligacao e obrigatorio." },
        { status: 400 },
      );
    }

    const body = (await request.json()) as PatchCallBody;
    const analysisStatus = normalizeAnalysisStatus(body.analysisStatus);

    const patch = {
      analysisStatus: analysisStatus || undefined,
      processingStatus: mapLegacyProcessingStatus(analysisStatus),
      analysisRequestId:
        body.analysisRequestId === undefined ? undefined : String(body.analysisRequestId || "").trim() || null,
      analysisObservationId:
        body.analysisObservationId === undefined
          ? undefined
          : String(body.analysisObservationId || "").trim() || null,
      analysisLeadId:
        body.analysisLeadId === undefined ? undefined : String(body.analysisLeadId || "").trim() || null,
      analysisUpdatedAt:
        body.analysisUpdatedAt === undefined
          ? new Date().toISOString()
          : String(body.analysisUpdatedAt || "").trim() || null,
      analysisError:
        body.analysisError === undefined ? undefined : String(body.analysisError || "").trim() || null,
      analysisPreview:
        body.analysisPreview === undefined ? undefined : String(body.analysisPreview || "").trim() || null,
      aiAnalysis:
        body.aiAnalysis === undefined ? undefined : String(body.aiAnalysis || "").trim() || null,
    };

    const hasPatchField = Object.values(patch).some((value) => value !== undefined);
    if (!hasPatchField) {
      return NextResponse.json(
        { success: false, message: "Nenhum campo valido para atualizar." },
        { status: 400 },
      );
    }

    const bodyExternalCallId = String(body.externalCallId || "").trim();
    const bodySessionId = String(body.sessionId || "").trim();
    const bodyLeadId = String(body.leadId || "").trim();
    const bodyPhoneDigits = normalizeDigits(body.telefone);
    const bodySourceCallId = String(body.sourceCallId || "").trim();
    const bodyStartedAt = String(body.startedAt || "").trim();
    const bodyStartedAtMinute = bodyStartedAt ? bodyStartedAt.slice(0, 16) : "";

    let targetCallId = callId;
    let updated;
    try {
      updated = await updateCall(targetCallId, patch);
    } catch (updateError) {
      const updateMessage = updateError instanceof Error ? updateError.message : "Erro desconhecido";
      if (updateMessage !== "CALL_LOG_NOT_FOUND") {
        throw updateError;
      }
      const calls = await getCallLogs();
      const fallback =
        calls.find((entry) => String(entry.externalCallId || "").trim() === callId) ||
        calls.find((entry) => String(entry.sessionId || "").trim() === callId) ||
        (bodyExternalCallId
          ? calls.find((entry) => String(entry.externalCallId || "").trim() === bodyExternalCallId)
          : undefined) ||
        (bodySessionId
          ? calls.find((entry) => String(entry.sessionId || "").trim() === bodySessionId)
          : undefined) ||
        (bodySourceCallId
          ? calls.find(
              (entry) =>
                entry.id === bodySourceCallId ||
                String(entry.externalCallId || "").trim() === bodySourceCallId,
            )
          : undefined) ||
        calls.find((entry) => {
          const entryLeadId = String(entry.leadId || "").trim();
          const entryPhoneDigits = normalizeDigits(entry.telefone || entry.called || entry.caller || "");
          const entryStartedAt = String(entry.startedAt || "").trim();
          const entryStartedAtMinute = entryStartedAt ? entryStartedAt.slice(0, 16) : "";
          if (!bodyLeadId || !bodyPhoneDigits || !bodyStartedAtMinute) return false;
          return (
            entryLeadId === bodyLeadId &&
            entryPhoneDigits === bodyPhoneDigits &&
            entryStartedAtMinute === bodyStartedAtMinute
          );
        });

      if (fallback) {
        targetCallId = fallback.id;
        updated = await updateCall(targetCallId, patch);
      } else {
        const created = await upsertCallLog({
          id: callId,
          externalCallId: bodyExternalCallId || null,
          sessionId: bodySessionId || null,
          leadId: bodyLeadId || null,
          telefone: String(body.telefone || "").trim(),
          nome: String(body.nome || "").trim(),
          empresa: String(body.empresa || "").trim(),
          startedAt: body.startedAt || null,
          endedAt: body.endedAt || null,
          durationSeconds: Number(body.durationSeconds || 0),
          status: String(body.status || "").trim() || "Nao atendida",
          gateway: String(body.gateway || "").trim() || null,
          recordUrl: String(body.recordUrl || "").trim() || null,
          ...patch,
        });
        targetCallId = created.record.id;
        updated = created.record;
      }
    }

    return NextResponse.json({
      success: true,
      resolvedCallId: targetCallId,
      call: updated,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Erro desconhecido";
    if (detail === "CALL_LOG_NOT_FOUND") {
      return NextResponse.json(
        { success: false, message: "Ligacao nao encontrada." },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { success: false, message: "Nao foi possivel atualizar a ligacao." },
      { status: 500 },
    );
  }
}
