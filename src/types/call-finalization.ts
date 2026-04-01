import { LeadEmail, LeadPhone } from "@/types/crm";

export const CALL_WRAPUP_EMAIL_EVENT = "call.wrapup.email" as const;

export type CallFinalization = {
  wrapupId: string;
  sessionId: string;
  callId?: string | null;
  externalCallId?: string | null;
  leadId?: string | null;
  result: string;
  reason?: string | null;
  observations?: string | null;
  nextAction?: string | null;
  followUpDate?: string | null;
  followUpTime?: string | null;
  savedAt: string;
  userId?: string | null;
  responsavelId?: string | null;
  atendenteNome?: string | null;
};

export type EmailDispatchLeadPayload = {
  id?: string | null;
  name?: string | null;
  company?: string | null;
  phone?: string | null;
  email?: string | null;
  phones?: LeadPhone[];
  emails?: LeadEmail[];
};

export type EmailDispatchMessagePayload = {
  to: string;
  content: string;
};

export type EmailDispatchPayload = {
  event: typeof CALL_WRAPUP_EMAIL_EVENT;
  triggeredAt: string;
  source: "crm";
  finalization: CallFinalization;
  lead: EmailDispatchLeadPayload;
  email: EmailDispatchMessagePayload;
  metadata?: Record<string, unknown>;
};

export type EmailDispatchRequestBody = {
  finalization: CallFinalization;
  lead: EmailDispatchLeadPayload;
  email: EmailDispatchMessagePayload;
  metadata?: Record<string, unknown>;
};

export type EmailDispatchResponse = {
  success: boolean;
  message?: string;
  error?: string;
  status?: number;
  detail?: string | null;
};
