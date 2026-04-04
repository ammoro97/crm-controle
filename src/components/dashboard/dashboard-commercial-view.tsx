"use client";

import { ReactNode, useMemo } from "react";
import { PageTopbar } from "@/components/layout/page-topbar";
import { DashboardFunnel } from "@/components/dashboard/dashboard-funnel";
import { DashboardMetricCard } from "@/components/dashboard/dashboard-metric-card";
import { useDashboardMetrics } from "@/hooks/use-dashboard-metrics";

type MetricCardKey =
  | "acionamentoBase"
  | "percentualAtendimento"
  | "conversaoLigacao"
  | "taxaSemInteresse"
  | "followUpsPendentes"
  | "leadDesqualificado"
  | "noShow"
  | "percentualCpc"
  | "vendasRealizadas"
  | "faturamento";

type MetricCardDefinition = {
  key: MetricCardKey;
  title: string;
  description: string;
  accentFrom: string;
  accentTo: string;
  icon: ReactNode;
  format: "number" | "currency" | "percent";
  progress?: boolean;
};

type MetricGroup = {
  id: string;
  title: string;
  cards: MetricCardDefinition[];
};

function iconPhone() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M5.6 4.8c.6-.7 1.7-.9 2.6-.5l2.2 1c.9.4 1.4 1.4 1.2 2.4l-.5 2.1a1.7 1.7 0 0 0 .5 1.6l2 2a1.7 1.7 0 0 0 1.6.5l2.1-.5c1-.2 2 .3 2.4 1.2l1 2.2c.4.9.2 2-.5 2.6l-1.3 1.1a3.6 3.6 0 0 1-3.7.6A19.8 19.8 0 0 1 4 8.5a3.6 3.6 0 0 1 .6-3.7L5.6 3.6Z" />
    </svg>
  );
}

function iconMoney() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 7.5C4 6.12 5.12 5 6.5 5h11c1.38 0 2.5 1.12 2.5 2.5v9c0 1.38-1.12 2.5-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-9Z" />
      <path d="M4 9h16M12 12v4M9.8 14.5h4.4" />
    </svg>
  );
}

function iconCheck() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="m5 12 4.2 4.2L19 6.5" />
    </svg>
  );
}

function iconClock() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.8v4.8l3.4 2.1" />
    </svg>
  );
}

function iconWarning() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 4.5 3.7 18.2A1.2 1.2 0 0 0 4.8 20h14.4a1.2 1.2 0 0 0 1.1-1.8L12 4.5Z" />
      <path d="M12 9.2v4.5M12 17.2h.01" />
    </svg>
  );
}

function iconArrowUp() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="m6.5 14.5 5.5-5.5 5.5 5.5" />
      <path d="M12 9v9" />
    </svg>
  );
}

function iconUsers() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M15.2 8.7a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Zm-6.4 1.1a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
      <path d="M2.5 20c0-3 2.4-5.4 5.4-5.4h1.8c3 0 5.4 2.4 5.4 5.4M14.2 20c0-2.4 2-4.4 4.4-4.4h.3c1.4 0 2.6.6 3.5 1.6" />
    </svg>
  );
}

function iconChart() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 18.5h16M7 16v-4.2M12 16V7.8M17 16V10" />
    </svg>
  );
}

function iconCalendar() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="4.2" y="5.4" width="15.6" height="14.4" rx="2.2" />
      <path d="M7.8 3.8v3.2M16.2 3.8v3.2M4.2 9.5h15.6" />
    </svg>
  );
}

const metricGroups: MetricGroup[] = [
  {
    id: "ativacao_contato",
    title: "Ativacao e contato inicial",
    cards: [
      {
        key: "acionamentoBase",
        title: "Acionamento Base",
        description: "Formula: (leads unicos acionados / leads outbound ativos) x 100.",
        accentFrom: "#3B82F6",
        accentTo: "#1D4ED8",
        icon: iconPhone(),
        format: "percent",
        progress: true,
      },
      {
        key: "percentualAtendimento",
        title: "% Atendimento",
        description: "Formula: (ligacoes atendidas / ligacoes feitas) x 100.",
        accentFrom: "#8B5CF6",
        accentTo: "#6D28D9",
        icon: iconUsers(),
        format: "percent",
        progress: true,
      },
      {
        key: "conversaoLigacao",
        title: "Conversao Ligacao",
        description: "Formula: (fechamentos agendados / contatos com decisor) x 100. Decisor inclui Follow-up e Sem Interesse.",
        accentFrom: "#22C55E",
        accentTo: "#15803D",
        icon: iconArrowUp(),
        format: "percent",
        progress: true,
      },
      {
        key: "taxaSemInteresse",
        title: "Taxa Sem Interesse",
        description: "Formula: (total de finalizacoes Sem Interesse / contatos com decisor) x 100.",
        accentFrom: "#F97316",
        accentTo: "#C2410C",
        icon: iconWarning(),
        format: "percent",
        progress: true,
      },
    ],
  },
  {
    id: "qualificacao_andamento",
    title: "Qualificacao e andamento",
    cards: [
      {
        key: "followUpsPendentes",
        title: "Follow ups Pendentes",
        description: "Follow-ups ativos com data/hora futura no outbound.",
        accentFrom: "#F59E0B",
        accentTo: "#D97706",
        icon: iconClock(),
        format: "number",
      },
      {
        key: "leadDesqualificado",
        title: "Lead Desqualificado",
        description: "Perdidos + finalizacoes oficiais com acao Apagar.",
        accentFrom: "#EF4444",
        accentTo: "#B91C1C",
        icon: iconWarning(),
        format: "number",
      },
      {
        key: "noShow",
        title: "No Show",
        description: "Eventos outbound com marcacao de nao comparecimento.",
        accentFrom: "#F97316",
        accentTo: "#C2410C",
        icon: iconCalendar(),
        format: "number",
      },
    ],
  },
  {
    id: "resultado_comercial",
    title: "Resultado comercial",
    cards: [
      {
        key: "percentualCpc",
        title: "% CPC",
        description: "Formula: (compras via call de fechamento na agenda / calls de fechamento) x 100.",
        accentFrom: "#06B6D4",
        accentTo: "#0E7490",
        icon: iconChart(),
        format: "percent",
        progress: true,
      },
      {
        key: "vendasRealizadas",
        title: "Vendas Realizadas",
        description: "Finalizacoes oficiais com motivo Compra efetuada.",
        accentFrom: "#22C55E",
        accentTo: "#15803D",
        icon: iconCheck(),
        format: "number",
      },
      {
        key: "faturamento",
        title: "Faturamento",
        description: "Soma dos valores de venda das compras efetuadas.",
        accentFrom: "#14B8A6",
        accentTo: "#0F766E",
        icon: iconMoney(),
        format: "currency",
      },
    ],
  },
];

