import { cn } from "@/lib/utils";

/** The Albert mark: a bright blue disc with a navy satellite dot. */
export function AlbertMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-6 shrink-0", className)}>
      <circle cx="18" cy="16" r="12" fill="#2BAFE0" />
      <circle cx="6.5" cy="16.5" r="4" fill="#1B2440" />
    </svg>
  );
}
