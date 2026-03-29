"use client";

import { useMemo, useState } from "react";
import {
  AgendaBlocks,
  AgendaBlockType,
  emptyAgendaBlocks,
  PeriodBlock,
  RecurringWeekdayBlock,
  SpecificDateBlock,
  SpecificTimeBlock,
} from "./agenda-types";

type AgendaBlocksModalProps = {
  open: boolean;
  blocks: AgendaBlocks;
  onClose: () => void;
  onChange: (blocks: AgendaBlocks) => void;
};

const weekdayOptions = [
  { value: 0, label: "Domingo" },
  { value: 1, label: "Segunda-feira" },
  { value: 2, label: "Terca-feira" },
  { value: 3, label: "Quarta-feira" },
  { value: 4, label: "Quinta-feira" },
  { value: 5, label: "Sexta-feira" },
  { value: 6, label: "Sabado" },
];

const blockTypeOptions: { value: AgendaBlockType; label: string }[] = [
  { value: "weekday", label: "Dia da Semana (recorrente)" },
  { value: "specific_date", label: "Dia Especifico (unico)" },
  { value: "period", label: "Periodo (intervalo de datas)" },
  { value: "specific_time", label: "Horario Especifico" },
];

function defaultForm() {
  return {
    type: "weekday" as AgendaBlockType,
    weekdays: [] as number[],
    date: "",
    startDate: "",
    endDate: "",
    startTime: "09:00",
    endTime: "10:00",
    reason: "",
  };
}

function formatDate(value: string) {
  if (!value) return "-";
  return new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR");
}

function formatWeekdays(values: number[]) {
  return values
    .slice()
    .sort((a, b) => a - b)
    .map((value) => weekdayOptions.find((option) => option.value === value)?.label || String(value))
    .join(", ");
}

