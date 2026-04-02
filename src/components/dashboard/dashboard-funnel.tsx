"use client";

import { useEffect, useMemo, useState } from "react";

type FunnelStepId = "ligacoes" | "atendidas" | "decisor" | "agendamentos";

type FunnelStep = {
  id: FunnelStepId;
  label: "Ligacoes" | "Atendidas" | "Decisor" | "Agendamentos";
  value: number;
  gradientFrom: string;
  gradientTo: string;
};

type DashboardFunnelProps = {
  ligacoes: number;
  atendidas: number;
  decisor: number;
  agendamentos: number;
};

function iconForStep(stepId: FunnelStepId) {
  if (stepId === "ligacoes") {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M5.8 4.9c.6-.7 1.7-.9 2.6-.5l2.1 1c.9.4 1.4 1.4 1.2 2.4l-.5 2a1.8 1.8 0 0 0 .5 1.6l2 2a1.8 1.8 0 0 0 1.6.5l2-.5c1-.2 2 .3 2.4 1.2l1 2.1c.4.9.2 2-.5 2.6l-1.2 1.1a3.6 3.6 0 0 1-3.7.6A19.8 19.8 0 0 1 4.2 8.6a3.6 3.6 0 0 1 .6-3.7L5.8 3.8Z" />
      </svg>
    );
  }

  if (stepId === "atendidas") {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M7.5 5.3h9A1.7 1.7 0 0 1 18.2 7v10A1.7 1.7 0 0 1 16.5 18.7h-9A1.7 1.7 0 0 1 5.8 17V7a1.7 1.7 0 0 1 1.7-1.7Z" />
        <path d="M8.8 9.2h6.4M8.8 12h6.4M8.8 14.8h3.8" />
      </svg>
    );
  }

  if (stepId === "decisor") {
    return (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="8.2" r="3.2" />
        <path d="M5 19.3c0-3.5 2.9-6.4 6.4-6.4h1.2c3.5 0 6.4 2.9 6.4 6.4" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M5 12.4 10 17l9-9" />
    </svg>
  );
}

function buildStepWidths(steps: FunnelStep[]): number[] {
  const maxValue = Math.max(1, ...steps.map((step) => step.value));
  const widths: number[] = [];

  steps.forEach((step, index) => {
    const proportionalWidth = Math.max(42, Math.min(100, Math.round((step.value / maxValue) * 100)));

    if (index === 0) {
      widths.push(Math.max(86, proportionalWidth));
      return;
    }

    const previous = widths[index - 1] ?? 86;
    widths.push(Math.max(42, Math.min(proportionalWidth, previous - 10)));
  });

  return widths;
}

export function DashboardFunnel({ ligacoes, atendidas, decisor, agendamentos }: DashboardFunnelProps) {
  const [animateIn, setAnimateIn] = useState(false);

  const steps: FunnelStep[] = useMemo(
    () => [
      {
        id: "ligacoes",
        label: "Ligacoes",
        value: ligacoes,
        gradientFrom: "#3B82F6",
        gradientTo: "#1D4ED8",
      },
      {
        id: "atendidas",
        label: "Atendidas",
        value: atendidas,
        gradientFrom: "#8B5CF6",
        gradientTo: "#6D28D9",
      },
      {
        id: "decisor",
        label: "Decisor",
        value: decisor,
        gradientFrom: "#22C55E",
        gradientTo: "#15803D",
      },
      {
        id: "agendamentos",
        label: "Agendamentos",
        value: agendamentos,
        gradientFrom: "#F97316",
        gradientTo: "#DC2626",
      },
    ],
    [agendamentos, atendidas, decisor, ligacoes],
  );

  const stepWidths = useMemo(() => buildStepWidths(steps), [steps]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setAnimateIn(true));
    return () => window.cancelAnimationFrame(frame);
  }, [steps]);

  return (
    <section className="relative overflow-hidden rounded-3xl border border-slate-800/80 bg-[#0F172A]/95 p-5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03),0_28px_68px_rgba(2,6,23,0.45)] md:p-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(59,130,246,0.24),transparent_38%),radial-gradient(circle_at_90%_100%,rgba(244,63,94,0.18),transparent_44%)]" />

      <div className="relative">
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-300">Funil de Agendamento</h2>
        <p className="mt-1 text-xs text-slate-400">Ligacoes, atendimento, decisor e agendamentos em sequencia operacional.</p>

        <div className="mt-5 space-y-0">
          {steps.map((step, index) => {
            const stepWidth = stepWidths[index] ?? 42;
            return (
              <div key={step.id} className={index === 0 ? "flex justify-center" : "-mt-2 flex justify-center"}>
                <div
                  className="group relative h-[84px] max-w-[620px] overflow-hidden border border-white/10"
                  style={{
                    width: animateIn ? `${stepWidth}%` : "0%",
                    clipPath: "polygon(6% 0, 94% 0, 100% 100%, 0 100%)",
                    backgroundImage: `linear-gradient(108deg, ${step.gradientFrom}, ${step.gradientTo})`,
                    transitionProperty: "width, box-shadow, transform",
                    transitionDuration: "850ms",
                    transitionTimingFunction: "cubic-bezier(0.22,1,0.36,1)",
                    transitionDelay: `${index * 90}ms`,
                    boxShadow: `0 0 0 1px rgba(255,255,255,0.08), 0 16px 36px rgba(2,6,23,0.42), 0 0 26px ${step.gradientFrom}50`,
                  }}
                >
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.22)_0%,rgba(255,255,255,0.04)_44%,rgba(255,255,255,0)_100%)]" />

                  <div className="relative flex h-full items-center justify-between px-5">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/90">{step.label}</p>
                    </div>

                    <div className="flex items-center gap-2 rounded-full border border-white/20 bg-black/20 px-3 py-1.5 text-white shadow-[0_8px_18px_rgba(2,6,23,0.3)]">
                      {iconForStep(step.id)}
                      <span className="text-3xl font-semibold tracking-[-0.03em] md:text-[34px]">{step.value}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
