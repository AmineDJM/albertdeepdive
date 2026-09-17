"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, BookOpen, Check, Globe, Mail, Printer } from "lucide-react";
import { toggleOutputAction } from "@/app/(newsroom)/editions/[editionId]/output-actions";
import { cn } from "@/lib/utils";
import type { OutputFormat } from "@/server/outputs/service";

export type OutputRow = {
  format: OutputFormat;
  label: string;
  description: string;
  enabled: boolean;
  status: string | null;
  detail: string | null;
  locked: boolean;
};

const ICONS: Record<OutputFormat, typeof Mail> = { EMAIL: Mail, WEB: Globe, MAGAZINE: BookOpen, PRINT: Printer };

/**
 * Where this edition goes.
 *
 * The same editorial work can be an email, a web page, a magazine and a printed copy; this is the
 * one place that decision is made. A format already published is shown fixed rather than hidden,
 * because "we sent this" is part of the edition's record.
 */
export function OutputPicker({ editionId, rows, canEdit }: { editionId: string; rows: OutputRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<OutputFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle(row: OutputRow) {
    if (!canEdit || row.locked) return;
    setBusy(row.format);
    setError(null);
    startTransition(async () => {
      const result = await toggleOutputAction(editionId, row.format, !row.enabled);
      if (!result.ok) setError(result.error);
      setBusy(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        {rows.map((row) => {
          const Icon = ICONS[row.format];
          return (
            <button
              key={row.format}
              type="button"
              onClick={() => toggle(row)}
              disabled={!canEdit || row.locked || (pending && busy === row.format)}
              aria-pressed={row.enabled}
              className={cn(
                "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                row.enabled ? "border-foreground/25 bg-card shadow-xs" : "border-dashed border-border bg-transparent hover:bg-muted/40",
                (!canEdit || row.locked) && "cursor-default",
                pending && busy === row.format && "opacity-60",
              )}
            >
              <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md", row.enabled ? "bg-foreground text-background" : "bg-muted text-muted-foreground")}>
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="text-[13px] font-medium">{row.label}</span>
                  {row.enabled ? <Check className="size-3.5 text-emerald-600" /> : null}
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{row.detail ?? row.description}</span>
              </span>
            </button>
          );
        })}
      </div>
      {error ? (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
