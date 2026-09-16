import Link from "next/link";
import { Check, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

export type PhaseState = "done" | "active" | "todo" | "blocked";
export type PhaseItem = { key: string; label: string; detail?: React.ReactNode; state: PhaseState; href?: string; progress?: { value: number; max: number } };

export function PhaseTimeline({ phases, className }: { phases: PhaseItem[]; className?: string }) {
  return (
    <ol className={cn("grid gap-2", `grid-cols-${Math.min(phases.length, 7)}`, className)} style={{ gridTemplateColumns: `repeat(${phases.length}, minmax(0, 1fr))` }}>
      {phases.map((p, i) => {
        const body = (
          <div className={cn("group relative flex h-full flex-col gap-1.5 rounded-md border px-3 py-2.5 transition-colors", p.state === "active" && "border-brand bg-brand-soft/40", p.state === "done" && "border-border bg-card", p.state === "todo" && "border-dashed border-border bg-transparent", p.state === "blocked" && "border-destructive/40 bg-destructive/5", p.href && "hover:border-brand/60")}>
            <div className="flex items-center gap-2">
              <span className={cn("flex size-4.5 items-center justify-center rounded-full text-[10px] font-semibold", p.state === "done" && "bg-success text-white", p.state === "active" && "bg-brand text-brand-foreground", p.state === "todo" && "bg-muted text-muted-foreground", p.state === "blocked" && "bg-destructive text-white")}>
                {p.state === "done" ? <Check className="size-3" /> : p.state === "blocked" ? <Lock className="size-2.5" /> : i + 1}
              </span>
              <span className={cn("text-2xs font-semibold uppercase tracking-[0.08em]", p.state === "todo" ? "text-muted-foreground" : "text-foreground")}>{p.label}</span>
            </div>
            {p.detail ? <div className="text-xs leading-4 text-muted-foreground">{p.detail}</div> : null}
            {p.progress ? (
              <div className="mt-auto h-1 w-full overflow-hidden rounded-full bg-muted">
                <div className={cn("h-full rounded-full", p.state === "done" ? "bg-success" : "bg-brand")} style={{ width: `${p.progress.max ? Math.min(100, Math.round((p.progress.value / p.progress.max) * 100)) : 0}%` }} />
              </div>
            ) : null}
          </div>
        );
        return <li key={p.key}>{p.href ? <Link href={p.href} className="block h-full">{body}</Link> : body}</li>;
      })}
    </ol>
  );
}
