"use client";

type PageTopbarProps = {
  title: string;
  addLabel?: string;
  onAdd?: () => void;
  showSearch?: boolean;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  className?: string;
  titleClassName?: string;
  actionsClassName?: string;
  searchClassName?: string;
  addButtonClassName?: string;
};

export function PageTopbar({
  title,
  addLabel,
  onAdd,
  showSearch = true,
  searchValue,
  onSearchChange,
  searchPlaceholder = "Buscar...",
  className,
  titleClassName,
  actionsClassName,
  searchClassName,
  addButtonClassName,
}: PageTopbarProps) {
  return (
    <header className={`mb-6 panel px-5 py-4 ${className || ""}`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h2 className={`text-xl font-semibold tracking-tight ${titleClassName || ""}`}>{title}</h2>
        <div className={`flex flex-wrap items-center gap-2 ${actionsClassName || ""}`}>
          {showSearch ? (
            <div className="relative md:w-80">
              <svg
                viewBox="0 0 20 20"
                fill="none"
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              >
                <path
                  d="M9 3.5a5.5 5.5 0 1 0 3.473 9.764l3.631 3.631 1.06-1.06-3.63-3.632A5.5 5.5 0 0 0 9 3.5Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </svg>
              <input
                className={`field h-10 pl-9 pr-3 text-sm ${searchClassName || ""}`}
                placeholder={searchPlaceholder}
                value={searchValue}
                onChange={(event) => onSearchChange?.(event.target.value)}
              />
            </div>
          ) : null}
          {addLabel ? (
            <button className={`btn-primary h-10 px-4 ${addButtonClassName || ""}`} type="button" onClick={onAdd}>
              {addLabel}
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
