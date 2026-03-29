import { NextResponse } from "next/server";
import { getLeadLastContactOverrides } from "@/lib/calls-store";

export async function GET() {
  try {
    const overrides = await getLeadLastContactOverrides();
    return NextResponse.json({
      success: true,
      overrides,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: "Nao foi possivel carregar ultimo contato por ligacao.",
        detail: error instanceof Error ? error.message : "Erro desconhecido",
      },
      { status: 500 },
    );
  }
}
