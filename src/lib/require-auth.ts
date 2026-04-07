import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "./supabase-server";
import { withTimeout } from "./server/with-timeout";

// Tempo máximo para o Supabase responder antes de falhar rápido.
// Abaixo do limite de 25s da Vercel para que o route handler retorne 503
// em vez de deixar o Supabase pendurar até a plataforma matar a função.
const AUTH_TIMEOUT_MS = 8_000;

export type AuthResult =
  | { authenticated: true; userId: string; email: string }
  | { authenticated: false; response: NextResponse };

export async function requireAuth(): Promise<AuthResult> {
  const startedAt = Date.now();
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await withTimeout(
      supabase.auth.getUser(),
      AUTH_TIMEOUT_MS,
      "requireAuth",
    );

    if (error || !data.user) {
      console.warn(`[requireAuth] unauthorized elapsed=${Date.now() - startedAt}ms`);
      return {
        authenticated: false,
        response: NextResponse.json(
          { success: false, message: "Nao autorizado." },
          { status: 401 },
        ),
      };
    }

    return {
      authenticated: true,
      userId: data.user.id,
      email: data.user.email ?? "",
    };
  } catch (err) {
    const elapsed = Date.now() - startedAt;
    const isTimeout = err instanceof Error && err.message.startsWith("TIMEOUT:");
    console.error(`[requireAuth] ${isTimeout ? "timeout" : "error"} elapsed=${elapsed}ms`, isTimeout ? "" : err);
    return {
      authenticated: false,
      response: NextResponse.json(
        {
          success: false,
          message: isTimeout
            ? "Servico de autenticacao indisponivel. Tente novamente."
            : "Nao autorizado.",
        },
        { status: isTimeout ? 503 : 401 },
      ),
    };
  }
}
