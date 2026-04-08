import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;
  void request;
  return NextResponse.json(
    {
      success: false,
      message: "Endpoint legado desativado. Use /api/integrations/api4com/ramais/test.",
      code: "API4_LEGACY_TEST_ENDPOINT_DISABLED",
    },
    { status: 410 },
  );
}
