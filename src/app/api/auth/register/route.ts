import { NextResponse } from "next/server";
import { registerUser } from "@/lib/auth-store";

type RegisterBody = {
  email?: string;
  senha?: string;
};

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request: Request) {
  try {
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

