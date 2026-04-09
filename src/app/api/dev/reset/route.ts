import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth } from "@/lib/require-auth";

const STORAGE_KEYS_TO_CLEAR = [
  "crm.agenda.meetings.v1",
  "crm.leads.finalizations.v1",
  "crm.calls.wrapups.v1",
];
const DEV_RESET_SECRET_HEADER = "x-dev-reset-secret";

function isDevResetEnabled(): boolean {
  const value = String(process.env.ENABLE_DEV_RESET_ENDPOINT || "")
    .trim()
    .toLowerCase();
  return value === "1" || value === "true";
}

function hasValidDevResetSecret(request: Request): boolean {
  const expectedSecret = String(process.env.DEV_RESET_SECRET || "").trim();
  if (!expectedSecret) return false;
  const receivedSecret = String(request.headers.get(DEV_RESET_SECRET_HEADER) || "").trim();
  const expectedBuffer = Buffer.from(expectedSecret, "utf8");
  const receivedBuffer = Buffer.from(receivedSecret, "utf8");
  if (expectedBuffer.length === 0 || expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

export async function POST(request: Request) {
  if (!isDevResetEnabled()) {
    return NextResponse.json({ success: false, message: "Endpoint indisponivel." }, { status: 404 });
  }

  if (!hasValidDevResetSecret(request)) {
    return NextResponse.json({ success: false, message: "Nao autorizado." }, { status: 401 });
  }

  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ success: false, message: "Supabase admin indisponivel." }, { status: 500 });
  }

  const errors: string[] = [];

  // 1. Leads
  const { error: leadsError } = await admin.from("crm_leads").delete().neq("lead_id", "__never__");
  if (leadsError) errors.push(`crm_leads: ${leadsError.message}`);

  // 2. Customers
  const { error: customersError } = await admin.from("crm_customers").delete().neq("lead_id", "__never__");
  if (customersError) errors.push(`crm_customers: ${customersError.message}`);

  // 3. Calls
  const { error: callsError } = await admin.from("crm_calls").delete().neq("call_id", "__never__");
  if (callsError) errors.push(`crm_calls: ${callsError.message}`);

  // 4. Storage keys (meetings, finalizations, wrapups)
  for (const key of STORAGE_KEYS_TO_CLEAR) {
    const { error } = await admin
      .from("crm_storage")
      .upsert({ key, value: [], updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) errors.push(`crm_storage/${key}: ${error.message}`);
  }

  if (errors.length > 0) {
    return NextResponse.json({ success: false, errors }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    cleared: ["crm_leads", "crm_customers", "crm_calls", ...STORAGE_KEYS_TO_CLEAR],
  });
}
