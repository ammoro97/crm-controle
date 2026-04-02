"use client";

import { useEffect, useMemo, useState } from "react";

type FunnelStepId = "ligacoes" | "atendidas" | "decisor" | "agendamentos";

type FunnelStep = {
  id: string;
  iconId: FunnelStepId;
  label: string;
  value: number;
  gradientFrom: string;
  gradientTo: string;
};

type DashboardFunnelProps = {
  ligacoes: number;
  atendidas: number;
  decisor: number;
  agendamentos: number;
  atendidasPercentual: number;
  decisorPercentual: number;
  agendamentosPercentual: number;
};

function iconForStep(stepId: FunnelStepId) {
  if (stepId === "ligacoes") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M5.8 4.9c.6-.7 1.7-.9 2.6-.5l2.1 1c.9.4 1.4 1.4 1.2 2.4l-.5 2a1.8 1.8 0 0 0 .5 1.6l2 2a1.8 1.8 0 0 0 1.6.5l2-.5c1-.2 2 .3 2.4 1.2l1 2.1c.4.9.2 2-.5 2.6l-1.2 1.1a3.6 3.6 0 0 1-3.7.6A19.8 19.8 0 0 1 4.2 8.6a3.6 3.6 0 0 1 .6-3.7L5.8 3.8Z" />
      </svg>
    );
  }

  if (stepId === "atendidas") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M7.5 5.3h9A1.7 1.7 0 0 1 18.2 7v10A1.7 1.7 0 0 1 16.5 18.7h-9A1.7 1.7 0 0 1 5.8 17V7a1.7 1.7 0 0 1 1.7-1.7Z" />
        <path d="M8.8 9.2h6.4M8.8 12h6.4M8.8 14.8h3.8" />
      </svg>
    );
  }

  if (stepId === "decisor") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="8.2" r="3.2" />
        <path d="M5 19.3c0-3.5 2.9-6.4 6.4-6.4h1.2c3.5 0 6.4 2.9 6.4 6.4" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M5 12.4 10 17l9-9" />
    </svg>
  );
}

function formatMetricNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(Math.max(0, Math.round(value)));
}

function formatMetricPercent(value: number) {
  return `${new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Math.max(0, value))}%`;
}

function buildStepWidths(
  steps: FunnelStep[],
  options: {
    maxReferenceValue: number;
    minWidthPercent: number;
    firstMinWidthPercent: number;
    shrinkPerStep: number;
  },
): number[] {
  const maxValue = Math.max(1, options.maxReferenceValue);
  const widths: number[] = [];

  steps.forEach((step, index) => {
    const proportionalWidth = Math.max(
      options.minWidthPercent,
      Math.min(100, Math.round((Math.max(0, step.value) / maxValue) * 100)),
    );

    if (index === 0) {
      widths.push(Math.max(options.firstMinWidthPercent, proportionalWidth));
      return;
    }

    const previous = widths[index - 1] ?? options.firstMinWidthPercent;
    widths.push(Math.max(options.minWidthPercent, Math.min(proportionalWidth, previous - options.shrinkPerStep)));
  });

  return widths;
}

