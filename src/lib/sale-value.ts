export const brlFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function extractCurrencyDigits(value: string): string {
  return String(value || "").replace(/\D/g, "");
}

export function digitsToSaleValueCents(digits: string): number {
  const normalized = extractCurrencyDigits(digits);
  if (!normalized) return 0;
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

export function formatSaleValueCents(cents?: number | null): string {
  const safeCents = Number.isFinite(cents) ? Number(cents) : 0;
  return brlFormatter.format(Math.max(0, safeCents) / 100);
}

export function formatCurrencyFromDigits(digits: string): string {
  return formatSaleValueCents(digitsToSaleValueCents(digits));
}

export function isValidSaleValueCents(value?: number | null): boolean {
  if (!Number.isFinite(value)) return false;
  return Number(value) > 0;
}
