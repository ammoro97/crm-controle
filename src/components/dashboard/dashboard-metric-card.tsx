"use client";

import { ReactNode } from "react";

type DashboardMetricCardProps = {
  title: string;
  description: string;
  value: string;
  icon: ReactNode;
  trend: number[];
  progress?: number;
  accentFrom: string;
  accentTo: string;
  compact?: boolean;
};

function normalizeTrend(values: number[]): number[] {
  if (values.length === 0) return [40, 52, 48, 60, 68, 72, 80];
  const maxValue = Math.max(1, ...values);
  return values.map((value) => Math.max(12, Math.round((value / maxValue) * 100)));
}

export function DashboardMetricCard({
  title,
  description,
  value,
  icon,
  trend,
  progress,
  accentFrom,
  accentTo,
  compact = false,
}: DashboardMetricCardProps) {
  const normalizedTrend = normalizeTrend(trend);
  const boundedProgress =
    typeof progress === "number" && Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : null;

  return (
    <article className="relative h-full overflow-hidden rounded-2xl border border-slate-800/80 bg-panel/95 p-4 shadow-card transition-all duration-200 hover:-translate-y-[2px] hover:shadow-card-hover">
      <div
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          background: `radial-gradient(circle at 16% -2%, ${accentFrom}38 0%, transparent 42%), radial-gradient(circle at 82% 112%, ${accentTo}30 0%, transparent 46%)`,
        }}
      />

      <div className="relative flex h-full flex-col">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.1em] text-slate-400">{title}</p>
            <p className={`mt-1.5 font-semibold tracking-[-0.03em] text-white ${compact ? "text-2xl" : "text-[32px]"}`}>{value}</p>
          </div>
          <div
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700/80 bg-slate-900/70 text-slate-200"
            style={{
              boxShadow: `0 0 0 1px ${accentFrom}44, 0 10px 22px ${accentTo}24`,
            }}
          >
            {icon}
          </div>
        </div>

        <p className="mt-2 text-xs leading-relaxed text-slate-300">{description}</p>

        <div className="mt-4 grid h-10 grid-flow-col auto-cols-fr items-end gap-1">
          {normalizedTrend.map((point, index) => (
            <span
              key={`${title}-${index}`}
              className="rounded-sm bg-gradient-to-t from-slate-700/40 to-slate-300/65"
              style={{
                height: `${point}%`,
                backgroundImage: `linear-gradient(to top, ${accentTo}66, ${accentFrom}cc)`,
              }}
            />
          ))}
        </div>

        {boundedProgress !== null ? (
          <div className="mt-3">
            <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.08em] text-slate-400">
              <span>Progresso</span>
              <span>{boundedProgress.toFixed(1)}%</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-900/90">
              <div
                className="h-full rounded-full transition-[width] duration-500 ease-out"
                style={{
                  width: `${boundedProgress}%`,
                  backgroundImage: `linear-gradient(90deg, ${accentFrom}, ${accentTo})`,
                }}
              />
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}

