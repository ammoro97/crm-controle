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

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

type MeResponse = {
  authenticated?: boolean;
  user?: PublicUser | null;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/me", {
        method: "GET",
        cache: "no-store",
      });
      const data = (await response.json()) as MeResponse;
      if (!response.ok || !data.authenticated || !data.user) {
        setCurrentUser(null);
        return;
      }
      setCurrentUser(data.user);
    } catch {
      setCurrentUser(null);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const bootstrap = async () => {
      await refreshUser();
      if (active) setLoading(false);
    };
    void bootstrap();
    return () => {
      active = false;
    };
  }, [refreshUser]);

  const login = useCallback(
    async (email: string, senha: string) => {
      try {
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email, senha }),
        });
        const data = (await response.json()) as { success?: boolean; user?: PublicUser; message?: string };
        if (!response.ok || !data.success || !data.user) {
          return { success: false, message: data.message || "Nao foi possivel autenticar." };
        }
        setCurrentUser(data.user);
        return { success: true };
      } catch {
        return { success: false, message: "Falha de rede ao autenticar." };
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
      });
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
