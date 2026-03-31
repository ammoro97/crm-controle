export const CALL_ANALYSIS_EVENT = "analisar" as const;
export const CALL_ANALYSIS_RESULT_EVENT = "call.analysis.completed" as const;
export const CALL_ANALYSIS_SECRET_HEADER = "x-webhook-secret" as const;

export type CallAnalysisEvent = typeof CALL_ANALYSIS_EVENT;
export type CallAnalysisResultEvent = typeof CALL_ANALYSIS_RESULT_EVENT;

export type CallAnalysisCallPayload = {
  id: string;
  leadId?: string | null;
  contactName?: string;
  companyName?: string;
  phone?: string;
  attendantName?: string;
  date?: string;
  startedAt?: string | null;
  endedAt?: string | null;
  durationSeconds?: number;
  durationLabel?: string;
  status?: string;
  finalizacao?: string;
  subfinalizacao?: string;
  origem?: string;
  ramal?: string;
  recordingUrl?: string | null;
  callId?: string;
  externalCallId?: string | null;
  sessionId?: string | null;
};

export type CallAnalysisRequestedPayload = {
  event: CallAnalysisEvent;
  triggeredAt: string;
  triggeredByUserId?: string;
  triggeredByName?: string;
  triggeredByEmail?: string;
  requestId: string;
  callbackUrl: string;
  call: CallAnalysisCallPayload;
};

export type CallAnalysisRequestStatus = "processing" | "done" | "error";

export type CallAnalysisRequestRecord = {
  requestId: string;
  callId: string;
  leadId: string;
  phoneDigits: string;
  externalCallId?: string | null;
  sessionId?: string | null;
  triggeredAt: string;
  triggeredByUserId?: string;
  triggeredByName?: string;
  triggeredByEmail?: string;
  status: CallAnalysisRequestStatus;
  observationId?: string | null;
  analysisText?: string | null;
  errorMessage?: string | null;
  completedAt?: string | null;
};

export type CallAnalysisObservationRecord = {
  id: string;
  leadId: string;
  callId: string;
  requestId: string;
  source?: "analise_ia_ligacao";
  metadata?: {
    leadId: string;
    callId: string;
    requestId: string;
    phoneDigits?: string | null;
    externalCallId?: string | null;
    sessionId?: string | null;
    completedAt?: string | null;
  } | null;
  owner: string;
  type: "analise ia";
  content: string;
  date: string;
  time: string;
  createdAt: string;
  updatedAt: string;
};
