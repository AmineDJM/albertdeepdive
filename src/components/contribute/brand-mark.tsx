import { cn } from "@/lib/utils";

/** The public pages' mark: a bright blue disc with a navy satellite dot (CSS only). */
export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span aria-hidden className={cn("relative inline-block shrink-0", className)} style={{ width: size, height: size }}>
      <span className="absolute inset-0 rounded-full bg-brand" />
      <span
        className="absolute rounded-full bg-primary"
        style={{ width: Math.round(size * 0.36), height: Math.round(size * 0.36), left: -Math.round(size * 0.16), top: Math.round(size * 0.32) }}
      />
    </span>
  );
}
