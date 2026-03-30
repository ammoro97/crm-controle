export const CALL_ANALYSIS_EVENT = "call.analysis.requested" as const;
export const CALL_ANALYSIS_SECRET_HEADER = "x-webhook-secret" as const;

export type CallAnalysisEvent = typeof CALL_ANALYSIS_EVENT;

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
  call: CallAnalysisCallPayload;
};
