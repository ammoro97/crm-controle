import { NextResponse } from "next/server";
import { registerUser } from "@/lib/auth-store";
import { enforceRateLimit, getRequestClientIdentifier } from "@/lib/server/request-rate-limit";

type RegisterBody = {
  email?: string;
  senha?: string;
};

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const REGISTER_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const REGISTER_RATE_LIMIT_MAX_ATTEMPTS = 5;

function buildRateLimitResponse(retryAfterSeconds: number) {
  const response = NextResponse.json(
    { success: false, message: "Muitas tentativas de cadastro. Tente novamente em instantes." },
    { status: 429 },
  );
  response.headers.set("Retry-After", String(retryAfterSeconds));
  return response;
}

export async function POST(request: Request) {
  try {
    const clientIdentifier = getRequestClientIdentifier(request);
    const rateLimitResult = enforceRateLimit({
      key: `auth:register:${clientIdentifier}`,
      limit: REGISTER_RATE_LIMIT_MAX_ATTEMPTS,
      windowMs: REGISTER_RATE_LIMIT_WINDOW_MS,
    });
    if (!rateLimitResult.allowed) {
      return buildRateLimitResponse(rateLimitResult.retryAfterSeconds);
    }

    const body = (await request.json()) as RegisterBody;
    const email = String(body.email || "").trim().toLowerCase();
    const senha = String(body.senha || "");

    if (!email || !isValidEmail(email)) {
      return NextResponse.json(
        { success: false, message: "Informe um email valido." },
        { status: 400 },
      );
    }

    if (!senha) {
      return NextResponse.json(
        { success: false, message: "Informe uma senha valida." },
        { status: 400 },
      );
    }

    const result = await registerUser({
      email,
      password: senha,
    });

    if (!result.success) {
      return NextResponse.json(
        { success: false, message: result.message },
        { status: 400 },
      );
    }

    return NextResponse.json({
      success: true,
      user: result.user,
      message: "Conta criada com sucesso.",
    });
  } catch (error) {
    console.error("[AUTH][REGISTER] Erro interno:", error instanceof Error ? error.message : "Erro desconhecido");
    return NextResponse.json(
      { success: false, message: "Nao foi possivel concluir o cadastro." },
      { status: 500 },
    );
  }
}
