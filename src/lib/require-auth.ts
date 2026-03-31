import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getUserBySessionToken } from "./auth-store";
import type { PublicUser } from "@/types/auth";

const SESSION_COOKIE = "crm_auth_token";

export type AuthResult =
  | { authenticated: true; user: PublicUser }
  | { authenticated: false; response: NextResponse };

export async function requireAuth(): Promise<AuthResult> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value || "";
  if (!token) {
    return {
      authenticated: false,
      response: NextResponse.json(
        { success: false, message: "Nao autorizado." },
        { status: 401 },
      ),
    };
  }
  const user = await getUserBySessionToken(token);
  if (!user) {
    return {
      authenticated: false,
      response: NextResponse.json(
        { success: false, message: "Sessao invalida ou expirada." },
        { status: 401 },
      ),
    };
  }
  return { authenticated: true, user };
}
