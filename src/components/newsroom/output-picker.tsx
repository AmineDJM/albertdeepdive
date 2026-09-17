"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, BookOpen, Check, ExternalLink, Globe, Mail, Printer, Send } from "lucide-react";
import { toast } from "sonner";
import { publishWebEditionAction, sendEditionEmailAction, toggleOutputAction } from "@/app/(newsroom)/editions/[editionId]/output-actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/components/i18n/provider";
import type { OutputFormat } from "@/server/outputs/service";

export type OutputRow = {
  format: OutputFormat;
  label: string;
  description: string;
  enabled: boolean;
  status: string | null;
  detail: string | null;
  locked: boolean;
  /** WEB only: the public address, once it has one. */
  publicUrl: string | null;
};

const ICONS: Record<OutputFormat, typeof Mail> = { EMAIL: Mail, WEB: Globe, MAGAZINE: BookOpen, PRINT: Printer };

/**
 * Where this edition goes.
 *
 * The same editorial work can be an email, a web page, a magazine and a printed copy; this is the
 * one place that decision is made. A format already published is shown fixed rather than hidden,
 * because "we sent this" is part of the edition's record.
 */
export function OutputPicker({ editionId, rows, canEdit, canPublish }: { editionId: string; rows: OutputRow[]; canEdit: boolean; canPublish: boolean }) {
  const router = useRouter();
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<OutputFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(format: OutputFormat, work: () => Promise<{ ok: boolean; error?: string }>, success?: string) {
    setBusy(format);
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) setError(result.error ?? "Something went wrong");
      else if (success) toast.success(success);
      setBusy(null);
      router.refresh();
    });
  }

  function toggle(row: OutputRow) {
    if (!canEdit || row.locked) return;
    run(row.format, () => toggleOutputAction(editionId, row.format, !row.enabled));
  }

  /** The one thing each format still needs a person to decide: send it, or make it public. */
  function action(row: OutputRow) {
    if (!canPublish || !row.enabled || row.status === "PUBLISHED") return null;
    if (row.format === "EMAIL") {
      return (
        <Button
          size="xs"
          variant="outline"
          loading={pending && busy === "EMAIL"}
          onClick={() => {
            run(
              "EMAIL",
              async () => {
                const r = await sendEditionEmailAction(editionId);
                if (r.ok) toast.success(`Sent to ${r.data.sent} reader${r.data.sent === 1 ? "" : "s"}${r.data.failed ? ` · ${r.data.failed} failed` : ""}`);
                return r;
              },
            );
          }}
        >
          <Send /> {t("outputs.send")}
        </Button>
      );
    }
    if (row.format === "WEB") {
      return (
        <Button
          size="xs"
          variant="outline"
          loading={pending && busy === "WEB"}
          onClick={() => {
            run("WEB", () => publishWebEditionAction(editionId, true), "Web edition is live");
          }}
        >
          {t("outputs.publish")}
        </Button>
      );
    }
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        {rows.map((row) => {
          const Icon = ICONS[row.format];
          const interactive = canEdit && !row.locked;
          return (
            // A card, not a button: it holds a link and an action of its own, and a button may not
            // contain either. The toggle is its own control, covering the label.
            <div
              key={row.format}
              className={cn(
                "flex items-start gap-3 rounded-lg border p-3 transition-colors",
                row.enabled ? "border-foreground/25 bg-card shadow-xs" : "border-dashed border-border bg-transparent",
                pending && busy === row.format && "opacity-60",
              )}
            >
              <button
                type="button"
                onClick={() => toggle(row)}
                disabled={!interactive || (pending && busy === row.format)}
                aria-pressed={row.enabled}
                aria-label={`${row.enabled ? "Remove" : "Add"} ${row.label}`}
                className={cn("flex min-w-0 flex-1 items-start gap-3 text-left", interactive ? "cursor-pointer" : "cursor-default")}
              >
                <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md", row.enabled ? "bg-foreground text-background" : "bg-muted text-muted-foreground")}>
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-[13px] font-medium">{t(`outputs.${row.format.toLowerCase()}` as "outputs.email")}</span>
                    {row.enabled ? <Check className="size-3.5 text-emerald-600" /> : null}
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{row.detail ?? row.description}</span>
                </span>
              </button>
              <span className="flex shrink-0 flex-col items-end gap-1">
                {action(row)}
                {row.publicUrl && row.status === "PUBLISHED" ? (
                  <a href={row.publicUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-2xs text-muted-foreground underline-offset-4 hover:underline">
                    {t("outputs.open")} <ExternalLink className="size-2.5" />
                  </a>
                ) : null}
              </span>
            </div>
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
