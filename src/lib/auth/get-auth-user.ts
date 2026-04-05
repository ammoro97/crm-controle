import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";

export type AuthenticatedUser = {
  id: string;
  email: string;
};

export type AuthUserResult =
  | { ok: true; user: AuthenticatedUser }
  | { ok: false; response: NextResponse };

export async function getAuthUser(): Promise<AuthUserResult> {
  const auth = await requireAuth();
  if (!auth.authenticated) {
    return {
      ok: false,
      response: auth.response,
    };
  }

  return {
    ok: true,
    user: {
      id: auth.userId,
      email: auth.email,
    },
  };
}
