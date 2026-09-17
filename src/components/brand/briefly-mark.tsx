import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/brand";
import { GRADIENT } from "@/lib/brand/palette";

/**
 * The Briefly mark.
 *
 * A geometric B, and inside it the thing the product makes. The bowls are constructed rather than
 * drawn: each is a rectangle closed by a true semicircle, which is what a B looks like when it comes
 * off a grid. The counters are not the usual wedges but rounded slots of unequal length, so the
 * letter reads at the same time as a B and as two lines of set text — the lower one longer than the
 * upper, the way a paragraph is ragged.
 *
 * One weight throughout, on a 100-unit grid. Cap height 72, bowls 36 each, horizontals 11, stem 15 —
 * horizontals lighter than the stem because that is what keeps a geometric letter from looking
 * bottom-heavy. Every counter sits 11 from the outer edge at its widest, including around the
 * curve, which is the number that makes the thing look drawn by somebody rather than assembled.
 * The two outer stem corners carry a 5-unit radius: square against bowls that round makes the spine
 * look snapped off, and the eye reads the softening long before it can name it.
 *
 * Nothing here is eyeballed, which is why it survives being sixteen pixels wide in a browser tab.
 */

/**
 * The letter, as one path.
 *
 * Even-odd fill, so the two slots knock through to whatever is behind rather than being painted in
 * a colour that has to guess at the background. A mark that only works on white is not a mark.
 */
const LETTER =
  "M23 14 h31 a18 18 0 0 1 0 36 h-36 v-31 a5 5 0 0 1 5-5 z " +
  "M18 50 h46 a18 18 0 0 1 0 36 h-41 a5 5 0 0 1-5-5 z " +
  "M40 25 h14 a7 7 0 0 1 0 14 h-14 a7 7 0 0 1 0-14 z " +
  "M40 61 h24 a7 7 0 0 1 0 14 h-24 a7 7 0 0 1 0-14 z";

function Gradient({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stopColor={GRADIENT[0]} />
      <stop offset="52%" stopColor={GRADIENT[1]} />
      <stop offset="100%" stopColor={GRADIENT[2]} />
    </linearGradient>
  );
}

export function BrieflyMark({ className, mono = false, gradientId = "briefly-mark" }: { className?: string; mono?: boolean; gradientId?: string }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" className={cn("size-6 shrink-0", className)}>
      {mono ? null : (
        <defs>
          <Gradient id={gradientId} />
        </defs>
      )}
      <path fillRule="evenodd" fill={mono ? "currentColor" : `url(#${gradientId})`} d={LETTER} />
    </svg>
  );
}

/**
 * The mark on its own tile, for a favicon, an avatar, or anywhere it needs a defined edge.
 *
 * The same path, placed by transform rather than redrawn at another size — a second set of
 * coordinates is a second thing to keep in step, and it never stays in step.
 */
export function BrieflyTile({ className, gradientId = "briefly-tile" }: { className?: string; gradientId?: string }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" className={cn("size-8 shrink-0", className)}>
      <defs>
        <Gradient id={gradientId} />
      </defs>
      <rect width="100" height="100" rx="24" fill={`url(#${gradientId})`} />
      {/* 0.722 puts the 72-unit cap height at 52 and leaves an equal 26.9 either side. */}
      <g transform="translate(13.9 13.9) scale(0.722)">
        <path fillRule="evenodd" fill={BRAND.paper} d={LETTER} />
      </g>
    </svg>
  );
}

/** Mark plus wordmark, for the sign-in screen, emails and the marketing site. */
export function BrieflyLogo({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <BrieflyMark className={cn("size-6", markClassName)} />
      <span className="text-[17px] font-semibold tracking-[-0.025em] text-foreground">{BRAND.name}</span>
    </span>
  );
}
