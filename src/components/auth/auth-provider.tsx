"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase-client";
import { getResponsavelByEmailSnapshot } from "@/lib/responsaveis-store";
import { PublicUser } from "@/types/auth";

type AuthContextValue = {
  currentUser: PublicUser | null;
  loading: boolean;
  login: (email: string, senha: string) => Promise<{ success: boolean; message?: string }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function toResponsavelId(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toDefaultName(email: string) {
  const localPart = (email || "").split("@")[0] || "usuario";
  return localPart
    .replace(/[._-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function toPublicUserFromSupabase(user: User): PublicUser {
  const email = user.email || "";
  const mappedResponsavel = getResponsavelByEmailSnapshot(email);
  const metadata = (user.user_metadata || {}) as Record<string, unknown>;
  const nome =
    mappedResponsavel?.nome ||
    String(metadata.nome || "").trim() ||
    String(metadata.name || "").trim() ||
    toDefaultName(email);
  const responsavelId =
    mappedResponsavel?.id ||
    String(metadata.responsavelId || "").trim() || toResponsavelId(nome || email || user.id);

  return {
    id: user.id,
    email,
    nome,
    responsavelId,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) {
        setCurrentUser(null);
        return;
      }
      setCurrentUser(toPublicUserFromSupabase(data.user));
    } catch {
      setCurrentUser(null);
    }
  }, []);

  useEffect(() => {
    let active = true;
    let subscription: { unsubscribe: () => void } | null = null;

    const bootstrap = async () => {
      await refreshUser();
      if (active) setLoading(false);

      const listener = supabase.auth.onAuthStateChange((_event, session) => {
        if (!active) return;
        if (!session?.user) {
          setCurrentUser(null);
          return;
        }
        setCurrentUser(toPublicUserFromSupabase(session.user));
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
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password: senha,
        });
        if (error || !data.user) {
          return { success: false, message: error?.message || "Nao foi possivel autenticar." };
        }
        setCurrentUser(toPublicUserFromSupabase(data.user));
        return { success: true };
      } catch {
        return { success: false, message: "Falha de rede ao autenticar." };
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } finally {
      setCurrentUser(null);
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
