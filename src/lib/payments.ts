/**
 * What a paid title costs, in words a reader and a publisher both understand.
 *
 * Shared by the server, which stores prices in minor units, and the browser, which shows them.
 * The currencies are the ones Briefly's customers sell in; Stripe would take a hundred more, and
 * a menu of a hundred currencies is how somebody picks the wrong one.
 */
export const PRICE_CURRENCIES = ["eur", "usd", "gbp", "chf"] as const;
export type PriceCurrency = (typeof PRICE_CURRENCIES)[number];

export const PRICE_INTERVALS = ["month", "year"] as const;
export type PriceInterval = (typeof PRICE_INTERVALS)[number];

export const CURRENCY_SYMBOLS: Record<PriceCurrency, string> = { eur: "€", usd: "$", gbp: "£", chf: "CHF" };

export function formatPrice(cents: number, currency: string, locale: string = "en"): string {
  const code = currency.toUpperCase();
  try {
    return new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-GB", { style: "currency", currency: code, minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${code}`;
  }
}

/** "€5 per month", in the reader's language. */
export function describePrice(cents: number, currency: string, interval: string, locale: string = "en"): string {
  const price = formatPrice(cents, currency, locale);
  if (locale === "fr") return `${price} par ${interval === "year" ? "an" : "mois"}`;
  return `${price} per ${interval === "year" ? "year" : "month"}`;
}

/** "5" or "4.50" → 450. Accepts a comma, because half the customers type one. */
export function parseAmountToCents(raw: string): number | null {
  const cleaned = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}
