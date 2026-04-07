"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SidebarItem } from "@/components/ui/sidebar-item";

type SidebarProps = {
  onNavigate?: () => void;
  isPinned?: boolean;
  onPinnedChange?: (value: boolean) => void;
};

const sectionTitleClass =
  "px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500";

const dividerClass = "mx-2 my-2 h-px bg-slate-800/80";

export function Sidebar({ onNavigate, isPinned = true, onPinnedChange }: SidebarProps) {
  const pathname = usePathname();
  const [isOutboundOpen, setIsOutboundOpen] = useState(true);
  const [isInboundOpen, setIsInboundOpen] = useState(false);

  const compactLinkClass = (active: boolean) =>
    `flex h-10 w-full items-center justify-center rounded-lg transition ${
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

      {isPinned ? (
        <nav className="space-y-1 px-3">
          <p className={sectionTitleClass}>Vendas</p>

          <div className="space-y-2">
            <div className="space-y-1">
              <SidebarItem
                variant="card"
                label="Outbound"
                onClick={() => setIsOutboundOpen((prev) => !prev)}
                icon={
                  <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
                    <path
                      d="m4.5 9 9 0M10.5 5.5 14 9l-3.5 3.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                }
                rightIcon={
                  <svg
                    viewBox="0 0 18 18"
                    fill="none"
                    aria-hidden="true"
                    className={`text-slate-400 transition-transform ${isOutboundOpen ? "rotate-90" : ""}`}
                  >
                    <path d="m7 5 4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                }
              />
              {isOutboundOpen ? (
                <div className="space-y-1 pl-2">
                  <SidebarItem
                    variant="default"
                    label="Dashboard"
                    href="/leads"
                    onClick={onNavigate}
                    icon={
                      <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
                        <circle cx="9" cy="9" r="2" fill="currentColor" />
                      </svg>
                    }
                  />
                  <SidebarItem
                    variant="default"
                    label="Leads"
                    href="/leads/outbound"
                    onClick={onNavigate}
                    icon={
                      <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
                        <circle cx="9" cy="9" r="2" fill="currentColor" />
                      </svg>
                    }
                  />
                  <SidebarItem
                    variant="default"
                    label="Callback"
                    href="/leads/outbound/callback"
                    onClick={onNavigate}
                    icon={
                      <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
                        <circle cx="9" cy="9" r="2" fill="currentColor" />
                      </svg>
                    }
                  />
                </div>
              ) : null}
            </div>

            <div className="space-y-1">
              <SidebarItem
                variant="card"
                label="Inbound"
                onClick={() => setIsInboundOpen((prev) => !prev)}
                icon={
                  <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
                    <path
                      d="M13.5 9h-9M7.5 5.5 4 9l3.5 3.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                }
                rightIcon={
                  <svg
                    viewBox="0 0 18 18"
                    fill="none"
                    aria-hidden="true"
                    className={`text-slate-400 transition-transform ${isInboundOpen ? "rotate-90" : ""}`}
                  >
                    <path d="m7 5 4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                }
              />
              {isInboundOpen ? (
                <div className="space-y-1 pl-2">
                  <SidebarItem
                    variant="default"
                    label="Dashboard"
                    href="/leads/inbound"
                    onClick={onNavigate}
                    icon={
                      <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
                        <circle cx="9" cy="9" r="2" fill="currentColor" />
                      </svg>
                    }
                  />
                  <SidebarItem
                    variant="default"
                    label="Leads"
                    href="/leads/inbound?view=leads"
                    onClick={onNavigate}
                    icon={
                      <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
                        <circle cx="9" cy="9" r="2" fill="currentColor" />
                      </svg>
                    }
                  />
                </div>
              ) : null}
            </div>
          </div>

          <div className={dividerClass} />
          <p className={sectionTitleClass}>Relacionamento</p>

          <SidebarItem
            variant="default"
            label="Clientes"
            href="/clientes"
            onClick={onNavigate}
            icon={
              <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path
                  d="M12.5 13.5c0-1.657-1.567-3-3.5-3s-3.5 1.343-3.5 3"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <circle cx="9" cy="6.5" r="2.5" stroke="currentColor" strokeWidth="1.5" />
                <path
                  d="M15.5 13c0-1.1-.9-2-2-2m0-4.5a2 2 0 1 1 0 4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <path
                  d="M2.5 13c0-1.1.9-2 2-2m0-4.5a2 2 0 1 0 0 4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            }
          />

          <SidebarItem
            variant="default"
            label="Ligacoes"
            href="/ligacoes"
            onClick={onNavigate}
            icon={
              <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path
                  d="M3.5 4.5c.3 5.5 4.5 9.7 10 10l1-2.5-2.5-1-1 1.5c-2-.7-4-2.7-4.7-4.7l1.5-1-1-2.5-3.3 1Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
            }
          />

          <SidebarItem
            variant="default"
            label="Agenda"
            href="/agenda"
            onClick={onNavigate}
            icon={
              <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <rect x="2.5" y="3.5" width="13" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M6 2v3M12 2v3M2.5 7.5h13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="6.5" cy="11" r="1" fill="currentColor" />
                <circle cx="9" cy="11" r="1" fill="currentColor" />
                <circle cx="11.5" cy="11" r="1" fill="currentColor" />
              </svg>
            }
          />

          <div className={dividerClass} />
          <p className={sectionTitleClass}>Sistema</p>

          <SidebarItem
            variant="default"
            label="Assistente"
            href="/assistente"
            onClick={onNavigate}
            icon={
              <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path
                  d="M9 2.5 10 6h3.5l-2.8 2 1 3.5L9 9.5 6.3 11.5l1-3.5L4.5 6H8L9 2.5Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <path
                  d="M4 14.5h2M7.5 14.5h2M11 14.5h3"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  opacity="0.5"
                />
              </svg>
            }
          />

          <SidebarItem
            variant="default"
            label="Configuracoes"
            href="/configuracoes"
            onClick={onNavigate}
            icon={
              <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <circle cx="9" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.5" />
                <path
                  d="M9 2v1.5M9 14.5V16M2 9h1.5M14.5 9H16M3.93 3.93l1.06 1.06M13.01 13.01l1.06 1.06M14.07 3.93l-1.06 1.06M4.99 13.01l-1.06 1.06"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            }
          />
        </nav>
      ) : (
        <nav className="space-y-1 px-2">
          <Link href="/leads" onClick={onNavigate} className={compactLinkClass(pathname === "/leads")}>
            <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" className="h-5 w-5">
              <path d="M3 14.5h12M5 12V8.5M9 12V5.5M13 12V9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </Link>
          <Link href="/leads/outbound" onClick={onNavigate} className={compactLinkClass(pathname.startsWith("/leads/outbound"))}>
            <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" className="h-5 w-5">
              <path d="M2.5 4h13M4.5 8h9M6.5 12h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </Link>
          <Link href="/clientes" onClick={onNavigate} className={compactLinkClass(pathname === "/clientes")}>
            <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" className="h-5 w-5">
              <path d="M12.5 13.5c0-1.657-1.567-3-3.5-3s-3.5 1.343-3.5 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="9" cy="6.5" r="2.5" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </Link>
          <Link href="/ligacoes" onClick={onNavigate} className={compactLinkClass(pathname === "/ligacoes")}>
            <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" className="h-5 w-5">
              <path
                d="M3.5 4.5c.3 5.5 4.5 9.7 10 10l1-2.5-2.5-1-1 1.5c-2-.7-4-2.7-4.7-4.7l1.5-1-1-2.5-3.3 1Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
          <Link href="/agenda" onClick={onNavigate} className={compactLinkClass(pathname === "/agenda")}>
            <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" className="h-5 w-5">
              <rect x="2.5" y="3.5" width="13" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M6 2v3M12 2v3M2.5 7.5h13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </Link>
          <Link href="/assistente" onClick={onNavigate} className={compactLinkClass(pathname === "/assistente")}>
            <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" className="h-5 w-5">
              <path d="M9 2.5 10 6h3.5l-2.8 2 1 3.5L9 9.5 6.3 11.5l1-3.5L4.5 6H8L9 2.5Z" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </Link>
          <Link href="/configuracoes" onClick={onNavigate} className={compactLinkClass(pathname === "/configuracoes")}>
            <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" className="h-5 w-5">
              <circle cx="9" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </Link>
        </nav>
      )}
    </aside>
  );
}

