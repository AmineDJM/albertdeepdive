import Link from "next/link";
import { cn } from "@/lib/utils";

const tones = {
  default: "text-foreground",
  brand: "text-brand",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
};

export function Stat({ label, value, hint, tone = "default", href, icon: Icon, className, suffix }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: keyof typeof tones; href?: string; icon?: React.ComponentType<{ className?: string }>; className?: string; suffix?: React.ReactNode }) {
  const body = (
    <div className={cn("flex h-full flex-col justify-between gap-2 rounded-lg border border-border bg-card px-3.5 py-3 shadow-xs transition-colors", href && "hover:border-brand/50 hover:bg-accent/30", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="label-caps">{label}</span>
        {Icon ? <Icon className="size-3.5 text-muted-foreground" /> : null}
      </div>
      <div>
        <div className={cn("tabular text-[22px] leading-none font-semibold tracking-tight", tones[tone])}>
          {value}
          {suffix ? <span className="ml-1 text-sm font-medium text-muted-foreground">{suffix}</span> : null}
        </div>
        {hint ? <div className="mt-1.5 text-xs text-muted-foreground">{hint}</div> : null}
      </div>
    </div>
  );
  return href ? <Link href={href} className="block h-full">{body}</Link> : body;
}

export function StatGrid({ children, className, columns = 4 }: { children: React.ReactNode; className?: string; columns?: 2 | 3 | 4 | 5 | 6 }) {
  const cols = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-2 xl:grid-cols-4", 5: "sm:grid-cols-3 xl:grid-cols-5", 6: "sm:grid-cols-3 xl:grid-cols-6" }[columns];
  return <div className={cn("grid grid-cols-1 gap-3", cols, className)}>{children}</div>;
}

export function ProgressBar({ value, max, className, tone = "brand" }: { value: number; max: number; className?: string; tone?: "brand" | "success" | "warning" | "muted" }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const color = { brand: "bg-brand", success: "bg-success", warning: "bg-warning", muted: "bg-muted-foreground/40" }[tone];
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full transition-[width]", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}
