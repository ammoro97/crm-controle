"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const leadChildren = [
  { href: "/leads/inbound", label: "Inbound" },
  { href: "/leads/outbound", label: "Outbound" },
];

type SidebarProps = {
  onNavigate?: () => void;
};

export function Sidebar({ onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const leadsActive = pathname.startsWith("/leads");
  const [leadsExpanded, setLeadsExpanded] = useState(leadsActive);

  return (
    <aside className="h-full w-64 border-r border-border bg-slate-950/80 backdrop-blur">
      <div className="px-6 py-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">CRM</p>
        <h1 className="mt-1 text-lg font-semibold text-slate-100">Comercial Pro</h1>
      </div>
      <nav className="space-y-1 px-3">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className={`flex items-center rounded-lg px-3 py-2 text-sm transition ${
            pathname === "/dashboard"
              ? "bg-slate-800 text-slate-100"
              : "text-slate-300 hover:bg-slate-900 hover:text-slate-100"
          }`}
        >
          Dashboard
        </Link>

        <div className="rounded-lg">
          <Link
            href="/leads"
            onClick={(event) => {
              setLeadsExpanded((prev) => !prev);
              onNavigate?.();
              if (pathname === "/leads") {
                event.preventDefault();
              }
            }}
            className={`flex items-center rounded-lg px-3 py-2 text-sm transition ${
              leadsActive
                ? "bg-slate-800 text-slate-100"
                : "text-slate-300 hover:bg-slate-900 hover:text-slate-100"
            }`}
          >
            Leads
          </Link>

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
