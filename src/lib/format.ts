/** Money and sizes, said the same way on every console screen. */

export function formatCents(cents: number, currency = "EUR", locale = "en-GB"): string {
  const whole = Math.abs(cents) % 100 === 0;
  return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: whole ? 0 : 2 }).format(cents / 100);
}

/** Fractions of a cent are real on an AI bill; below one cent the figure says so rather than "€0". */
export function formatSpend(cents: number, currency = "EUR", locale = "en-GB"): string {
  if (cents !== 0 && Math.abs(cents) < 1) return `< ${new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 2 }).format(0.01)}`;
  return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 2 }).format(cents / 100);
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const power = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** power;
  return `${value >= 10 || power === 0 ? Math.round(value) : value.toFixed(1)} ${units[power]}`;
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(tokens);
}
