"use client";

import { useId, useState } from "react";

type AgendaPeriodNavigatorProps = {
  label: string;
  onPrevious: () => void;
  onNext: () => void;
  disablePrevious?: boolean;
  monthOptions?: { label: string; monthIndex: number; year: number }[];
  onSelectMonth?: (monthIndex: number, year: number) => void;
};

export function AgendaPeriodNavigator({
  label,
  onPrevious,
  onNext,
  disablePrevious = false,
  monthOptions = [],
  onSelectMonth,
}: AgendaPeriodNavigatorProps) {
  const [openMonths, setOpenMonths] = useState(false);
  const hasMonthOptions = monthOptions.length > 0 && onSelectMonth;
  const monthMenuId = useId();

  return (
    <div className="relative flex items-center gap-2 rounded-xl border border-slate-200 bg-white/95 px-2 py-1.5 shadow-sm">
      <button
        type="button"
        onClick={onPrevious}
        disabled={disablePrevious}
        className="rounded-lg px-2 py-1 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        aria-label="Periodo anterior"
      >
        {"<-"}
      </button>
      <button
        type="button"
        onClick={() => (hasMonthOptions ? setOpenMonths((prev) => !prev) : null)}
        className={`min-w-52 rounded-lg px-2 py-1 text-center text-sm font-semibold text-slate-800 ${
          hasMonthOptions ? "transition hover:bg-slate-100" : ""
        }`}
        aria-haspopup={hasMonthOptions ? "listbox" : undefined}
        aria-expanded={hasMonthOptions ? openMonths : undefined}
        aria-controls={hasMonthOptions ? monthMenuId : undefined}
      >
        {label}
      </button>
      <button
        type="button"
        onClick={onNext}
        className="rounded-lg px-2 py-1 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
        aria-label="Proximo periodo"
      >
        {"->"}
      </button>

      {hasMonthOptions && openMonths ? (
        <div
          id={monthMenuId}
          role="listbox"
          className="absolute right-0 top-[calc(100%+8px)] z-20 max-h-72 w-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
        >
          {monthOptions.map((option) => (
            <button
              key={`${option.year}-${option.monthIndex}`}
              type="button"
              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100"
              onClick={() => {
                onSelectMonth?.(option.monthIndex, option.year);
                setOpenMonths(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
