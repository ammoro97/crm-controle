import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getUserBySessionToken } from "@/lib/auth-store";

const SESSION_COOKIE = "crm_auth_token";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value || "";
    if (!token) {
      return NextResponse.json({ authenticated: false, user: null });
    }
    const user = await getUserBySessionToken(token);
    if (!user) {
      return NextResponse.json({ authenticated: false, user: null });
    }
    return NextResponse.json({ authenticated: true, user });
  } catch (error) {
    return NextResponse.json(
      {
        authenticated: false,
        user: null,
        detail: error instanceof Error ? error.message : "Erro desconhecido",
      },
      { status: 500 },
    );
  }
}
