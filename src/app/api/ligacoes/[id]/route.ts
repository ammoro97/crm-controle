import { NextResponse } from "next/server";
import { CallAnalysisStatus } from "@/types/crm";
import { updateCall } from "@/lib/calls-store";

type PatchCallBody = {
  analysisStatus?: CallAnalysisStatus;
  analysisRequestId?: string | null;
  analysisObservationId?: string | null;
  analysisLeadId?: string | null;
  analysisUpdatedAt?: string | null;
  analysisError?: string | null;
  analysisPreview?: string | null;
  aiAnalysis?: string | null;
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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
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

    const updated = await updateCall(callId, patch);

    return NextResponse.json({
      success: true,
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
      {
        success: false,
        message: "Nao foi possivel atualizar a ligacao.",
        detail,
      },
      { status: 500 },
    );
  }
}
