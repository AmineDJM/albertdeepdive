"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUi } from "@/components/i18n/provider";
import type { StepState } from "@/lib/editorial/edition-steps";

/**
 * Where an edition is, and what the whole way through looks like.
 *
 * Five steps, always the same five, always in the same order — so somebody who has made one
 * edition knows where they are in their sixth without reading anything. The step you are on is the
 * only one that is loud; the ones behind are quietly ticked, and the ones ahead are legible but
 * plainly not yet.
 *
 * Every step stays clickable, including the ones ahead. This is a progression, not a wizard: an
 * editor who wants to look at the draft before the topics are settled is allowed to, and a
 * interface that greys out the future to enforce an order it does not actually enforce is lying.
 */
export function EditionTimeline({ editionId, steps, compact = false }: { editionId: string; steps: StepState[]; compact?: boolean }) {
  const tr = useUi();
  return (
    <ol className={cn("flex items-stretch gap-1", compact ? "text-2xs" : "text-xs")} aria-label={tr("Where this edition is")}>
      {steps.map((step, index) => {
        const done = step.state === "done";
        const current = step.state === "current";
        return (
          <li key={step.key} className="flex min-w-0 flex-1 items-stretch">
            <Link
              href={`/editions/${editionId}/${step.room}`}
              aria-current={current ? "step" : undefined}
              title={tr(step.purpose)}
              className={cn(
                "group flex min-w-0 flex-1 flex-col gap-1 rounded-md border px-2.5 transition-colors",
                compact ? "py-1.5" : "py-2",
                current
                  ? "border-brand bg-brand-soft text-brand-foreground"
                  : done
                    ? "border-border bg-card text-muted-foreground hover:text-foreground"
                    : "border-dashed border-border bg-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              <span className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold tabular",
                    current ? "bg-brand text-white" : done ? "bg-success text-white" : "border border-border text-muted-foreground",
                  )}
                >
                  {done ? <Check className="size-2.5" /> : index + 1}
                </span>
                <span className={cn("truncate font-medium", current && "text-brand-foreground")}>{tr(step.label)}</span>
              </span>
              {!compact && current ? <span className="truncate text-2xs opacity-80">{tr(step.active)}</span> : null}
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
