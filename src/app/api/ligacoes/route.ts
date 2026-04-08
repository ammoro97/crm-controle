import { NextRequest, NextResponse } from "next/server";
import { getCallLogs } from "@/lib/calls-store";
import { readCallLogsPage } from "@/lib/calls-collection-store";
import { startApi4CallByAuthenticatedUser, StartCallError } from "@/lib/api4/start-call";
import { getAuthUser } from "@/lib/auth/get-auth-user";
import { requireAuth } from "@/lib/require-auth";
import type { StartCallInput } from "@/types/ligacoes";

const CALLS_PAGE_SIZE = 50;

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response;

  // Suporta paginação via ?page=N. Sem o param, retorna a página 0
  // (compatibilidade com clientes que ainda não enviam ?page=).
  const pageParam = request.nextUrl.searchParams.get("page");

  try {
    if (pageParam !== null) {
      // Caminho paginado: lê direto do Supabase por página, sem passar pelo cache em memória.
      const page = Math.max(0, parseInt(pageParam, 10));
      const result = await readCallLogsPage({ limit: CALLS_PAGE_SIZE, offset: page * CALLS_PAGE_SIZE });
      const ordered = [...result.calls].sort((a, b) => {
        const first = a.startedAt || a.createdAt;
        const second = b.startedAt || b.createdAt;
        return second.localeCompare(first);
      });
      return NextResponse.json({
        success: true,
        calls: ordered,
        pagination: { page, pageSize: CALLS_PAGE_SIZE, hasMore: result.hasMore },
      });
    }

    // Caminho legado: retorna todos (limitado a 1000 pelo calls-collection-store).
    const calls = await getCallLogs();
    const ordered = [...calls].sort((a, b) => {
      const first = a.startedAt || a.createdAt;
      const second = b.startedAt || b.createdAt;
      return second.localeCompare(first);
    });
    return NextResponse.json({ success: true, calls: ordered });
  } catch (error) {
    console.error(
      "[LIGACOES][GET] Falha ao carregar ligações:",
      error instanceof Error ? error.message : "erro desconhecido",
    );
    return NextResponse.json(
      { success: false, message: "Nao foi possivel carregar ligacoes." },
      { status: 500 },
    );
  }
}

type StartCallBody = {
  leadId?: string;
  numero?: string;
  phone?: string;
  sessionId?: string;
  nome?: string;
  name?: string;
  empresa?: string;
  company?: string;
  atendenteNome?: string;
};

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

export async function POST(request: Request) {
  const auth = await getAuthUser();
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as StartCallBody;
    const input: StartCallInput = {
      leadId: normalizeText(body.leadId),
      numero: normalizeText(body.numero || body.phone),
      sessionId: normalizeText(body.sessionId) || undefined,
      nome: normalizeText(body.nome || body.name) || undefined,
      empresa: normalizeText(body.empresa || body.company) || undefined,
      atendenteNome: normalizeText(body.atendenteNome) || undefined,
    };

    const result = await startApi4CallByAuthenticatedUser({
      authUserId: auth.user.id,
      authEmail: auth.user.email,
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
      { success: false, message: "Erro interno ao disparar ligacao." },
      { status: 500 },
    );
  }
}
