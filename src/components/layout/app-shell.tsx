"use client";

import { ReactNode, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { Sidebar } from "./sidebar";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { currentUser, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const isLoginPage = pathname === "/login";

  useEffect(() => {
    if (loading) return;
    if (!currentUser && !isLoginPage) {
      router.replace("/login");
      return;
    }
    if (currentUser && isLoginPage) {
      router.replace("/leads");
    }
  }, [currentUser, isLoginPage, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen px-4 py-6 md:px-7">
        <div className="panel p-5 text-sm text-slate-300">Carregando sessao...</div>
      </div>
    );
  }

  if (!currentUser && !isLoginPage) {
    return (
      <div className="min-h-screen px-4 py-6 md:px-7">
        <div className="panel p-5 text-sm text-slate-300">Redirecionando para login...</div>
      </div>
    );
  }

  if (isLoginPage) {
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

      <main className="px-4 py-6 md:ml-64 md:px-7">{children}</main>
    </div>
  );
}
