import { NextResponse } from "next/server";
import { getLeadLastContactOverrides } from "@/lib/calls-store";
import { requireAuth } from "@/lib/require-auth";

export async function GET() {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  try {
    const overrides = await getLeadLastContactOverrides();
    return NextResponse.json({
      success: true,
      overrides,
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Nao foi possivel carregar ultimo contato por ligacao." },
      { status: 500 },
    );
  }
}
