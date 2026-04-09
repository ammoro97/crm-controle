import { NextResponse } from "next/server";
import { createSession, validateCredentials } from "@/lib/auth-store";
import { enforceRateLimit, getRequestClientIdentifier } from "@/lib/server/request-rate-limit";

type LoginBody = {
  email?: string;
  senha?: string;
};

const SESSION_COOKIE = "crm_auth_token";
const LOGIN_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 15;

function buildRateLimitResponse(retryAfterSeconds: number) {
  const response = NextResponse.json(
    { success: false, message: "Muitas tentativas de login. Tente novamente em instantes." },
    { status: 429 },
  );
  response.headers.set("Retry-After", String(retryAfterSeconds));
  return response;
}

export async function POST(request: Request) {
  try {
    const clientIdentifier = getRequestClientIdentifier(request);
    const rateLimitResult = enforceRateLimit({
      key: `auth:login:${clientIdentifier}`,
      limit: LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
      windowMs: LOGIN_RATE_LIMIT_WINDOW_MS,
    });
    if (!rateLimitResult.allowed) {
      return buildRateLimitResponse(rateLimitResult.retryAfterSeconds);
    }

    const body = (await request.json()) as LoginBody;
    const email = String(body.email || "").trim();
    const senha = String(body.senha || "");

    if (!email || !senha) {
      return NextResponse.json(
        { success: false, message: "Informe email e senha." },
        { status: 400 },
      );
    }

    const user = await validateCredentials(email, senha);
    if (!user) {
      return NextResponse.json(
        { success: false, message: "Credenciais invalidas." },
        { status: 401 },
      );
    }

    const token = await createSession(user);
    const response = NextResponse.json({
      success: true,
      user,
    });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 12,
    });
    return response;
  } catch (error) {
    console.error("[AUTH][LOGIN] Erro interno:", error instanceof Error ? error.message : "Erro desconhecido");
    return NextResponse.json(
      { success: false, message: "Nao foi possivel realizar login." },
      { status: 500 },
    );
  }
}
