"use client";

import { useMemo } from "react";
import { FunnelChart, type FunnelChartStep } from "@/components/dashboard/funnel-chart";

type FunnelStepId = "ligacoes" | "atendidas" | "decisor" | "agendamentos" | "compras";

type DashboardFunnelProps = {
  ligacoes: number;
  atendidas: number;
  decisor: number;
  agendamentos: number;
  compras: number;
  atendidasPercentual: number;
  decisorPercentual: number;
  agendamentosPercentual: number;
  comprasPercentual: number;
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

  if (stepId === "compras") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="m5 12.4 4.2 4.2L19 6.9" />
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

export function DashboardFunnel({
  ligacoes,
  atendidas,
  decisor,
  agendamentos,
  compras,
  atendidasPercentual,
  decisorPercentual,
  agendamentosPercentual,
  comprasPercentual,
}: DashboardFunnelProps) {
  const absoluteSteps: FunnelChartStep[] = useMemo(
    () => [
      {
        id: "abs_ligacoes",
        label: "Ligações",
        value: formatMetricNumber(ligacoes),
        widthPercent: 100,
        variant: "blue",
        icon: iconForStep("ligacoes"),
      },
      {
        id: "abs_atendidas",
        label: "Atendidas",
        value: formatMetricNumber(atendidas),
        widthPercent: 80,
        variant: "violet",
        icon: iconForStep("atendidas"),
      },
      {
        id: "abs_decisor",
        label: "Decisor",
        value: formatMetricNumber(decisor),
        widthPercent: 64,
        variant: "green",
        icon: iconForStep("decisor"),
      },
      {
        id: "abs_agendamentos",
        label: "Fechamento",
        value: formatMetricNumber(agendamentos),
        widthPercent: 50,
        variant: "orange",
        icon: iconForStep("agendamentos"),
      },
      {
        id: "abs_compras",
        label: "Compras",
        value: formatMetricNumber(compras),
        widthPercent: 40,
        variant: "emerald",
        icon: iconForStep("compras"),
      },
    ],
    [agendamentos, atendidas, compras, decisor, ligacoes],
  );

  const percentSteps: FunnelChartStep[] = useMemo(
    () => [
      {
        id: "pct_atendidas",
        label: "Atendidas",
        value: formatMetricPercent(atendidasPercentual),
        widthPercent: 100,
        variant: "violet",
        icon: iconForStep("atendidas"),
      },
      {
        id: "pct_decisor",
        label: "Decisor",
        value: formatMetricPercent(decisorPercentual),
        widthPercent: 80,
        variant: "green",
        icon: iconForStep("decisor"),
      },
      {
        id: "pct_agendamentos",
        label: "Fechamento",
        value: formatMetricPercent(agendamentosPercentual),
        widthPercent: 68,
        variant: "orange",
        icon: iconForStep("agendamentos"),
      },
      {
        id: "pct_compras",
        label: "Compras",
        value: formatMetricPercent(comprasPercentual),
        widthPercent: 56,
        variant: "emerald",
        icon: iconForStep("compras"),
      },
    ],
    [agendamentosPercentual, atendidasPercentual, comprasPercentual, decisorPercentual],
  );

  return (
    <section className="relative overflow-hidden rounded-3xl border border-slate-800/80 bg-[#0F172A]/95 p-5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03),0_28px_68px_rgba(2,6,23,0.45)] md:p-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(59,130,246,0.22),transparent_38%),radial-gradient(circle_at_90%_100%,rgba(22,163,74,0.16),transparent_44%)]" />

      <div className="relative space-y-4">
        <FunnelChart
          title="Funil Principal (Valores Absolutos)"
          subtitle="Fonte real da tela de Ligações: Ligações → Atendidas → Decisor → Fechamento (agenda) → Compras."
          steps={absoluteSteps}
        />

        <FunnelChart
          title="Funil de Conversão (%)"
          subtitle="Atendidas = atendidas/ligações, Decisor = decisor/atendidas, Fechamento = agendamentos de fechamento/decisor, Compras = compras/fechamento."
          steps={percentSteps}
        />
      </div>
    </section>
  );
}
