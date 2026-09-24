import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/brand";
import { GOOGLE } from "@/lib/brand/palette";

/**
 * The Briefly logo.
 *
 * A rounded square carrying the four colours of the spectrum — blue, red, yellow, green, one per
 * corner, meeting softly — with a white page lifted off it: the brief. It is a vector drawing
 * (`/brand/briefly-mark.svg`), so it is sharp on any screen at any size; the PNGs next to it are
 * rendered from the same file for the places that need a bitmap (the browser tab, an email).
 *
 * The wordmark is type, not a picture of type: "Briefly" set in the interface's sans, tight and
 * heavy, the way the rest of the product speaks. `mono` is for the one place the colours cannot be
 * used, an inline SVG that must take `currentColor`: the same silhouette in one ink.
 */

export const LOGO = {
  symbol: "/brand/briefly-mark.svg",
  bitmap: "/brand/briefly-symbol.png",
} as const;

export function BrieflyMark({ className, mono = false }: { className?: string; mono?: boolean; gradientId?: string }) {
  if (mono) {
    return (
      <svg viewBox="0 0 100 100" aria-hidden="true" className={cn("size-6 shrink-0", className)}>
        <rect width="100" height="100" rx="23" fill="currentColor" />
        <rect x="27.7" y="27.7" width="44.6" height="44.6" rx="12" fill={BRAND.paper} />
      </svg>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={LOGO.symbol} alt="" aria-hidden="true" draggable={false} className={cn("size-6 shrink-0 select-none", className)} />;
}

/**
 * The symbol drawn inline, for the OG image and anywhere a file cannot be fetched: the four
 * colours as two horizontal sweeps, the upper one fading into the lower.
 */
export function BrieflyTile({ className, gradientId = "briefly-tile" }: { className?: string; gradientId?: string }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" className={cn("size-8 shrink-0", className)}>
      <defs>
        <linearGradient id={`${gradientId}-top`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="28%" stopColor={GOOGLE.blue} />
          <stop offset="72%" stopColor={GOOGLE.red} />
        </linearGradient>
        <linearGradient id={`${gradientId}-bottom`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="28%" stopColor={GOOGLE.green} />
          <stop offset="72%" stopColor={GOOGLE.yellow} />
        </linearGradient>
        <linearGradient id={`${gradientId}-fade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="30%" stopColor="#fff" />
          <stop offset="70%" stopColor="#000" />
        </linearGradient>
        <mask id={`${gradientId}-mask`}>
          <rect width="100" height="100" fill={`url(#${gradientId}-fade)`} />
        </mask>
      </defs>
      <rect width="100" height="100" rx="23" fill={`url(#${gradientId}-bottom)`} />
      <rect width="100" height="100" rx="23" fill={`url(#${gradientId}-top)`} mask={`url(#${gradientId}-mask)`} />
      <rect x="27.7" y="27.7" width="44.6" height="44.6" rx="12" fill={BRAND.paper} />
    </svg>
  );
}

/** Symbol and wordmark together, sized by height. */
export function BrieflyLogo({ className, height = 22 }: { className?: string; height?: number; markClassName?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 select-none items-center font-sans font-semibold tracking-[-0.035em] text-foreground", className)} style={{ gap: Math.round(height * 0.34), fontSize: Math.round(height * 0.92), lineHeight: 1 }} aria-label={BRAND.name} role="img">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={LOGO.symbol} alt="" aria-hidden="true" draggable={false} style={{ width: height, height }} className="shrink-0" />
      <span aria-hidden="true">{BRAND.name}</span>
    </span>
  );
}
