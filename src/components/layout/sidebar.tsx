"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const leadChildren = [
  { href: "/leads/inbound", label: "Inbound" },
  { href: "/leads/outbound", label: "Outbound" },
];

type SidebarProps = {
  onNavigate?: () => void;
};

const LEADS_PINNED_STORAGE_KEY = "crm:sidebar:leads-pinned:v1";

export function Sidebar({ onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const leadsActive = pathname.startsWith("/leads");
  const [leadsExpanded, setLeadsExpanded] = useState(leadsActive);
  const [leadsPinned, setLeadsPinned] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LEADS_PINNED_STORAGE_KEY);
      setLeadsPinned(raw === "1");
    } catch {
      setLeadsPinned(false);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(LEADS_PINNED_STORAGE_KEY, leadsPinned ? "1" : "0");
    } catch {
      // noop
    }
  }, [leadsPinned]);

  useEffect(() => {
    if (leadsPinned) {
      setLeadsExpanded(true);
      return;
    }
    setLeadsExpanded(leadsActive);
  }, [leadsActive, leadsPinned]);

  return (
    <aside className="h-full w-64 border-r border-border bg-slate-950/80 backdrop-blur">
      <div className="px-6 py-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">CRM</p>
        <h1 className="mt-1 text-lg font-semibold text-slate-100">Comercial Pro</h1>
      </div>
      <nav className="space-y-1 px-3">
        <div className="rounded-lg">
          <div
            className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm transition ${
              leadsActive
                ? "bg-slate-800 text-slate-100"
                : "text-slate-300 hover:bg-slate-900 hover:text-slate-100"
            }`}
          >
            <Link
              href="/leads"
              onClick={(event) => {
                if (!leadsPinned) {
                  setLeadsExpanded((prev) => !prev);
                }
                onNavigate?.();
                if (pathname === "/leads") {
                  event.preventDefault();
                }
              }}
              className="flex-1"
            >
              Leads
            </Link>
            <button
              type="button"
              aria-label={leadsPinned ? "Desafixar submenu de leads" : "Fixar submenu de leads"}
              title={leadsPinned ? "Desafixar" : "Fixar"}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setLeadsPinned((prev) => !prev);
              }}
              className={`ml-2 inline-flex h-6 w-6 items-center justify-center rounded-md border transition ${
                leadsPinned
                  ? "border-cyan-400/60 bg-cyan-500/20 text-cyan-200"
                  : "border-slate-700/80 bg-slate-900/70 text-slate-400 hover:border-slate-500 hover:text-slate-200"
              }`}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true" className={`h-3.5 w-3.5 ${leadsPinned ? "" : "opacity-80"}`}>
                <path
                  fill="currentColor"
                  d="M5.2 1.5h5.6l-.7 3 1.5 1.4-.4.8H8.6v2.1l2.2 3.7-.7.5L8 9.4l-2.1 3.6-.7-.5 2.2-3.7V6.7H4.8l-.4-.8 1.5-1.4-.7-3Z"
                />
              </svg>
            </button>
          </div>

          {leadsExpanded ? (
            <div className="mt-1 space-y-1 pl-3">
              {leadChildren.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    className={`block rounded-lg px-3 py-2 text-sm transition ${
                      active
                        ? "bg-slate-800 text-slate-100"
                        : "text-slate-300 hover:bg-slate-900 hover:text-slate-100"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ) : null}
        </div>

        <Link
          href="/clientes"
          onClick={onNavigate}
          className={`flex items-center rounded-lg px-3 py-2 text-sm transition ${
            pathname === "/clientes"
              ? "bg-slate-800 text-slate-100"
              : "text-slate-300 hover:bg-slate-900 hover:text-slate-100"
          }`}
        >
          Clientes
        </Link>

        <Link
          href="/ligacoes"
          onClick={onNavigate}
          className={`flex items-center rounded-lg px-3 py-2 text-sm transition ${
            pathname === "/ligacoes"
              ? "bg-slate-800 text-slate-100"
              : "text-slate-300 hover:bg-slate-900 hover:text-slate-100"
          }`}
        >
          Ligacoes
        </Link>

        <Link
          href="/agenda"
          onClick={onNavigate}
          className={`flex items-center rounded-lg px-3 py-2 text-sm transition ${
            pathname === "/agenda"
              ? "bg-slate-800 text-slate-100"
              : "text-slate-300 hover:bg-slate-900 hover:text-slate-100"
          }`}
        >
          Agenda
        </Link>

        <Link
          href="/configuracoes"
          onClick={onNavigate}
          className={`flex items-center rounded-lg px-3 py-2 text-sm transition ${
            pathname === "/configuracoes"
              ? "bg-slate-800 text-slate-100"
              : "text-slate-300 hover:bg-slate-900 hover:text-slate-100"
          }`}
        >
          Configuracoes
        </Link>
      </nav>
    </aside>
  );
}
