import { cn } from "@/lib/utils";
import type { Hue } from "@/lib/brand/palette";

export type BarPoint = { label: string; value: number; title: string };

/**
 * A row of thin bars in one hue, drawn on the server.
 *
 * One series, so no legend: the caption names it. The tallest bar is the only one labelled — a
 * number on every bar is a table wearing a costume — and every bar answers on hover with its own
 * words. The same figures are in a table for anyone reading without the picture.
 */
export function Bars({ points, hue = "amber", height = 88, label, format = (value) => String(value), className }: { points: BarPoint[]; hue?: Hue; height?: number; label: string; format?: (value: number) => string; className?: string }) {
  const width = 640;
  const padTop = 18;
  const padBottom = 16;
  const padX = 4;
  const gap = 2;
  const n = Math.max(points.length, 1);
  const slot = (width - padX * 2) / n;
  const barWidth = Math.max(2, slot - gap);
  const max = points.reduce((top, point) => Math.max(top, point.value), 0);
  const plotHeight = height - padTop - padBottom;
  const baseline = padTop + plotHeight;
  const peak = max > 0 ? points.findIndex((point) => point.value === max) : -1;
  const ticks = tickIndexes(points.length);

  return (
    <figure className={cn("m-0", className)}>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={label} style={{ "--bar": `var(--${hue})` } as React.CSSProperties}>
        <line x1={padX} x2={width - padX} y1={baseline} y2={baseline} className="stroke-border" strokeWidth={1} />
        {points.map((point, i) => {
          const barHeight = max > 0 ? (point.value > 0 ? Math.max(2, (point.value / max) * plotHeight) : 0) : 0;
          const x = padX + i * slot + gap / 2;
          const y = baseline - barHeight;
          const r = Math.min(4, barWidth / 2, barHeight);
          const path = barHeight > 0 ? `M${x},${baseline} V${y + r} a${r},${r} 0 0 1 ${r},-${r} h${barWidth - 2 * r} a${r},${r} 0 0 1 ${r},${r} V${baseline} Z` : null;
          return (
            <g key={point.label} className="group">
              <title>{point.title}</title>
              <rect x={x - gap / 2} y={padTop} width={slot} height={plotHeight} fill="transparent" />
              {path ? <path d={path} fill="var(--bar)" className="transition-opacity group-hover:opacity-75" /> : null}
            </g>
          );
        })}
        {peak >= 0 ? (
          <text x={padX + peak * slot + slot / 2} y={padTop - 6} textAnchor="middle" fontSize={10} className="fill-muted-foreground tabular">
            {format(max)}
          </text>
        ) : null}
        {ticks.map((i) => (
          <text key={i} x={padX + i * slot + slot / 2} y={height - 4} textAnchor="middle" fontSize={10} className="fill-muted-foreground">
            {points[i]?.label}
          </text>
        ))}
      </svg>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {points.map((point) => (
            <tr key={point.label}>
              <th scope="row">{point.label}</th>
              <td>{format(point.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Which bars get an axis label: all of them up to eight, then every few, always the last. */
function tickIndexes(n: number): number[] {
  if (n <= 0) return [];
  if (n <= 8) return Array.from({ length: n }, (_, i) => i);
  const step = Math.ceil(n / 6);
  const out: number[] = [];
  for (let i = 0; i < n; i += step) out.push(i);
  if (out[out.length - 1] !== n - 1) out.push(n - 1);
  return out;
}
