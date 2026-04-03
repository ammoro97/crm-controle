"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const leadChildren = [
  { href: "/leads/outbound", label: "Outbound" },
];

type SidebarProps = {
  onNavigate?: () => void;
  isPinned?: boolean;
  onPinnedChange?: (value: boolean) => void;
};

export function Sidebar({ onNavigate, isPinned = true, onPinnedChange }: SidebarProps) {
  const pathname = usePathname();
  const leadsActive = pathname.startsWith("/leads");
  const [leadsExpanded, setLeadsExpanded] = useState(leadsActive);

  useEffect(() => {
    if (isPinned) {
      setLeadsExpanded(leadsActive);
      return;
    }
    setLeadsExpanded(false);
  }, [isPinned, leadsActive]);

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
        <div className="rounded-lg">
          <Link
            href="/leads"
            onClick={(event) => {
              if (isPinned) {
                setLeadsExpanded((prev) => !prev);
                if (pathname === "/leads") {
                  event.preventDefault();
                }
              }
              onNavigate?.();
            }}
            className={linkClass(leadsActive)}
          >
            <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-slate-900/80 text-[11px] font-semibold text-slate-200">
              L
            </span>
            {isPinned ? <span className="ml-3">Leads</span> : null}
            {isPinned ? <span className="ml-auto text-xs text-slate-400">{leadsExpanded ? "▾" : "▸"}</span> : null}
          </Link>

          {isPinned && leadsExpanded ? (
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
          className={linkClass(pathname === "/clientes")}
        >
          <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-slate-900/80 text-[11px] font-semibold text-slate-200">
            C
          </span>
          {isPinned ? <span className="ml-3">Clientes</span> : null}
        </Link>

        <Link
          href="/ligacoes"
          onClick={onNavigate}
          className={linkClass(pathname === "/ligacoes")}
        >
          <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-slate-900/80 text-[11px] font-semibold text-slate-200">
            T
          </span>
          {isPinned ? <span className="ml-3">Ligacoes</span> : null}
        </Link>

        <Link
          href="/agenda"
          onClick={onNavigate}
          className={linkClass(pathname === "/agenda")}
        >
          <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-slate-900/80 text-[11px] font-semibold text-slate-200">
            A
          </span>
          {isPinned ? <span className="ml-3">Agenda</span> : null}
        </Link>

        <Link
          href="/assistente"
          onClick={onNavigate}
          className={linkClass(pathname === "/assistente")}
        >
          <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-slate-900/80 text-[11px] font-semibold text-slate-200">
            IA
          </span>
          {isPinned ? <span className="ml-3">Assistente</span> : null}
        </Link>

        <Link
          href="/configuracoes"
          onClick={onNavigate}
          className={linkClass(pathname === "/configuracoes")}
        >
          <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-slate-900/80 text-[11px] font-semibold text-slate-200">
            G
          </span>
          {isPinned ? <span className="ml-3">Configuracoes</span> : null}
        </Link>
      </nav>
    </aside>
  );
}
