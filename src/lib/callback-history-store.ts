import type { Lead } from "@/types/crm";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const CALLBACK_HISTORY_TABLE = "crm_callback_history";

export type CallbackHistoryInsertInput = {
  wrapupId: string;
  leadId: string;
  sessionId: string;
  callId?: string | null;
  externalCallId?: string | null;
  callbackAt: string;
  callbackBy: string;
  finalizacao: string;
  subfinalizacao?: string | null;
  leadPayload: Lead;
};

function trimText(value: unknown): string {
  return String(value || "").trim();
}

export async function upsertCallbackHistory(input: CallbackHistoryInsertInput): Promise<void> {
  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new Error("SUPABASE_UNAVAILABLE");
  }

  const row = {
    wrapup_id: trimText(input.wrapupId),
    lead_id: trimText(input.leadId),
    session_id: trimText(input.sessionId),
    call_id: trimText(input.callId) || null,
    external_call_id: trimText(input.externalCallId) || null,
    callback_at: trimText(input.callbackAt),
    callback_by: trimText(input.callbackBy),
    finalizacao: trimText(input.finalizacao),
    subfinalizacao: trimText(input.subfinalizacao) || null,
    lead_payload: input.leadPayload,
  };

  const { error } = await admin
    .from(CALLBACK_HISTORY_TABLE)
    .upsert(row, { onConflict: "wrapup_id" });

  if (error) {
    throw new Error(`CALLBACK_HISTORY_UPSERT_FAILED: ${error.message}`);
  }
}
