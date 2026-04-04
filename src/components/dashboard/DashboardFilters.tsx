"use client";

import type { DashboardFilters as DashboardFiltersValue, PresetPeriodo } from "@/types/dashboard";

export type DashboardVendedorOption = {
  id: string;
  nome: string;
};

type DashboardFiltersProps = {
  value: DashboardFiltersValue;
  vendedores: DashboardVendedorOption[];
  loading?: boolean;
  onChange: (next: DashboardFiltersValue) => void;
};

const PERIODO_OPTIONS: Array<{ value: PresetPeriodo; label: string }> = [
  { value: "max", label: "Maximo" },
  { value: "3d", label: "Ultimos 3 dias" },
  { value: "7d", label: "Ultimos 7 dias" },
  { value: "15d", label: "Ultimos 15 dias" },
  { value: "30d", label: "Ultimos 30 dias" },
  { value: "custom", label: "Personalizado" },
];

export function DashboardFilters({ value, vendedores, loading = false, onChange }: DashboardFiltersProps) {
  const isCustom = value.periodo === "custom";

  return (
    <section className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-300">
          Periodo
          <select
            className="field mt-1 h-10 py-2"
            value={value.periodo}
            onChange={(event) => {
              const periodo = event.target.value as PresetPeriodo;
              if (periodo === "custom") {
                onChange({
                  ...value,
                  periodo,
                  from: value.from,
                  to: value.to,
                });
                return;
              }
              onChange({
                ...value,
                periodo,
                from: undefined,
                to: undefined,
              });
            }}
          >
            {PERIODO_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-300">
          Vendedor
          <select
            className="field mt-1 h-10 py-2"
            value={value.vendedorId || ""}
            onChange={(event) =>
              onChange({
                ...value,
                vendedorId: event.target.value || undefined,
              })
            }
          >
            <option value="">Todos</option>
            {vendedores.map((vendedor) => (
              <option key={vendedor.id} value={vendedor.id}>
                {vendedor.nome}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-300">
          Data inicial
          <input
            type="date"
            className="field mt-1 h-10 py-2 disabled:cursor-not-allowed disabled:opacity-50"
            value={value.from || ""}
            disabled={!isCustom}
            onChange={(event) =>
              onChange({
                ...value,
                from: event.target.value || undefined,
              })
            }
          />
        </label>

        <label className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-300">
          Data final
          <input
            type="date"
            className="field mt-1 h-10 py-2 disabled:cursor-not-allowed disabled:opacity-50"
            value={value.to || ""}
            disabled={!isCustom}
            onChange={(event) =>
              onChange({
                ...value,
                to: event.target.value || undefined,
              })
            }
          />
        </label>
      </div>

      <p className="mt-2 text-xs text-slate-400">
        {loading ? "Atualizando dados..." : "Filtros ativos no dashboard (periodo e vendedor)."}
      </p>
    </section>
  );
}