function formatMetricValue(format: MetricCardDefinition["format"], value: number): string {
  if (format === "currency") {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      maximumFractionDigits: 2,
    }).format(value);
  }
  if (format === "percent") {
    return `${value.toFixed(1)}%`;
  }
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(value);
}

function seedTrend(seed: string, base: number): number[] {
  const normalizedBase = Math.max(1, base);
  let accumulator = seed.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const result: number[] = [];
  for (let index = 0; index < 7; index += 1) {
    accumulator = (accumulator * 31 + 17 + index * 13) % 997;
    const ratio = 0.45 + (accumulator % 55) / 100;
    result.push(Math.max(1, normalizedBase * ratio));
  }
  return result;
}

export function DashboardCommercialView() {
  const { metrics, loading, error, refresh } = useDashboardMetrics();

  const cardValues = useMemo(
    () => ({
      acionamentoBase: metrics.cards.acionamentoBase,
      percentualAtendimento: metrics.cards.percentualAtendimento,
      conversaoLigacao: metrics.cards.conversaoLigacao,
      taxaSemInteresse: metrics.cards.taxaSemInteresse,
      followUpsPendentes: metrics.cards.followUpsPendentes,
      leadDesqualificado: metrics.cards.leadDesqualificado,
      noShow: metrics.cards.noShow,
      percentualCpc: metrics.cards.percentualCpc,
      vendasRealizadas: metrics.cards.vendasRealizadas,
      faturamento: metrics.cards.faturamento,
    }),
    [metrics.cards],
  );

  return (
    <div className="space-y-4">
      <PageTopbar
        title="Leads"
        showSearch={false}
        actionsSlot={
          <button type="button" className="btn-ghost h-10 px-4 text-sm" onClick={refresh}>
            Atualizar
          </button>
        }
      />

      <p className="-mt-2 mb-1 px-1 text-sm text-slate-300">
        Painel comercial outbound com dois funis laterais (absoluto e conversao percentual) e metricas operacionais.
      </p>

      <section className="rounded-3xl border border-slate-800/80 bg-[#0B1220]/95 p-3 shadow-[0_36px_90px_rgba(2,6,23,0.5)] md:p-4">
        {error ? (
          <div className="rounded-xl border border-rose-400/35 bg-rose-500/10 p-4 text-sm text-rose-100">
            <p className="font-semibold">Erro ao carregar dashboard</p>
            <p className="mt-1 text-rose-100/90">{error}</p>
            <button type="button" className="btn-ghost mt-3 h-9 px-3 text-xs" onClick={refresh}>
              Tentar novamente
            </button>
          </div>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[460px_minmax(0,1fr)]">
          <DashboardFunnel
            ligacoes={metrics.funnels.absoluto.ligacoes}
            atendidas={metrics.funnels.absoluto.atendidas}
            decisor={metrics.funnels.absoluto.decisor}
            agendamentos={metrics.funnels.absoluto.agendamentos}
            compras={metrics.funnels.absoluto.compras}
            atendidasPercentual={metrics.funnels.conversao.atendidasPercentual}
            decisorPercentual={metrics.funnels.conversao.decisorPercentual}
            agendamentosPercentual={metrics.funnels.conversao.agendamentosPercentual}
            comprasPercentual={metrics.funnels.conversao.comprasPercentual}
          />

          <div className="space-y-3">
            {metricGroups.map((group) => (
              <section
                key={group.id}
                className="rounded-2xl border border-slate-800/80 bg-gradient-to-br from-slate-900/78 to-slate-950/40 p-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02)]"
              >
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-300">{group.title}</h3>
                  <span className="text-[10px] uppercase tracking-[0.1em] text-slate-500">Grupo operacional</span>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {group.cards.map((card) => {
                    const rawValue = cardValues[card.key];
                    return (
                      <DashboardMetricCard
                        key={card.key}
                        title={card.title}
                        description={card.description}
                        value={formatMetricValue(card.format, rawValue)}
                        icon={card.icon}
                        trend={seedTrend(card.key, rawValue)}
                        progress={card.progress ? rawValue : undefined}
                        accentFrom={card.accentFrom}
                        accentTo={card.accentTo}
                        compact={false}
                      />
                    );
                  })}

                  {loading
                    ? Array.from({ length: 3 }).map((_, index) => (
                        <div
                          key={`skeleton-${group.id}-${index}`}
                          className="h-[190px] animate-pulse rounded-2xl border border-slate-800/70 bg-slate-900/70"
                        />
                      ))
                    : null}
                </div>
              </section>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
