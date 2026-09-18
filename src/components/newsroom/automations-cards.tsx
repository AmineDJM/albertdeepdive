"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CalendarClock, CircleCheck, CirclePause, Mail, Play } from "lucide-react";
import { toast } from "sonner";
import type { AutomationKey } from "@/lib/campaigns/automations";
import { runAutomationAction, runSchedulerTickAction } from "@/app/(newsroom)/automations/actions";
import { GenericStatusBadge } from "@/components/newsroom/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useUi } from "@/components/i18n/provider";

/**
 * Dates are formatted on the server and handed over as strings: a relative time recomputed during
 * hydration drifts by a second or two and breaks the render.
 */
export type AutomationTileView = {
  key: AutomationKey;
  label: string;
  description: string;
  enabled: boolean;
  when: string;
  nextLabel: string | null;
  nextExact: string | null;
  editionId: string | null;
  editionLabel: string | null;
  lastRun: { status: string; ago: string; exact: string; error: string | null; summary: string | null; editionId: string | null; editionLabel: string | null } | null;
};

/** Automations that send real emails when they run — the confirmation says so. */
const SENDS_EMAIL: AutomationKey[] = ["contributionRequest", "reminder1", "reminder2", "gracePeriod", "aiProcessing"];
/** Automations the scheduler only evaluates as part of a full pass. */
const TICK_ONLY: AutomationKey[] = ["editorialAlert", "coverageCheck", "deadlineAlert"];

function AutomationTile({ item, canManage }: { item: AutomationTileView; canManage: boolean }) {
  const tr = useUi();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const last = item.lastRun;

  function run() {
    startTransition(async () => {
      const res = await runAutomationAction(item.key, item.editionId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.data.ran) toast.success(item.label, { description: res.message });
      else toast.success(`${item.label} — nothing to do`, { description: res.message });
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <article className="flex flex-col rounded-lg border border-border bg-card p-3.5 shadow-xs">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[13px] font-semibold">{item.label}</h3>
        {item.enabled ? (
          <Badge variant="success" className="gap-1">
            <CircleCheck className="size-3" /> {" "}{tr("Active")}</Badge>
        ) : (
          <Badge variant="muted" className="gap-1">
            <CirclePause className="size-3" /> {" "}{tr("Paused")}</Badge>
        )}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.description}</p>

      <dl className="mt-3 space-y-1.5 text-2xs">
        <div className="flex items-baseline justify-between gap-2">
          <dt className="shrink-0 text-muted-foreground">{tr("Schedule")}</dt>
          <dd className="truncate text-right font-medium">{item.when}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="shrink-0 text-muted-foreground">{tr("Next run")}</dt>
          <dd className="truncate text-right font-medium">
            {item.nextLabel ? (
              <span title={item.nextExact ?? undefined}>
                {item.nextLabel}
                {item.editionLabel ? <span className="ml-1 text-muted-foreground">· {item.editionLabel}</span> : null}
              </span>
            ) : (
              <span className="text-muted-foreground">{tr("Not scheduled")}</span>
            )}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="shrink-0 text-muted-foreground">{tr("Last run")}</dt>
          <dd className="flex items-center justify-end gap-1.5 text-right">
            {last ? (
              <>
                <GenericStatusBadge status={last.status} />
                <span className="text-muted-foreground" title={last.exact}>
                  {last.ago}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">{tr("Never")}</span>
            )}
          </dd>
        </div>
      </dl>

      {last?.error ? <p className="mt-2 line-clamp-2 rounded-sm bg-destructive/10 px-2 py-1 text-2xs text-destructive">{last.error}</p> : null}
      {last && !last.error && last.summary ? <p className="mt-2 line-clamp-2 text-2xs text-muted-foreground">{last.summary}</p> : null}

      <div className="mt-auto flex items-center gap-2 pt-3">
        {last?.editionId ? (
          <Link href={`/editions/${last.editionId}`} className="text-2xs text-brand hover:underline">
            {last.editionLabel ?? "Edition"}
          </Link>
        ) : null}
        {canManage ? (
          <Button size="xs" variant="outline" className="ml-auto" loading={pending} onClick={() => setOpen(true)}>
            <Play /> {" "}{tr("Run now")}</Button>
        ) : null}
      </div>

      <AlertDialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr("Run “")}{item.label}{tr("” now?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {item.description}{" "}
              {TICK_ONLY.includes(item.key)
                ? "This automation is evaluated by a full scheduler pass, so the pass runs now and every automation that is due executes."
                : "It normally runs on its own schedule; running it now does exactly the same work."}{" "}
              {SENDS_EMAIL.includes(item.key) ? "Emails are sent for real. " : ""}
              {tr("A step that has already succeeded for this edition is skipped rather than repeated.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{tr("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                run();
              }}
            >
              {pending ? "Running…" : "Run now"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}

export function AutomationGrid({ items, canManage }: { items: AutomationTileView[]; canManage: boolean }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
      {items.map((item) => (
        <AutomationTile key={item.key} item={item} canManage={canManage} />
      ))}
    </div>
  );
}

/** Header control: one scheduler pass, the same one the cron endpoint triggers. */
export function RunSchedulerButton() {
  const tr = useUi();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Button size="sm" variant="outline" loading={pending} onClick={() => setOpen(true)}>
        <CalendarClock /> {" "}{tr("Run scheduler")}</Button>
      <AlertDialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr("Run one scheduler pass?")}</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="flex items-start gap-2">
                <Mail className="mt-0.5 size-3.5 shrink-0" />
                {tr("Every automation that is due right now executes, exactly as the cron endpoint would run it — including the emails it sends. Steps that already succeeded are skipped.")}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{tr("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                startTransition(async () => {
                  const res = await runSchedulerTickAction();
                  if (!res.ok) toast.error(res.error);
                  else {
                    toast.success(tr("Scheduler pass finished"), { description: res.message });
                    setOpen(false);
                    router.refresh();
                  }
                });
              }}
            >
              {pending ? "Running…" : "Run pass"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
