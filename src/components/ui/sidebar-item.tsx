"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export type SidebarItemProps = {
  icon: ReactNode;
  label: string;
  href?: string;
  variant?: "default" | "card";
  rightIcon?: ReactNode;
  onClick?: () => void;
};

function isHrefActive(href: string, pathname: string, searchParams: ReturnType<typeof useSearchParams>): boolean {
  const [hrefPath, hrefQuery] = href.split("?");
  if (pathname !== hrefPath) {
    return false;
  }

  if (!hrefQuery) {
    return true;
  }

  const expectedQuery = new URLSearchParams(hrefQuery);
  for (const [key, value] of expectedQuery.entries()) {
    if (searchParams.get(key) !== value) {
      return false;
    }
  }

  return true;
}

export function SidebarItem({
  icon,
  label,
  href,
  variant = "default",
  rightIcon,
  onClick,
}: SidebarItemProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = href ? isHrefActive(href, pathname, searchParams) : false;

  const baseClass =
    variant === "card"
      ? "flex h-14 w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-900/50 px-4 text-sm font-medium text-slate-200 transition hover:bg-slate-800/40"
      : "flex w-full min-h-10 items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition";

  const stateClass =
    variant === "card"
      ? active
        ? "border-slate-700 bg-slate-800/50"
        : ""
      : active
        ? "bg-slate-800 text-slate-100"
        : "text-slate-300 hover:bg-slate-900 hover:text-slate-100";

  const content = (
    <>
      <span className="inline-flex min-w-0 items-center gap-3">
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center [&>svg]:h-5 [&>svg]:w-5">
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </span>
      {rightIcon ? (
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center [&>svg]:h-5 [&>svg]:w-5">
          {rightIcon}
        </span>
      ) : null}
    </>
  );

  if (href) {
    return (
      <Link href={href} onClick={() => onClick?.()} className={`${baseClass} ${stateClass}`}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" onClick={() => onClick?.()} className={`${baseClass} ${stateClass}`}>
      {content}
    </button>
  );
}

