import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/brand";
import { GRADIENT } from "@/lib/brand/palette";

/**
 * The Briefly logo, as supplied.
 *
 * A rounded square carrying the brand's gradient with a white inner tile, and the wordmark set in
 * a heavy geometric sans. It is an image, not a drawing of ours: nothing here redesigns it. The
 * symbol goes where space is tight — a sidebar header, a browser tab, an avatar — and the full
 * wordmark where there is room to read it: sign-in, onboarding, the marketing site.
 *
 * `mono` is for the one place the colours cannot be used, an inline SVG that must take
 * `currentColor` (a print masthead, an email in text mode): the same silhouette in one ink.
 */

export const LOGO = {
  symbol: "/brand/briefly-symbol.png",
  wordmark: "/brand/briefly-wordmark.png",
  /** The wordmark's aspect ratio, so a height alone sizes it without a reflow. */
  wordmarkRatio: 1271 / 334,
} as const;

export function BrieflyMark({ className, mono = false }: { className?: string; mono?: boolean; gradientId?: string }) {
  if (mono) {
    return (
      <svg viewBox="0 0 100 100" aria-hidden="true" className={cn("size-6 shrink-0", className)}>
        <rect width="100" height="100" rx="26" fill="currentColor" />
        <rect x="26" y="26" width="48" height="48" rx="13" fill={BRAND.paper} />
      </svg>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={LOGO.symbol} alt="" aria-hidden="true" draggable={false} className={cn("size-6 shrink-0 select-none", className)} />;
}

/**
 * The symbol on a defined edge, for the OG image and anywhere the raster cannot go: the brand's
 * gradient drawn as the logo draws it, top-left indigo to bottom-right pink.
 */
export function BrieflyTile({ className, gradientId = "briefly-tile" }: { className?: string; gradientId?: string }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" className={cn("size-8 shrink-0", className)}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={GRADIENT[0]} />
          <stop offset="50%" stopColor={GRADIENT[1]} />
          <stop offset="100%" stopColor={GRADIENT[2]} />
        </linearGradient>
      </defs>
      <rect width="100" height="100" rx="26" fill={`url(#${gradientId})`} />
      <rect x="26" y="26" width="48" height="48" rx="13" fill={BRAND.paper} />
    </svg>
  );
}

/** Symbol and wordmark together, sized by height. */
export function BrieflyLogo({ className, height = 22 }: { className?: string; height?: number; markClassName?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={LOGO.wordmark} alt={BRAND.name} draggable={false} style={{ height, width: Math.round(height * LOGO.wordmarkRatio) }} className={cn("inline-block shrink-0 select-none", className)} />;
}
