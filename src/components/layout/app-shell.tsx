"use client";

import { ReactNode, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { ActiveCallSession, getActiveCallSession, subscribePostCallFlow } from "@/lib/post-call-flow";
import { Sidebar } from "./sidebar";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { currentUser, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const [activeCallSession, setActiveCallSession] = useState<ActiveCallSession | null>(null);
  const normalizedPath = (pathname || "/").replace(/\/+$/, "") || "/";
  const isAuthRoute = normalizedPath === "/login" || normalizedPath === "/cadastro";
  const hasWrapupPending = Boolean(activeCallSession && activeCallSession.status !== "wrapped");

  useEffect(() => {
    if (loading) return;
    if (!currentUser && !isAuthRoute) {
      router.replace("/login");
      return;
    }
    if (currentUser && isAuthRoute) {
      router.replace("/leads");
    }
  }, [currentUser, isAuthRoute, loading, router]);

  useEffect(() => {
    const sync = () => {
      setActiveCallSession(getActiveCallSession());
    };
    sync();
    return subscribePostCallFlow(sync);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen px-4 py-6 md:px-7">
        <div className="panel p-5 text-sm text-slate-300">Carregando sessao...</div>
      </div>
    );
  }

  if (!currentUser && !isAuthRoute) {
    return (
      <div className="min-h-screen px-4 py-6 md:px-7">
        <div className="panel p-5 text-sm text-slate-300">Redirecionando para login...</div>
      </div>
    );
  }

  if (isAuthRoute) {
    return <main className="px-4 py-6 md:px-7">{children}</main>;
  }

  return (
    <div className="min-h-screen">
      <div className="md:hidden sticky top-0 z-40 border-b border-border bg-slate-950/95 px-4 py-3 backdrop-blur">
        <button className="btn-ghost" type="button" onClick={() => setOpen(true)}>
          Menu
        </button>
      </div>

      <div className="fixed inset-y-0 left-0 z-30 hidden md:block">
        <Sidebar />
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="w-64">
            <Sidebar onNavigate={() => setOpen(false)} />
          </div>
          <button
            className="flex-1 bg-slate-950/70"
            onClick={() => setOpen(false)}
            type="button"
            aria-label="Fechar menu"
          />
        </div>
      ) : null}

      {hasWrapupPending ? (
        <div className="fixed bottom-4 right-4 z-50 max-w-xs rounded-lg border border-cyan-500/40 bg-cyan-500/10 p-3 shadow-lg backdrop-blur">
          <p className="text-[10px] uppercase tracking-[0.12em] text-cyan-200">Finalizacao pendente</p>
          <p className="mt-1 text-xs text-cyan-100">
            {activeCallSession?.status === "dialing"
              ? "Ligacao em andamento com finalizacao aberta."
              : "Ligacao encerrada aguardando finalizacao."}
          </p>
          <button
            type="button"
            className="btn-primary mt-2 h-8 px-3 py-1 text-xs"
            onClick={() => router.push("/ligacoes?postCall=1&restoreWrapup=1")}
          >
            Abrir finalizacao
          </button>
        </div>
      ) : null}

      <main className="px-4 py-6 md:ml-64 md:px-7">{children}</main>
    </div>
  );
}
