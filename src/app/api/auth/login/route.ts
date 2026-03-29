import { NextResponse } from "next/server";
import { createSession, validateCredentials } from "@/lib/auth-store";

type LoginBody = {
  email?: string;
  senha?: string;
};

const SESSION_COOKIE = "crm_auth_token";

export async function POST(request: Request) {
  try {
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

    const token = await createSession(user.id);
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
    return NextResponse.json(
      {
        success: false,
        message: "Nao foi possivel realizar login.",
        detail: error instanceof Error ? error.message : "Erro desconhecido",
      },
      { status: 500 },
    );
  }
}
