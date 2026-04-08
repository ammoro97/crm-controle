import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createHash } from "crypto";
import { createSupabaseServerClient } from "./supabase-server";
import { withTimeout } from "./server/with-timeout";

// Tempo máximo para o Supabase responder antes de falhar rápido.
// Abaixo do limite de 25s da Vercel para que o route handler retorne 503
// em vez de deixar o Supabase pendurar até a plataforma matar a função.
const AUTH_TIMEOUT_MS = 8_000;
const AUTH_CACHE_TTL_MS = 30 * 60_000;
const AUTH_CACHE_FRESH_MS = 30_000;
const AUTH_CACHE_MAX_ENTRIES = 500;

type CachedAuthEntry = {
  userId: string;
  email: string;
  expiresAt: number;
  validatedAt: number;
};

const authCache = new Map<string, CachedAuthEntry>();

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith("TIMEOUT:");
}

function isTransientAuthError(err: unknown): boolean {
  if (isTimeoutError(err)) return true;
  if (!(err instanceof Error)) return false;

  const message = err.message.toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("context deadline") ||
    message.includes("failed to connect") ||
    message.includes("network") ||
    message.includes("fetch") ||
    message.includes("authunknownerror") ||
    message.includes("unexpected token") ||
    message.includes("database error")
  );
}

function cleanupExpiredAuthCache(now: number) {
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

function getCachedAuth(cacheKey: string, now: number): CachedAuthEntry | null {
  const entry = authCache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    authCache.delete(cacheKey);
    return null;
  }
  return entry;
}

function setCachedAuth(cacheKey: string, userId: string, email: string, now: number) {
  authCache.set(cacheKey, {
    userId,
    email,
    validatedAt: now,
    expiresAt: now + AUTH_CACHE_TTL_MS,
  });
}

async function getAuthCacheKey(): Promise<string | null> {
  const headerStore = await headers();
  const cookieHeader = headerStore.get("cookie");
  if (!cookieHeader) return null;
  return createHash("sha256").update(cookieHeader).digest("hex");
}

export type AuthResult =
  | { authenticated: true; userId: string; email: string }
  | { authenticated: false; response: NextResponse };

export async function requireAuth(): Promise<AuthResult> {
  const startedAt = Date.now();
  const now = Date.now();
  cleanupExpiredAuthCache(now);
  const cacheKey = await getAuthCacheKey();

  if (cacheKey) {
    const cached = getCachedAuth(cacheKey, now);
    if (cached && now - cached.validatedAt <= AUTH_CACHE_FRESH_MS) {
      return {
        authenticated: true,
        userId: cached.userId,
        email: cached.email,
      };
    }
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await withTimeout(
      supabase.auth.getUser(),
      AUTH_TIMEOUT_MS,
      "requireAuth",
    );

    if (error) {
      if (cacheKey) {
        const cached = getCachedAuth(cacheKey, Date.now());
        if (cached && isTransientAuthError(error)) {
          console.warn(`[requireAuth] transient error, using cache elapsed=${Date.now() - startedAt}ms`);
          return {
            authenticated: true,
            userId: cached.userId,
            email: cached.email,
          };
        }
      }

      const isTransient = isTransientAuthError(error);
      console.warn(
        `[requireAuth] ${isTransient ? "transient_error" : "unauthorized"} elapsed=${Date.now() - startedAt}ms`,
      );
      return {
        authenticated: false,
        response: NextResponse.json(
          { success: false, message: isTransient ? "Servico de autenticacao indisponivel. Tente novamente." : "Nao autorizado." },
          { status: isTransient ? 503 : 401 },
        ),
      };
    }

    if (!data.user) {
      if (cacheKey) authCache.delete(cacheKey);
      console.warn(`[requireAuth] unauthorized elapsed=${Date.now() - startedAt}ms`);
      return {
        authenticated: false,
        response: NextResponse.json(
          { success: false, message: "Nao autorizado." },
          { status: 401 },
        ),
      };
    }

    if (cacheKey) {
      setCachedAuth(cacheKey, data.user.id, data.user.email ?? "", Date.now());
    }

    return {
      authenticated: true,
      userId: data.user.id,
      email: data.user.email ?? "",
    };
  } catch (err) {
    const elapsed = Date.now() - startedAt;
    const isTransient = isTransientAuthError(err);

    if (cacheKey) {
      const cached = getCachedAuth(cacheKey, Date.now());
      if (cached && isTransient) {
        console.warn(`[requireAuth] transient catch, using cache elapsed=${elapsed}ms`);
        return {
          authenticated: true,
          userId: cached.userId,
          email: cached.email,
        };
      }
    }

    console.error(`[requireAuth] ${isTransient ? "transient_error" : "error"} elapsed=${elapsed}ms`, isTransient ? "" : err);
    return {
      authenticated: false,
      response: NextResponse.json(
        {
          success: false,
          message: isTransient
            ? "Servico de autenticacao indisponivel. Tente novamente."
            : "Nao autorizado.",
        },
        { status: isTransient ? 503 : 401 },
      ),
    };
  }
}
