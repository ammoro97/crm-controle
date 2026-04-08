import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getUserBySessionToken } from "./auth-store";

const SESSION_COOKIE = "crm_auth_token";
const AUTH_CACHE_TTL_MS = 30_000;
const AUTH_CACHE_MAX_ENTRIES = 500;

type CachedAuthEntry = {
  userId: string;
  email: string;
  expiresAt: number;
};

const authCache = new Map<string, CachedAuthEntry>();

function cleanupCache(now: number) {
  for (const [key, entry] of authCache) {
    if (entry.expiresAt <= now) {
      authCache.delete(key);
    }
  }
  while (authCache.size > AUTH_CACHE_MAX_ENTRIES) {
    const oldestKey = authCache.keys().next().value;
    if (!oldestKey) break;
    authCache.delete(oldestKey);
  }
}

export type AuthResult =
  | { authenticated: true; userId: string; email: string }
  | { authenticated: false; response: NextResponse };

export async function requireAuth(): Promise<AuthResult> {
  const startedAt = Date.now();
  const now = Date.now();
  cleanupCache(now);

  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value?.trim() || "";
    if (!token) {
      return {
        authenticated: false,
        response: NextResponse.json({ success: false, message: "Nao autorizado." }, { status: 401 }),
      };
    }

    const cached = authCache.get(token);
    if (cached && cached.expiresAt > now) {
      return {
        authenticated: true,
        userId: cached.userId,
        email: cached.email,
      };
    }

    const user = await getUserBySessionToken(token);
    if (!user) {
      authCache.delete(token);
      return {
        authenticated: false,
        response: NextResponse.json({ success: false, message: "Nao autorizado." }, { status: 401 }),
      };
    }

    authCache.set(token, {
      userId: user.id,
      email: user.email,
      expiresAt: now + AUTH_CACHE_TTL_MS,
    });

    return {
      authenticated: true,
      userId: user.id,
      email: user.email,
    };
  } catch (error) {
    console.error(
      `[requireAuth] error elapsed=${Date.now() - startedAt}ms`,
      error instanceof Error ? error.message : "erro_desconhecido",
    );
    return {
      authenticated: false,
      response: NextResponse.json(
        { success: false, message: "Servico de autenticacao indisponivel. Tente novamente." },
        { status: 503 },
      ),
    };
  }
}
