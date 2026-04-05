"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { FunnelStage } from "./funnel-stage";

type FunnelChartVariant = "blue" | "violet" | "amber" | "orange" | "emerald";

export type FunnelChartStep = {
  id: string;
  label: string;
  value: string | number;
  widthPercent: number;
  variant: FunnelChartVariant;
  icon?: ReactNode;
};

type FunnelChartProps = {
  title: string;
  subtitle: string;
  steps: FunnelChartStep[];
};

export function FunnelChart({ title, subtitle, steps }: FunnelChartProps) {
  const [animateIn, setAnimateIn] = useState(false);

  useEffect(() => {
    setAnimateIn(false);
    const frame = window.requestAnimationFrame(() => setAnimateIn(true));
    return () => window.cancelAnimationFrame(frame);
  }, [steps]);

  return (
    <section className="relative overflow-hidden rounded-2xl border border-slate-700/80 bg-[#101A2E]/82 p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03),0_18px_36px_rgba(2,6,23,0.4)] md:p-5">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_4%,rgba(59,130,246,0.14),transparent_42%),radial-gradient(circle_at_88%_96%,rgba(22,163,74,0.12),transparent_44%)]" />

      <div className="relative">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-300">{title}</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{subtitle}</p>

        <div className="mt-4 space-y-2 md:space-y-2.5">
          {steps.map((step, index) => (
            <FunnelStage
              key={step.id}
              label={step.label}
              value={step.value}
              widthPercent={step.widthPercent}
              variant={step.variant}
              icon={step.icon}
              animateIn={animateIn}
              index={index}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
