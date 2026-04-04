"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

type SidebarProps = {
  onNavigate?: () => void;
  isPinned?: boolean;
  onPinnedChange?: (value: boolean) => void;
};

export function Sidebar({ onNavigate, isPinned = true, onPinnedChange }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const dashboardActive = pathname === "/leads";
  const leadsActive = pathname.startsWith("/leads/outbound");
  const inboundView = searchParams.get("view");
  const inboundDashboardActive = pathname === "/leads/inbound" && inboundView !== "leads";
  const inboundLeadsActive = pathname === "/leads/inbound" && inboundView === "leads";
  const outboundActive = dashboardActive || leadsActive;
  const inboundActive = pathname.startsWith("/leads/inbound");

  const [isOutboundOpen, setIsOutboundOpen] = useState(true);
  const [isInboundOpen, setIsInboundOpen] = useState(false);

  const linkClass = (active: boolean) =>
    `flex items-center rounded-lg py-2 text-sm transition ${
      isPinned ? "px-3" : "justify-center px-2"
    } ${
      active
        ? "bg-slate-800 text-slate-100"
        : "text-slate-300 hover:bg-slate-900 hover:text-slate-100"
    }`;

  return (
    <aside
      className={`h-full border-r border-border bg-slate-950/80 backdrop-blur transition-all duration-200 ${
        isPinned ? "w-64" : "w-[74px]"
      }`}
    >
      <div className={`${isPinned ? "px-6 py-6" : "px-3 py-6"}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-accent">CRM</p>
            {isPinned ? <h1 className="mt-1 text-lg font-semibold text-slate-100">Comercial Pro</h1> : null}
          </div>
          {onPinnedChange ? (
            <button
              type="button"
              aria-label={isPinned ? "Esconder barra lateral" : "Fixar barra lateral"}
              title={isPinned ? "Esconder barra lateral" : "Fixar barra lateral"}
              onClick={() => onPinnedChange(!isPinned)}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-md border transition ${
                isPinned
                  ? "border-cyan-400/60 bg-cyan-500/20 text-cyan-200"
                  : "border-slate-700/80 bg-slate-900/70 text-slate-300 hover:border-slate-500 hover:text-slate-100"
              }`}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true" className={`h-4 w-4 ${isPinned ? "" : "opacity-90"}`}>
                <path
                  fill="currentColor"
                  d="M5.2 1.5h5.6l-.7 3 1.5 1.4-.4.8H8.6v2.1l2.2 3.7-.7.5L8 9.4l-2.1 3.6-.7-.5 2.2-3.7V6.7H4.8l-.4-.8 1.5-1.4-.7-3Z"
                />
              </svg>
            </button>
          ) : null}
        </div>
      </div>

      <nav className={`space-y-1 ${isPinned ? "px-3" : "px-2"}`}>
        {isPinned ? (
          <p className="px-3 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Vendas
          </p>
        ) : null}

        {isPinned ? (
          <div className="space-y-3">
            <div
              className={`rounded-xl border px-3 py-2 ${
                outboundActive
                  ? "border-emerald-500/40 bg-gradient-to-r from-emerald-500/15 to-emerald-500/5"
                  : "border-slate-800 bg-slate-900/50"
              }`}
            >
              <button
                type="button"
                onClick={() => setIsOutboundOpen((prev) => !prev)}
                className="flex w-full items-center justify-between text-slate-200"
              >
                <span className="inline-flex items-center gap-2 text-base font-medium">
                  <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" className="h-4 w-4">
                    <path
                      d="m4.5 9 9 0M10.5 5.5 14 9l-3.5 3.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Outbound
                </span>
                <svg
                  viewBox="0 0 18 18"
                  fill="none"
                  aria-hidden="true"
                  className={`h-4 w-4 text-slate-400 transition-transform ${isOutboundOpen ? "rotate-0" : "-rotate-90"}`}
                >
                  <path d="m5.5 7 3.5 4 3.5-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {isOutboundOpen ? (
                <div className="mt-2 space-y-1">
                  <Link
                    href="/leads"
                    onClick={onNavigate}
                    className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition ${
                      dashboardActive
                        ? "text-emerald-300"
                        : "text-slate-300 hover:bg-slate-800/70 hover:text-slate-100"
                    }`}
                  >
                    <span className="text-slate-500">&bull;</span>
                    <span>Dashboard</span>
                  </Link>

                  <Link
                    href="/leads/outbound"
                    onClick={onNavigate}
                    className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition ${
                      leadsActive
                        ? "text-emerald-300"
                        : "text-slate-300 hover:bg-slate-800/70 hover:text-slate-100"
                    }`}
                  >
                    <span className="text-slate-500">&bull;</span>
                    <span>Leads</span>
                  </Link>
                </div>
              ) : null}
            </div>

            <div
              className={`rounded-xl border px-3 py-2 ${
                inboundActive
                  ? "border-cyan-500/40 bg-gradient-to-r from-cyan-500/15 to-cyan-500/5"
                  : "border-slate-800 bg-slate-900/50"
              }`}
            >
              <button
                type="button"
                onClick={() => setIsInboundOpen((prev) => !prev)}
                className="flex w-full items-center justify-between text-slate-300"
              >
                <span className="inline-flex items-center gap-2 text-base font-medium">
                  <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" className="h-4 w-4">
                    <path d="M13.5 9h-9M7.5 5.5 4 9l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Inbound
                </span>
                <svg
                  viewBox="0 0 18 18"
                  fill="none"
                  aria-hidden="true"
                  className={`h-4 w-4 text-slate-400 transition-transform ${isInboundOpen ? "rotate-0" : "-rotate-90"}`}
                >
                  <path d="m5.5 7 3.5 4 3.5-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {isInboundOpen ? (
                <div className="mt-2 space-y-1">
                  <Link
                    href="/leads/inbound"
                    onClick={onNavigate}
                    className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition ${
                      inboundDashboardActive
                        ? "text-cyan-300"
                        : "text-slate-300 hover:bg-slate-800/70 hover:text-slate-100"
                    }`}
                  >
                    <span className="text-slate-500">&bull;</span>
                    <span>Dashboard</span>
                  </Link>

                  <Link
                    href="/leads/inbound?view=leads"
                    onClick={onNavigate}
                    className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition ${
                      inboundLeadsActive
                        ? "text-cyan-300"
                        : "text-slate-300 hover:bg-slate-800/70 hover:text-slate-100"
                    }`}
                  >
                    <span className="text-slate-500">&bull;</span>
                    <span>Leads</span>
                  </Link>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            <Link href="/leads" onClick={onNavigate} className={linkClass(dashboardActive)}>
              <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" className="h-[18px] w-[18px] shrink-0">
                <path d="M3 14.5h12M5 12V8.5M9 12V5.5M13 12V9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </Link>

            <Link href="/leads/outbound" onClick={onNavigate} className={linkClass(leadsActive)}>
              <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" className="h-[18px] w-[18px] shrink-0">
                <path d="M2.5 4h13M4.5 8h9M6.5 12h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </Link>
          </>
        )}

        {isPinned ? <div className="my-2 h-px bg-slate-800/80" /> : null}
        {isPinned ? (
          <p className="px-3 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Relacionamento
          </p>
        ) : null}

        <Link href="/clientes" onClick={onNavigate} className={linkClass(pathname === "/clientes")}>
          <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" className="h-[18px] w-[18px] shrink-0">
            <path d="M12.5 13.5c0-1.657-1.567-3-3.5-3s-3.5 1.343-3.5 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="9" cy="6.5" r="2.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M15.5 13c0-1.1-.9-2-2-2m0-4.5a2 2 0 1 1 0 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M2.5 13c0-1.1.9-2 2-2m0-4.5a2 2 0 1 0 0 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          {isPinned ? <span className="ml-3">Clientes</span> : null}
        </Link>

        <Link href="/ligacoes" onClick={onNavigate} className={linkClass(pathname === "/ligacoes")}>
          <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" className="h-[18px] w-[18px] shrink-0">
            <path d="M3.5 4.5c.3 5.5 4.5 9.7 10 10l1-2.5-2.5-1-1 1.5c-2-.7-4-2.7-4.7-4.7l1.5-1-1-2.5-3.3 1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
          {isPinned ? <span className="ml-3">Ligacoes</span> : null}
        </Link>

        <Link href="/agenda" onClick={onNavigate} className={linkClass(pathname === "/agenda")}>
          <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" className="h-[18px] w-[18px] shrink-0">
            <rect x="2.5" y="3.5" width="13" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M6 2v3M12 2v3M2.5 7.5h13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="6.5" cy="11" r="1" fill="currentColor" />
            <circle cx="9" cy="11" r="1" fill="currentColor" />
            <circle cx="11.5" cy="11" r="1" fill="currentColor" />
          </svg>
          {isPinned ? <span className="ml-3">Agenda</span> : null}
        </Link>

        {isPinned ? <div className="my-2 h-px bg-slate-800/80" /> : null}
        {isPinned ? (
          <p className="px-3 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Sistema
          </p>
        ) : null}

        <Link href="/assistente" onClick={onNavigate} className={linkClass(pathname === "/assistente")}>
          <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" className="h-[18px] w-[18px] shrink-0">
            <path d="M9 2.5 10 6h3.5l-2.8 2 1 3.5L9 9.5 6.3 11.5l1-3.5L4.5 6H8L9 2.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M4 14.5h2M7.5 14.5h2M11 14.5h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
          </svg>
          {isPinned ? <span className="ml-3">Assistente</span> : null}
        </Link>

        <Link href="/configuracoes" onClick={onNavigate} className={linkClass(pathname === "/configuracoes")}>
          <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" className="h-[18px] w-[18px] shrink-0">
            <circle cx="9" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M9 2v1.5M9 14.5V16M2 9h1.5M14.5 9H16M3.93 3.93l1.06 1.06M13.01 13.01l1.06 1.06M14.07 3.93l-1.06 1.06M4.99 13.01l-1.06 1.06" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          {isPinned ? <span className="ml-3">Configuracoes</span> : null}
        </Link>
      </nav>
    </aside>
  );
}
