import type { MouseEventHandler } from "react";

type TruncatedCellTextProps = {
  value?: string | number | null;
  fallback?: string;
  widthClass?: string;
  className?: string;
  title?: string;
};

type TruncatedCellLinkProps = {
  value?: string | null;
  href?: string | null;
  fallback?: string;
  widthClass?: string;
  className?: string;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  target?: string;
  rel?: string;
};

function normalizeCellValue(value?: string | number | null): string {
  return String(value ?? "").trim();
}

function joinClassNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function TruncatedCellText({
  value,
  fallback = "-",
  widthClass = "w-[12rem] max-w-[12rem]",
  className,
  title,
}: TruncatedCellTextProps) {
  const normalized = normalizeCellValue(value);
  const hasValue = normalized.length > 0;
  const display = hasValue ? normalized : fallback;

  return (
    <span
      title={hasValue ? (title || normalized) : undefined}
      className={joinClassNames("block truncate", widthClass, className)}
    >
      {display}
    </span>
  );
}

export function TruncatedCellLink({
  value,
  href,
  fallback = "-",
  widthClass = "w-[14rem] max-w-[14rem]",
  className,
  onClick,
  target = "_blank",
  rel = "noopener noreferrer",
}: TruncatedCellLinkProps) {
  const normalizedValue = normalizeCellValue(value);
  const normalizedHref = normalizeCellValue(href);

  if (!normalizedValue || !normalizedHref) {
    return <TruncatedCellText value="" fallback={fallback} widthClass={widthClass} />;
  }

  return (
    <a
      href={normalizedHref}
      target={target}
      rel={rel}
      onClick={onClick}
      title={normalizedValue}
      className={joinClassNames("block truncate", widthClass, className)}
    >
      {normalizedValue}
    </a>
  );
}
