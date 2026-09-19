"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, BookOpen, Check, ExternalLink, Globe, Mail, Printer, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import { publishWebEditionAction, republishEditionAction, resendEditionEmailAction, sendEditionEmailAction, toggleOutputAction } from "@/app/(newsroom)/editions/[editionId]/output-actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslations, useUi } from "@/components/i18n/provider";
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
  const tr = useUi();
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

  /*
   * What is left to do once something has gone out.
   *
   * An issue that has been published and then corrected had nowhere to go: the send refused a
   * second time and the PDF stayed the one from before. So there are two controls, and they are
   * deliberately not the same button. Republish remakes the frozen files and touches nobody's
   * inbox; sending again is a second message to every reader, so it says how many and asks.
   */
  function afterPublishing(row: OutputRow) {
    if (!canPublish || !row.enabled || row.status !== "PUBLISHED") return null;
    if (row.format !== "EMAIL") return null;
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="xs" variant="ghost" loading={pending && busy === "EMAIL"}>
            <Send /> {tr("Send again")}</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr("Send this issue again?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {tr("Everybody who received it will get a second message, with the issue as it reads now. There is no way to take an email back.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                run("EMAIL", async () => {
                  const result = await resendEditionEmailAction(editionId);
                  if (result.ok) toast.success(tr("Sent again to {n} reader(s)", { n: result.data.sent }));
                  return result;
                })
              }
            >
              {tr("Send again")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  const published = rows.some((row) => row.enabled && row.status === "PUBLISHED");

  return (
    <div className="space-y-2">
      {published && canPublish ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border px-3 py-2">
          <p className="text-2xs text-muted-foreground">
            {tr("Corrected this issue after it went out? Republish remakes the PDF and the print files from the issue as it reads now. It emails nobody.")}
          </p>
          <Button
            size="xs"
            variant="outline"
            loading={pending && busy === "MAGAZINE"}
            onClick={() =>
              run("MAGAZINE", async () => {
                const result = await republishEditionAction(editionId);
                if (result.ok) toast.success(result.data.filter((line) => line.done).map((line) => `${rows.find((row) => row.format === line.format)?.label ?? line.format}: ${line.detail}`).join(" ") || tr("Nothing needed remaking."));
                return result;
              })
            }
          >
            <RefreshCw /> {tr("Republish")}</Button>
        </div>
      ) : null}
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
                {afterPublishing(row)}
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
