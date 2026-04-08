"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { PublicUser } from "@/types/auth";

type AuthContextValue = {
  currentUser: PublicUser | null;
  loading: boolean;
  login: (email: string, senha: string) => Promise<{ success: boolean; message?: string }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

type MeResponse = {
  authenticated?: boolean;
  user?: PublicUser | null;
  detail?: string;
};

type LoginResponse = {
  success?: boolean;
  message?: string;
  user?: PublicUser;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const AUTH_LAST_USER_CACHE_KEY = "crm:auth:last-user:v1";
const CLIENT_AUTH_TIMEOUT_MS = 10_000;

function isBrowser() {
  return typeof window !== "undefined";
}

function withClientTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("CLIENT_AUTH_TIMEOUT")), ms);
    }),
  ]);
}

function readCachedUser(): PublicUser | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(AUTH_LAST_USER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PublicUser>;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.id !== "string" || typeof parsed.email !== "string" || typeof parsed.nome !== "string") return null;
    return {
      id: parsed.id,
      email: parsed.email,
      nome: parsed.nome,
      responsavelId: String(parsed.responsavelId || ""),
      responsavelVinculado: Boolean(parsed.responsavelVinculado),
    };
  } catch {
    return null;
  }
}

function writeCachedUser(user: PublicUser | null) {
  if (!isBrowser()) return;
  try {
    if (!user) {
      window.localStorage.removeItem(AUTH_LAST_USER_CACHE_KEY);
      return;
    }
    window.localStorage.setItem(AUTH_LAST_USER_CACHE_KEY, JSON.stringify(user));
  } catch {
    // noop
  }
}

function isTransientClientAuthError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  return (
    message.includes("client_auth_timeout") ||
    message.includes("timeout") ||
    message.includes("network") ||
    message.includes("fetch") ||
    message.includes("failed to connect") ||
    message.includes("context deadline")
  );
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await withClientTimeout(
    fetch(input, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.headers || {}),
      },
      cache: "no-store",
      credentials: "same-origin",
    }),
    CLIENT_AUTH_TIMEOUT_MS,
  );
  const data = (await response.json().catch(() => ({}))) as T;
  return data;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const data = await fetchJson<MeResponse>("/api/auth/me", { method: "GET" });
      if (data.authenticated && data.user) {
        setCurrentUser(data.user);
        writeCachedUser(data.user);
        return;
      }
      setCurrentUser(null);
      writeCachedUser(null);
    } catch (err) {
      if (isTransientClientAuthError(err)) {
        const cached = readCachedUser();
        if (cached) {
          setCurrentUser(cached);
          return;
        }
      }
      setCurrentUser(null);
      writeCachedUser(null);
    }
  }, []);

  useEffect(() => {
    let active = true;

    const bootstrap = async () => {
      try {
        await refreshUser();
      } finally {
        if (active) setLoading(false);
      }
    };

    const onFocus = () => {
      void refreshUser().catch(() => undefined);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void refreshUser().catch(() => undefined);
      }
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === AUTH_LAST_USER_CACHE_KEY) {
        void refreshUser().catch(() => undefined);
      }
    };

    void bootstrap();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("storage", onStorage);

    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("storage", onStorage);
    };
  }, [refreshUser]);

  const login = useCallback(async (email: string, senha: string) => {
    try {
      const response = await withClientTimeout(
        fetch("/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, senha }),
          cache: "no-store",
          credentials: "same-origin",
        }),
        CLIENT_AUTH_TIMEOUT_MS,
      );
      const data = (await response.json().catch(() => ({}))) as LoginResponse;

      if (!response.ok || !data.success) {
        return { success: false, message: data.message || "Nao foi possivel autenticar." };
      }

      if (data.user) {
        setCurrentUser(data.user);
        writeCachedUser(data.user);
      } else {
        await refreshUser();
      }

      return { success: true };
    } catch (err) {
      if (isTransientClientAuthError(err)) {
        const cached = readCachedUser();
        if (cached) {
          setCurrentUser(cached);
          return { success: true };
        }
      }
      return {
        success: false,
        message: "Servico indisponivel. Verifique sua conexao e tente novamente.",
      };
    }
  }, [refreshUser]);

  const logout = useCallback(async () => {
    try {
      await withClientTimeout(
        fetch("/api/auth/logout", {
          method: "POST",
          headers: { "content-type": "application/json" },
          cache: "no-store",
          credentials: "same-origin",
        }),
        CLIENT_AUTH_TIMEOUT_MS,
      );
    } finally {
      setCurrentUser(null);
      writeCachedUser(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      currentUser,
      loading,
      login,
      logout,
      refreshUser,
    }),
    [currentUser, loading, login, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth deve ser usado dentro de AuthProvider.");
  }
  return context;
}
