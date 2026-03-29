import { ReactNode } from "react";

type LeadSectionCardProps = {
  title: string;
  subtitle?: string;
  highlight?: boolean;
  children: ReactNode;
};

export function LeadSectionCard({ title, subtitle, highlight = false, children }: LeadSectionCardProps) {
  return (
    <section
      className={`rounded-xl border p-4 ${
        highlight ? "border-emerald-400/50 bg-emerald-500/10 shadow-[0_0_0_1px_rgba(52,211,153,0.1)]" : "border-border bg-slate-900/50"
      }`}
    >
      <div className="mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.09em] text-slate-200">{title}</h3>
        {subtitle ? <p className="mt-1 text-xs text-muted">{subtitle}</p> : null}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
