"use client";

import { AgendaDisplayMode, AgendaPeriodMode } from "./agenda-types";

type AgendaFiltersProps = {
  displayMode: AgendaDisplayMode;
  onDisplayModeChange: (mode: AgendaDisplayMode) => void;
  periodMode: AgendaPeriodMode;
  onPeriodModeChange: (mode: AgendaPeriodMode) => void;
};

const displayOptions: { value: AgendaDisplayMode; label: string }[] = [
  { value: "calendario", label: "Calendario" },
  { value: "lista", label: "Lista" },
  { value: "todos", label: "Todos" },
];

const periodOptions: { value: AgendaPeriodMode; label: string }[] = [
  { value: "dia", label: "Dia" },
  { value: "semana", label: "Semana" },
  { value: "quinzena", label: "Quinzena" },
  { value: "mes", label: "Mes" },
];

function ToggleGroup<T extends string>({
  options,
  active,
  onChange,
}: {
  options: { value: T; label: string }[];
  active: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            active === option.value
              ? "bg-slate-900 text-white shadow-sm"
              : "text-slate-600 hover:bg-white hover:text-slate-900"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function AgendaFilters({
  displayMode,
  onDisplayModeChange,
  periodMode,
  onPeriodModeChange,
}: AgendaFiltersProps) {
  return (
    <div className="flex flex-wrap items-start gap-3">
      <div className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Visualizacao</p>
        <ToggleGroup options={displayOptions} active={displayMode} onChange={onDisplayModeChange} />
      </div>
      <div className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Periodo</p>
        <ToggleGroup options={periodOptions} active={periodMode} onChange={onPeriodModeChange} />
      </div>
    </div>
  );
}
