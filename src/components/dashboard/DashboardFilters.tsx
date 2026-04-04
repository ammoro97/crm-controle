"use client";

import type { DashboardFilters as DashboardFiltersValue } from "@/types/dashboard";

export type DashboardVendedorOption = {
  id: string;
  nome: string;
};

type DashboardFiltersProps = {
  value: DashboardFiltersValue;
  vendedores: DashboardVendedorOption[];
  disabled?: boolean;
  onChange: (next: DashboardFiltersValue) => void;
};

export function DashboardFilters({ value, vendedores, disabled = false, onChange }: DashboardFiltersProps) {
  return (
    <section className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-4">
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-300">
          Data inicial
          <input
            type="date"
            className="field mt-1 h-10 py-2"
            value={value.from}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                ...value,
                from: event.target.value,
              })
            }
          />
        </label>

        <label className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-300">
          Data final
          <input
            type="date"
            className="field mt-1 h-10 py-2"
            value={value.to}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                ...value,
                to: event.target.value,
              })
            }
          />
        </label>

        <label className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-300">
          Vendedor
          <select
            className="field mt-1 h-10 py-2"
            value={value.vendedorId || ""}
            disabled={disabled}
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
      </div>
    </section>
  );
}

