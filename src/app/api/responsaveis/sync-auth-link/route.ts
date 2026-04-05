import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import {
  syncResponsavelAuthLinkById,
  ResponsavelByAuthError,
} from "@/lib/responsaveis/get-responsavel-by-auth-user";

type SyncBody = {
  responsavelId?: string;
};

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

export async function POST(request: Request) {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  try {
    const body = (await request.json().catch(() => ({}))) as SyncBody;
    const responsavelId = normalizeText(body.responsavelId);
    if (!responsavelId) {
      return NextResponse.json(
        { success: false, message: "Informe o id do responsavel para sincronizar." },
        { status: 400 },
      );
    }

    const result = await syncResponsavelAuthLinkById(responsavelId);
    return NextResponse.json({
      success: true,
      responsavelId: result.responsavelId,
      authUserId: result.authUserId,
      linked: result.linked,
    });
  } catch (error) {
    if (error instanceof ResponsavelByAuthError) {
      return NextResponse.json(
        {
          success: false,
          code: error.code,
          message: error.message,
        },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { success: false, message: "Nao foi possivel sincronizar vinculo de login do responsavel." },
      { status: 500 },
    );
  }
}
