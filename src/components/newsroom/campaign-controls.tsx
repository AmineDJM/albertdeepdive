"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, CalendarPlus, Check, ChevronDown, Lock, Send, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  applyCampaignDefaultsAction,
  closeCampaignAction,
  extendCampaignAction,
  launchCampaignAction,
  reopenCampaignAction,
  sendReminderAction,
} from "@/app/(newsroom)/editions/[editionId]/campaign/actions";
import { toLocalInput } from "./campaign-config-form";
import { CAMPAIGN_TIMEZONE, zonedTimeToUtc } from "@/lib/campaigns/schedule";

type ReminderKind = "REMINDER_1" | "REMINDER_2" | "GRACE_PERIOD";

const REMINDERS: { kind: ReminderKind; label: string; hint: string }[] = [
  { kind: "REMINDER_1", label: "Reminder #1", hint: "Friendly nudge, days left" },
  { kind: "REMINDER_2", label: "Reminder #2", hint: "Last day to contribute" },
  { kind: "GRACE_PERIOD", label: "Last call", hint: "Grace period — final hours" },
];

function fromLocalInput(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return "";
  const [, y, m, d, hh, mm] = match;
  return zonedTimeToUtc(Number(y), Number(m), Number(d), Number(hh), Number(mm), 0, CAMPAIGN_TIMEZONE).toISOString();
}

function inTwoDays(): string {
  return toLocalInput(new Date(Date.now() + 2 * 86_400_000).toISOString());
}

/** Creates the campaign of an edition that has none, from the monthly system defaults. */
export function CreateCampaignButton({ editionId }: { editionId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      loading={pending}
      onClick={() =>
        start(async () => {
          const res = await applyCampaignDefaultsAction(editionId);
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          toast.success(res.message);
          router.refresh();
        })
      }
    >
      <CalendarPlus /> Schedule the campaign
    </Button>
  );
}

export function CampaignControls({
  editionId,
  status,
  selectionCount,
  invited,
  silent,
  graceEndsAt,
  sentSteps,
}: {
  editionId: string;
  status: "DRAFT" | "SCHEDULED" | "OPEN" | "REMINDER_1" | "REMINDER_2" | "GRACE_PERIOD" | "CLOSED";
  /** How many contributors the selection would invite right now. */
  selectionCount: number;
  invited: number;
  silent: number;
  graceEndsAt: string;
  /** Automation steps that already succeeded for this edition. */
  sentSteps: string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState<"launch" | "close" | null>(null);
  const [dateDialog, setDateDialog] = useState<"extend" | "reopen" | null>(null);
  const [dateValue, setDateValue] = useState(() => toLocalInput(graceEndsAt));

  const notStarted = status === "DRAFT" || status === "SCHEDULED";
  const closed = status === "CLOSED";

  function run(fn: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>, onDone?: () => void) {
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(res.message ?? "Done");
        onDone?.();
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function openDateDialog(mode: "extend" | "reopen") {
    setDateValue(mode === "reopen" ? inTwoDays() : toLocalInput(graceEndsAt));
    setDateDialog(mode);
  }

  return (
    <>
      {notStarted ? (
        <Button size="sm" loading={pending} onClick={() => setConfirm("launch")}>
          <Send /> Launch campaign
        </Button>
      ) : null}

      {!notStarted && !closed ? (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" loading={pending}>
                <Bell /> Send a reminder <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>{silent} contributor{silent === 1 ? "" : "s"} still silent</DropdownMenuLabel>
              {REMINDERS.map((r) => {
                const done = sentSteps.includes(r.kind);
                return (
                  <DropdownMenuItem key={r.kind} onSelect={() => run(() => sendReminderAction(editionId, r.kind))}>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-center gap-1.5 font-medium">
                        {r.label}
                        {done ? <Check className="size-3 text-success" /> : null}
                      </span>
                      <span className="text-2xs text-muted-foreground">{done ? "Already sent — sending again is skipped" : r.hint}</span>
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="outline" onClick={() => openDateDialog("extend")} disabled={pending}>
            <CalendarPlus /> Extend
          </Button>
          <Button size="sm" variant="outline" onClick={() => setConfirm("close")} loading={pending}>
            <Lock /> Close
          </Button>
        </>
      ) : null}

      {closed ? (
        <Button size="sm" variant="outline" onClick={() => openDateDialog("reopen")} disabled={pending}>
          <Undo2 /> Reopen
        </Button>
      ) : null}

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && !pending && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "launch" ? "Launch the contribution campaign?" : "Close the campaign?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "launch"
                ? `${selectionCount} contributor${selectionCount === 1 ? "" : "s"} will receive a personal contribution link by email, and the edition moves to collecting. Contributors already invited are not emailed twice.`
                : `Contributors can no longer submit. Everyone who contributed gets a thank-you email${invited ? `, and the ${silent} silent contributor${silent === 1 ? " is" : "s are"} left out` : ""}. You can reopen the campaign afterwards.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                const mode = confirm;
                run(() => (mode === "launch" ? launchCampaignAction(editionId) : closeCampaignAction(editionId)), () => setConfirm(null));
              }}
            >
              {pending ? "Working…" : confirm === "launch" ? "Launch and send invitations" : "Close the campaign"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={dateDialog !== null} onOpenChange={(o) => !o && !pending && setDateDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dateDialog === "reopen" ? "Reopen the campaign" : "Extend the grace period"}</DialogTitle>
            <DialogDescription>
              {dateDialog === "reopen"
                ? "Late contributors can submit again until the new closing date. Personal links are renewed."
                : "Contributors keep their personal link; the new closing date must be after the deadline."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="campaign-new-date" className="text-xs">
              Closes on ({CAMPAIGN_TIMEZONE.replace("_", " ")})
            </Label>
            <Input id="campaign-new-date" type="datetime-local" value={dateValue} onChange={(e) => setDateValue(e.target.value)} className="tabular" />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDateDialog(null)} disabled={pending}>
              Cancel
            </Button>
            <Button
              size="sm"
              loading={pending}
              onClick={() => {
                const iso = fromLocalInput(dateValue);
                if (!iso) {
                  toast.error("Enter a valid date");
                  return;
                }
                const mode = dateDialog;
                run(() => (mode === "reopen" ? reopenCampaignAction(editionId, iso) : extendCampaignAction(editionId, iso)), () => setDateDialog(null));
              }}
            >
              {dateDialog === "reopen" ? "Reopen" : "Extend"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
