"use client";

import { BarChartCard, type ChartDatum } from "@/components/analytics/charts";

/**
 * `BarChartCard` takes a formatter function, which a server component cannot pass across the RSC
 * boundary. This wrapper takes the name of a formatter instead and builds it on the client.
 */
const FORMATTERS = {
  percent: (v: number) => `${v}%`,
  /** Values are stored in cents; the axis and the labels read in euros. */
  currencyFromCents: (v: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(v / 100),
  hours: (v: number) => (v < 1 ? `${Math.round(v * 60)}m` : `${Math.round(v)}h`),
} as const;

export type ValueFormat = keyof typeof FORMATTERS;

export function FormattedBarCard({ format, ...props }: Omit<React.ComponentProps<typeof BarChartCard>, "format"> & { format: ValueFormat; data: ChartDatum[] }) {
  return <BarChartCard {...props} format={FORMATTERS[format]} />;
}
