import { NextResponse } from "next/server";
import { startApi4CallByAuthenticatedUser, StartCallError } from "@/lib/api4/start-call";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import type { StartCallInput } from "@/types/ligacoes";

type DialRequestBody = {
  phone?: string;
  numero?: string;
  leadId?: string;
  sessionId?: string;
  nome?: string;
  name?: string;
  empresa?: string;
  company?: string;
  responsavelId?: string;
  atendenteNome?: string;
};

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

export async function POST(request: Request) {
  const auth = await getAuthUser();
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as DialRequestBody;
    const input: StartCallInput = {
      leadId: normalizeText(body.leadId),
      numero: normalizeText(body.numero || body.phone),
      sessionId: normalizeText(body.sessionId) || undefined,
      nome: normalizeText(body.nome || body.name) || undefined,
      empresa: normalizeText(body.empresa || body.company) || undefined,
      responsavelId: normalizeText(body.responsavelId) || undefined,
      atendenteNome: normalizeText(body.atendenteNome) || undefined,
    };

    const result = await startApi4CallByAuthenticatedUser({
      userId: auth.user.id,
      input,
    });

    return NextResponse.json({
      success: true,
      message: result.message,
      externalCallId: result.externalCallId,
      data: result.data,
      callContext: result.context,
    });
  } catch (error) {
    if (error instanceof StartCallError) {
      return NextResponse.json(
        {
          success: false,
          code: error.code,
          message: error.message,
          detail: error.detail || null,
        },
        { status: error.status },
      );
    }

    return NextResponse.json(
      {
        success: false,
        message: "Erro interno ao disparar ligacao.",
      },
      { status: 500 },
    );
  }
}
