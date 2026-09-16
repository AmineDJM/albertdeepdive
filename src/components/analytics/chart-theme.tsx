/**
 * Chart roles mapped to the app's chart tokens.
 *
 * Light mode uses the tokens as they are: --chart-1 (Albert blue) › --chart-3 (amber) › --chart-6
 * (violet). This order passes the adjacent CVD and normal-vision gates of the dataviz validator on
 * the card surface (#ffffff). Blue and amber sit below 3:1 contrast on white, so every chart ships
 * direct value labels and a table view (the relief rule). Dark mode uses the same three hues
 * re-stepped into the dark lightness band (validated on the dark card surface) — a dark theme is
 * selected, not flipped.
 */
const THEME_CSS = `
.viz-root{--series-1:var(--chart-1);--series-2:var(--chart-3);--series-3:var(--chart-6);--viz-surface:var(--card);--viz-grid:color-mix(in oklch,var(--foreground) 9%,transparent);--viz-axis:color-mix(in oklch,var(--foreground) 22%,transparent);--viz-text:var(--foreground);--viz-muted:var(--muted-foreground);--viz-hover:color-mix(in oklch,var(--foreground) 6%,transparent)}
.dark .viz-root{--series-1:oklch(0.65 0.14 225);--series-2:oklch(0.63 0.15 70);--series-3:oklch(0.6 0.15 300)}
`;

/** Renders the (deduplicated) chart theme once per page. */
export function ChartTheme() {
  return (
    <style href="albert-viz-theme" precedence="default">
      {THEME_CSS}
    </style>
  );
}
