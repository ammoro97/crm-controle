"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase-client";
import { normalizeEmailForMatch, resolveResponsavelByEmailAsync } from "@/lib/responsavel-resolver";
import { PublicUser } from "@/types/auth";

type AuthContextValue = {
  currentUser: PublicUser | null;
  loading: boolean;
  login: (email: string, senha: string) => Promise<{ success: boolean; message?: string }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function toPublicUserFromSupabase(user: User): Promise<PublicUser> {
  const email = normalizeEmailForMatch(user.email || "");
  const resolved = await resolveResponsavelByEmailAsync(email);
  const nome = resolved.responsavel?.nome || "Responsavel nao vinculado";
  const responsavelId = resolved.responsavel?.id || "";

  return {
    id: user.id,
    email,
    nome,
    responsavelId,
    responsavelVinculado: resolved.linked,
  };
}

// Tempo máximo para operações Supabase client-side. Evita travamento infinito
// em "Carregando sessao..." ou "Entrando..." quando o Supabase está lento.
const CLIENT_AUTH_TIMEOUT_MS = 10_000;
const AUTH_LAST_USER_CACHE_KEY = "crm:auth:last-user:v1";

function withClientTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("CLIENT_AUTH_TIMEOUT")), ms),
    ),
  ]);
}

function isBrowser() {
  return typeof window !== "undefined";
}

function readCachedUser(): PublicUser | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(AUTH_LAST_USER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PublicUser | null;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.id !== "string" || typeof parsed.email !== "string") return null;
    return parsed;
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
    message.includes("authunknownerror") ||
    message.includes("unexpected token") ||
    message.includes("database error")
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const { data, error } = await withClientTimeout(
        supabase.auth.getUser(),
        CLIENT_AUTH_TIMEOUT_MS,
      );
      if (error) {
        if (isTransientClientAuthError(error)) {
          const cached = readCachedUser();
          if (cached) {
            setCurrentUser(cached);
            return;
          }
        }
        setCurrentUser(null);
        writeCachedUser(null);
        return;
      }
      if (!data.user) {
        setCurrentUser(null);
        writeCachedUser(null);
        return;
      }
      const publicUser = await withClientTimeout(
        toPublicUserFromSupabase(data.user),
        CLIENT_AUTH_TIMEOUT_MS,
      );
      setCurrentUser(publicUser);
      writeCachedUser(publicUser);
    } catch {
      const cached = readCachedUser();
      if (cached) {
        setCurrentUser(cached);
        return;
      }
      setCurrentUser(null);
    }
  }, []);

  useEffect(() => {
    let active = true;
    let subscription: { unsubscribe: () => void } | null = null;

    const bootstrap = async () => {
      try {
        await refreshUser();
      } finally {
        // Garante que o loading termina mesmo se refreshUser travar ou lançar.
        if (active) setLoading(false);
      }

      const listener = supabase.auth.onAuthStateChange((_event, session) => {
        if (!active) return;
        if (!session?.user) {
          setCurrentUser(null);
          return;
        }
        void (async () => {
          try {
            const publicUser = await withClientTimeout(
              toPublicUserFromSupabase(session.user),
              CLIENT_AUTH_TIMEOUT_MS,
            );
            if (active) {
              setCurrentUser(publicUser);
              writeCachedUser(publicUser);
            }
          } catch {
            // Falha ao enriquecer usuário não deve bloquear a sessão.
          }
        })();
      });

      subscription = listener.data.subscription;
    };

    void bootstrap();

    return () => {
      active = false;
      if (subscription) subscription.unsubscribe();
    };
  }, [refreshUser]);

  const login = useCallback(
    async (email: string, senha: string) => {
      try {
        const { data, error } = await withClientTimeout(
          supabase.auth.signInWithPassword({ email, password: senha }),
          CLIENT_AUTH_TIMEOUT_MS,
        );
        if (error || !data.user) {
          return { success: false, message: error?.message || "Nao foi possivel autenticar." };
        }

        // Enriquecimento com dados do responsável é best-effort.
        // Falha ou timeout aqui não bloqueia o login — o usuário entra com dados mínimos
        // e o refreshUser (onAuthStateChange) complementa na próxima oportunidade.
        let publicUser: PublicUser;
        try {
          publicUser = await withClientTimeout(
            toPublicUserFromSupabase(data.user),
            CLIENT_AUTH_TIMEOUT_MS,
          );
        } catch {
          const normalizedEmail = normalizeEmailForMatch(data.user.email || "");
          publicUser = {
            id: data.user.id,
            email: normalizedEmail,
            nome: "Responsavel nao vinculado",
            responsavelId: "",
            responsavelVinculado: false,
          };
        }

        setCurrentUser(publicUser);
        writeCachedUser(publicUser);
        return { success: true };
      } catch (err) {
        if (isTransientClientAuthError(err)) {
          const cached = readCachedUser();
          if (cached) {
            setCurrentUser(cached);
            return { success: true };
          }
        }
        const isTimeout = err instanceof Error && err.message === "CLIENT_AUTH_TIMEOUT";
        return {
          success: false,
          message: isTimeout
            ? "Servico indisponivel. Verifique sua conexao e tente novamente."
            : "Falha de rede ao autenticar.",
        };
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await supabase.auth.signOut();
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
