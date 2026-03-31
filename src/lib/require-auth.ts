import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "./supabase-server";

export type AuthResult =
  | { authenticated: true; userId: string; email: string }
  | { authenticated: false; response: NextResponse };

export async function requireAuth(): Promise<AuthResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
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
  } catch {
    return {
      authenticated: false,
      response: NextResponse.json(
        { success: false, message: "Nao autorizado." },
        { status: 401 },
      ),
    };
  }
}