function renderFunnelBlock(params: {
  animateIn: boolean;
  title: string;
  subtitle: string;
  steps: FunnelStep[];
  displayMode: "absolute" | "percent";
  widthOptions: {
    maxReferenceValue: number;
    minWidthPercent: number;
    firstMinWidthPercent: number;
    shrinkPerStep: number;
  };
}) {
  const { animateIn, title, subtitle, steps, displayMode, widthOptions } = params;
  const stepWidths = buildStepWidths(steps, widthOptions);

  return (
    <section className="rounded-2xl border border-slate-700/75 bg-[#111A2E]/85 p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03),0_18px_34px_rgba(2,6,23,0.35)]">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-300">{title}</h3>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{subtitle}</p>

      <div className="mt-4 space-y-0">
        {steps.map((step, index) => {
          const stepWidth = stepWidths[index] ?? widthOptions.minWidthPercent;
          const displayValue = displayMode === "percent" ? formatMetricPercent(step.value) : formatMetricNumber(step.value);

          return (
            <div key={step.id} className={index === 0 ? "flex justify-center" : "-mt-2 flex justify-center"}>
              <div
                className="relative h-[82px] max-w-[640px] overflow-hidden border border-white/10"
                style={{
                  width: animateIn ? `${stepWidth}%` : "0%",
                  clipPath: "polygon(8% 0, 92% 0, 100% 100%, 0 100%)",
                  backgroundImage: `linear-gradient(108deg, ${step.gradientFrom}, ${step.gradientTo})`,
                  transitionProperty: "width, box-shadow",
                  transitionDuration: "840ms",
                  transitionTimingFunction: "cubic-bezier(0.22,1,0.36,1)",
                  transitionDelay: `${index * 90}ms`,
                  boxShadow: `0 0 0 1px rgba(255,255,255,0.08), 0 16px 34px rgba(2,6,23,0.42), 0 0 24px ${step.gradientFrom}50`,
                }}
              >
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.22)_0%,rgba(255,255,255,0.05)_44%,rgba(255,255,255,0)_100%)]" />

                <div className="relative flex h-full flex-col items-center justify-center px-5 text-center">
                  <p className="w-full truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-white/90">{step.label}</p>

                  <div className="mt-1.5 inline-flex max-w-full items-center justify-center gap-1.5 text-white">
                    <span className="opacity-80">{iconForStep(step.iconId)}</span>
                    <span className="text-[28px] font-semibold tracking-[-0.03em] md:text-[32px]">{displayValue}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function DashboardFunnel({
  ligacoes,
  atendidas,
  decisor,
  agendamentos,
  atendidasPercentual,
  decisorPercentual,
  agendamentosPercentual,
}: DashboardFunnelProps) {
  const [animateIn, setAnimateIn] = useState(false);

  const absoluteSteps: FunnelStep[] = useMemo(
    () => [
      {
        id: "abs_ligacoes",
        iconId: "ligacoes",
        label: "Ligacoes",
        value: ligacoes,
        gradientFrom: "#3B82F6",
        gradientTo: "#1D4ED8",
      },
      {
        id: "abs_atendidas",
        iconId: "atendidas",
        label: "Atendidas",
        value: atendidas,
        gradientFrom: "#8B5CF6",
        gradientTo: "#6D28D9",
      },
      {
        id: "abs_decisor",
        iconId: "decisor",
        label: "Decisor",
        value: decisor,
        gradientFrom: "#22C55E",
        gradientTo: "#15803D",
      },
      {
        id: "abs_agendamentos",
        iconId: "agendamentos",
        label: "Agendamentos",
        value: agendamentos,
        gradientFrom: "#F97316",
        gradientTo: "#DC2626",
      },
    ],
    [agendamentos, atendidas, decisor, ligacoes],
  );

  const percentSteps: FunnelStep[] = useMemo(
    () => [
      {
        id: "pct_atendidas",
        iconId: "atendidas",
        label: "Atendidas",
        value: atendidasPercentual,
        gradientFrom: "#8B5CF6",
        gradientTo: "#6D28D9",
      },
      {
        id: "pct_decisor",
        iconId: "decisor",
        label: "Decisor",
        value: decisorPercentual,
        gradientFrom: "#22C55E",
        gradientTo: "#15803D",
      },
      {
        id: "pct_agendamentos",
        iconId: "agendamentos",
        label: "Agendamentos",
        value: agendamentosPercentual,
        gradientFrom: "#F97316",
        gradientTo: "#DC2626",
      },
    ],
    [agendamentosPercentual, atendidasPercentual, decisorPercentual],
  );

  useEffect(() => {
    setAnimateIn(false);
    const frame = window.requestAnimationFrame(() => setAnimateIn(true));
    return () => window.cancelAnimationFrame(frame);
  }, [absoluteSteps, percentSteps]);

  return (
    <section className="relative overflow-hidden rounded-3xl border border-slate-800/80 bg-[#0F172A]/95 p-5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03),0_28px_68px_rgba(2,6,23,0.45)] md:p-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(59,130,246,0.24),transparent_38%),radial-gradient(circle_at_90%_100%,rgba(244,63,94,0.18),transparent_44%)]" />

      <div className="relative space-y-4">
        {renderFunnelBlock({
          animateIn,
          title: "Funil Principal (Valores Absolutos)",
          subtitle: "Fonte real da tela de Ligacoes: Ligacoes -> Atendidas -> Decisor -> Agendamentos.",
          steps: absoluteSteps,
          displayMode: "absolute",
          widthOptions: {
            maxReferenceValue: Math.max(1, ...absoluteSteps.map((step) => step.value)),
            minWidthPercent: 52,
            firstMinWidthPercent: 88,
            shrinkPerStep: 10,
          },
        })}

        {renderFunnelBlock({
          animateIn,
          title: "Funil de Conversao (%)",
          subtitle: "Atendidas = atendidas/ligacoes, Decisor = decisor/atendidas, Agendamentos = agendamentos/decisor.",
          steps: percentSteps,
          displayMode: "percent",
          widthOptions: {
            maxReferenceValue: 100,
            minWidthPercent: 56,
            firstMinWidthPercent: 72,
            shrinkPerStep: 8,
          },
        })}
      </div>
    </section>
  );
}
