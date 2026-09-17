import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/brand";

/**
 * The Briefly mark: a brief — three rules of decreasing length, the top one cut short by the
 * accent. It is drawn rather than set in a typeface so it stays sharp at 16px in a browser tab and
 * at 200px on the landing page, and so it needs no font to load before it can be painted.
 */
export function BrieflyMark({ className, mono = false }: { className?: string; mono?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-6 shrink-0", className)}>
      <rect width="32" height="32" rx="8" fill={mono ? "currentColor" : BRAND.ink} />
      <rect x="8" y="10" width="10" height="2.6" rx="1.3" fill={mono ? "var(--background)" : BRAND.accent} />
      <rect x="8" y="15" width="16" height="2.6" rx="1.3" fill={mono ? "var(--background)" : BRAND.paper} />
      <rect x="8" y="20" width="13" height="2.6" rx="1.3" fill={mono ? "var(--background)" : BRAND.paper} opacity="0.55" />
    </svg>
  );
}

/** Mark plus wordmark, for the sign-in screen, emails and the marketing site. */
export function BrieflyLogo({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <BrieflyMark className={cn("size-6", markClassName)} />
      <span className="text-[17px] font-semibold tracking-[-0.02em] text-foreground">{BRAND.name}</span>
    </span>
  );
}