export function AgendaBlocksModal({ open, blocks, onClose, onChange }: AgendaBlocksModalProps) {
  const [form, setForm] = useState(defaultForm());
  const [errors, setErrors] = useState<string[]>([]);
  const [pendingDelete, setPendingDelete] = useState<{
    type: AgendaBlockType;
    id: string;
    category: string;
    lines: string[];
  } | null>(null);

  const counters = useMemo(
    () => ({
      weekday: blocks.recurringWeekdayBlocks.length,
      specificDate: blocks.specificDateBlocks.length,
      period: blocks.periodBlocks.length,
      specificTime: blocks.specificTimeBlocks.length,
    }),
    [blocks],
  );

  if (!open) return null;

  const resetForm = () => {
    setForm(defaultForm());
    setErrors([]);
  };

  const validate = () => {
    const nextErrors: string[] = [];

    if (!form.reason.trim()) nextErrors.push("Motivo e obrigatorio.");
    if (form.type === "weekday" && form.weekdays.length === 0) {
      nextErrors.push("Selecione ao menos um dia da semana.");
    }
    if (form.type === "specific_date" && !form.date) {
      nextErrors.push("Data e obrigatoria.");
    }
    if (form.type === "period") {
      if (!form.startDate || !form.endDate) nextErrors.push("Data inicio e data fim sao obrigatorias.");
      if (form.startDate && form.endDate && form.endDate < form.startDate) {
        nextErrors.push("Data fim deve ser maior ou igual a data inicio.");
      }
    }
    if (form.type === "specific_time") {
      if (!form.date || !form.startTime || !form.endTime) {
        nextErrors.push("Data, hora inicio e hora fim sao obrigatorias.");
      }
      if (form.startTime && form.endTime && form.endTime <= form.startTime) {
        nextErrors.push("Hora fim deve ser maior que hora inicio.");
      }
    }

    setErrors(nextErrors);
    return nextErrors.length === 0;
  };

  const addBlock = () => {
    if (!validate()) return;

    const baseId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const reason = form.reason.trim();
    const next = blocks || emptyAgendaBlocks;

    if (form.type === "weekday") {
      const item: RecurringWeekdayBlock = {
        id: `B-W-${baseId}`,
        type: "weekday",
        weekdays: form.weekdays,
        reason,
      };
      onChange({ ...next, recurringWeekdayBlocks: [...next.recurringWeekdayBlocks, item] });
    }

    if (form.type === "specific_date") {
      const item: SpecificDateBlock = {
        id: `B-D-${baseId}`,
        type: "specific_date",
        date: form.date,
        reason,
      };
      onChange({ ...next, specificDateBlocks: [...next.specificDateBlocks, item] });
    }

    if (form.type === "period") {
      const item: PeriodBlock = {
        id: `B-P-${baseId}`,
        type: "period",
        startDate: form.startDate,
        endDate: form.endDate,
        reason,
      };
      onChange({ ...next, periodBlocks: [...next.periodBlocks, item] });
    }

    if (form.type === "specific_time") {
      const item: SpecificTimeBlock = {
        id: `B-T-${baseId}`,
        type: "specific_time",
        date: form.date,
        startTime: form.startTime,
        endTime: form.endTime,
        reason,
      };
      onChange({ ...next, specificTimeBlocks: [...next.specificTimeBlocks, item] });
    }

    resetForm();
  };

  const removeItem = (type: AgendaBlockType, id: string) => {
    if (type === "weekday") {
      onChange({
        ...blocks,
        recurringWeekdayBlocks: blocks.recurringWeekdayBlocks.filter((item) => item.id !== id),
      });
    }
    if (type === "specific_date") {
      onChange({
        ...blocks,
        specificDateBlocks: blocks.specificDateBlocks.filter((item) => item.id !== id),
      });
    }
    if (type === "period") {
      onChange({
        ...blocks,
        periodBlocks: blocks.periodBlocks.filter((item) => item.id !== id),
      });
    }
    if (type === "specific_time") {
      onChange({
        ...blocks,
        specificTimeBlocks: blocks.specificTimeBlocks.filter((item) => item.id !== id),
      });
    }
    setPendingDelete(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div className="panel w-full max-w-4xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="w-8" />
          <h2 className="text-center text-base font-semibold">Configurar Bloqueios de Agenda</h2>
          <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={onClose} aria-label="Fechar">
            X
          </button>
        </div>

        <div className="max-h-[75vh] overflow-y-auto p-5">
          <section className="space-y-3 rounded-xl border border-border bg-slate-900/40 p-4">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-200">Novo Bloqueio</h3>
            </div>

            <label className="block text-xs uppercase tracking-wide text-muted">
              Tipo de bloqueio
              <select
                className="field mt-1"
                value={form.type}
                onChange={(event) => setForm((prev) => ({ ...prev, type: event.target.value as AgendaBlockType }))}
              >
                {blockTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            {form.type === "weekday" ? (
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wide text-muted">Dias da semana *</p>
                <div className="grid gap-2 md:grid-cols-2">
                  {weekdayOptions.map((option) => (
                    <label key={option.value} className="flex items-center gap-2 text-sm text-slate-200">
                      <input
                        type="checkbox"
                        checked={form.weekdays.includes(option.value)}
                        onChange={(event) => {
                          setForm((prev) => ({
                            ...prev,
                            weekdays: event.target.checked
                              ? [...prev.weekdays, option.value]
                              : prev.weekdays.filter((day) => day !== option.value),
                          }));
                        }}
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            {form.type === "specific_date" ? (
              <label className="block text-xs uppercase tracking-wide text-muted">
                Data *
                <input
                  className="field mt-1"
                  type="date"
                  value={form.date}
                  onChange={(event) => setForm((prev) => ({ ...prev, date: event.target.value }))}
                />
              </label>
            ) : null}

            {form.type === "period" ? (
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block text-xs uppercase tracking-wide text-muted">
                  Data inicio *
                  <input
                    className="field mt-1"
                    type="date"
                    value={form.startDate}
                    onChange={(event) => setForm((prev) => ({ ...prev, startDate: event.target.value }))}
                  />
                </label>
                <label className="block text-xs uppercase tracking-wide text-muted">
                  Data fim *
                  <input
                    className="field mt-1"
                    type="date"
                    value={form.endDate}
                    onChange={(event) => setForm((prev) => ({ ...prev, endDate: event.target.value }))}
                  />
                </label>
              </div>
            ) : null}

            {form.type === "specific_time" ? (
              <div className="grid gap-3 md:grid-cols-3">
                <label className="block text-xs uppercase tracking-wide text-muted">
                  Data *
                  <input
                    className="field mt-1"
                    type="date"
                    value={form.date}
                    onChange={(event) => setForm((prev) => ({ ...prev, date: event.target.value }))}
                  />
                </label>
                <label className="block text-xs uppercase tracking-wide text-muted">
                  Hora inicio *
                  <input
                    className="field mt-1"
                    type="time"
                    value={form.startTime}
                    onChange={(event) => setForm((prev) => ({ ...prev, startTime: event.target.value }))}
                  />
                </label>
                <label className="block text-xs uppercase tracking-wide text-muted">
                  Hora fim *
                  <input
                    className="field mt-1"
                    type="time"
                    value={form.endTime}
                    onChange={(event) => setForm((prev) => ({ ...prev, endTime: event.target.value }))}
                  />
                </label>
              </div>
            ) : null}

            <label className="block text-xs uppercase tracking-wide text-muted">
              Motivo *
              <input
                className="field mt-1"
                placeholder="Ex: Folga, Feriado, Reuniao..."
                value={form.reason}
                onChange={(event) => setForm((prev) => ({ ...prev, reason: event.target.value }))}
              />
              <span className="mt-1 block text-[11px] text-slate-400">Obrigatorio - sera exibido no calendario</span>
            </label>

            {errors.length > 0 ? (
              <div className="rounded-lg border border-rose-400/30 bg-rose-500/10 p-3 text-xs text-rose-200">
                {errors.map((error) => (
                  <p key={error}>{error}</p>
                ))}
              </div>
            ) : null}

            <button type="button" className="btn-primary" onClick={addBlock}>
              Adicionar Bloqueio
            </button>
          </section>

          <div className="mt-5 space-y-4">
            <section className="rounded-xl border border-border bg-slate-900/30 p-3">
              <h4 className="mb-2 text-sm font-semibold text-slate-100">Dias da Semana ({counters.weekday})</h4>
              <div className="space-y-2">
                {blocks.recurringWeekdayBlocks.length === 0 ? (
                  <p className="text-xs text-muted">Nenhum bloqueio recorrente.</p>
                ) : (
                  blocks.recurringWeekdayBlocks.map((item) => (
                    <div key={item.id} className="flex items-start justify-between rounded-lg border border-border p-2">
                      <div className="text-sm">
                        <p className="text-slate-100">{formatWeekdays(item.weekdays)}</p>
                        <p className="text-xs text-slate-400">Motivo: {item.reason}</p>
                      </div>
                      <button
                        type="button"
                        className="btn-ghost px-2 py-1 text-xs"
                        onClick={() =>
                          setPendingDelete({
                            type: "weekday",
                            id: item.id,
                            category: "Dia da Semana (recorrente)",
                            lines: [`Dias: ${formatWeekdays(item.weekdays)}`, `Motivo: ${item.reason}`],
                          })
                        }
                      >
                        Excluir
                      </button>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-xl border border-border bg-slate-900/30 p-3">
              <h4 className="mb-2 text-sm font-semibold text-slate-100">Dias Especificos ({counters.specificDate})</h4>
              <div className="space-y-2">
                {blocks.specificDateBlocks.length === 0 ? (
                  <p className="text-xs text-muted">Nenhum dia especifico bloqueado.</p>
                ) : (
                  blocks.specificDateBlocks.map((item) => (
                    <div key={item.id} className="flex items-start justify-between rounded-lg border border-border p-2">
                      <div className="text-sm">
                        <p className="text-slate-100">{formatDate(item.date)}</p>
                        <p className="text-xs text-slate-400">Motivo: {item.reason}</p>
                      </div>
                      <button
                        type="button"
                        className="btn-ghost px-2 py-1 text-xs"
                        onClick={() =>
                          setPendingDelete({
                            type: "specific_date",
                            id: item.id,
                            category: "Dia Especifico (unico)",
                            lines: [`Data: ${formatDate(item.date)}`, `Motivo: ${item.reason}`],
                          })
                        }
                      >
                        Excluir
                      </button>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-xl border border-border bg-slate-900/30 p-3">
              <h4 className="mb-2 text-sm font-semibold text-slate-100">Periodos ({counters.period})</h4>
              <div className="space-y-2">
                {blocks.periodBlocks.length === 0 ? (
                  <p className="text-xs text-muted">Nenhum periodo bloqueado.</p>
                ) : (
                  blocks.periodBlocks.map((item) => (
                    <div key={item.id} className="flex items-start justify-between rounded-lg border border-border p-2">
                      <div className="text-sm">
                        <p className="text-slate-100">
                          {formatDate(item.startDate)} ate {formatDate(item.endDate)}
                        </p>
                        <p className="text-xs text-slate-400">Motivo: {item.reason}</p>
                      </div>
                      <button
                        type="button"
                        className="btn-ghost px-2 py-1 text-xs"
                        onClick={() =>
                          setPendingDelete({
                            type: "period",
                            id: item.id,
                            category: "Periodo (intervalo de datas)",
                            lines: [
                              `Periodo: ${formatDate(item.startDate)} ate ${formatDate(item.endDate)}`,
                              `Motivo: ${item.reason}`,
                            ],
                          })
                        }
                      >
                        Excluir
                      </button>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-xl border border-border bg-slate-900/30 p-3">
              <h4 className="mb-2 text-sm font-semibold text-slate-100">Horarios Especificos ({counters.specificTime})</h4>
              <div className="space-y-2">
                {blocks.specificTimeBlocks.length === 0 ? (
                  <p className="text-xs text-muted">Nenhum horario especifico bloqueado.</p>
                ) : (
                  blocks.specificTimeBlocks.map((item) => (
                    <div key={item.id} className="flex items-start justify-between rounded-lg border border-border p-2">
                      <div className="text-sm">
                        <p className="text-slate-100">
                          {formatDate(item.date)} das {item.startTime} as {item.endTime}
                        </p>
                        <p className="text-xs text-slate-400">Motivo: {item.reason}</p>
                      </div>
                      <button
                        type="button"
                        className="btn-ghost px-2 py-1 text-xs"
                        onClick={() =>
                          setPendingDelete({
                            type: "specific_time",
                            id: item.id,
                            category: "Horario Especifico",
                            lines: [
                              `Data: ${formatDate(item.date)}`,
                              `Horario: ${item.startTime} as ${item.endTime}`,
                              `Motivo: ${item.reason}`,
                            ],
                          })
                        }
                      >
                        Excluir
                      </button>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </div>

        <div className="border-t border-border px-5 py-3">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>

      {pendingDelete ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-4">
          <div className="panel w-full max-w-md">
            <div className="border-b border-border px-5 py-4">
              <h3 className="text-base font-semibold">Confirmar exclusao</h3>
            </div>
            <div className="space-y-3 px-5 py-4 text-sm text-slate-200">
              <p>Tem certeza que deseja excluir este bloqueio?</p>
              <p>
                <span className="font-semibold text-slate-100">Categoria:</span> {pendingDelete.category}
              </p>
              {pendingDelete.lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
              <button type="button" className="btn-ghost px-3 py-2 text-sm" onClick={() => setPendingDelete(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-rose-500"
                onClick={() => removeItem(pendingDelete.type, pendingDelete.id)}
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
