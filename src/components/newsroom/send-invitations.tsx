"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Eye, Mail, Send, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { invitationPreviewAction, launchCampaignAction, scheduleInvitationsAction, unscheduleInvitationsAction } from "@/app/(newsroom)/editions/[editionId]/campaign/actions";
import type { InvitationPreview } from "@/server/campaigns/preview";
import { formatZonedLong, zonedParts, zonedTimeToUtc } from "@/lib/campaigns/schedule";
import { intlLocale } from "@/lib/i18n";
import { useLocale, useUi } from "@/components/i18n/provider";

/**
 * The invitation, read before it is sent.
 *
 * Sending is the one thing on this screen that cannot be taken back: a few hundred people read it,
 * and a sentence somebody meant to change is a sentence a few hundred people read. It went out on
 * one click, with nothing shown beforehand but a count.
 *
 * So the button opens the email itself — the real one, built by the same code that sends it — with
 * the subject line and the names of everybody who would receive it. From there it can go now,
 * which takes a second press against the number of people it would reach, or on a date chosen
 * here; and a date chosen here can be moved or dropped for as long as nothing has left.
 */

/** "YYYY-MM-DDTHH:mm" as the newsroom reads the clock, which is what a datetime field holds. */
function toMinuteInput(date: Date): string {
  const p = zonedParts(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

function fromMinuteInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d, h, min] = match;
  return zonedTimeToUtc(Number(y), Number(m), Number(d), Number(h), Number(min), 0);
}

/** Tomorrow morning, which is what somebody who wants to sleep on it almost always means. */
function tomorrowMorning(): Date {
  const p = zonedParts(new Date(Date.now() + 86_400_000));
  return zonedTimeToUtc(p.year, p.month, p.day, 9, 0, 0);
}

type Step = "read" | "confirm" | "schedule";

export function SendInvitations({ editionId, scheduledFor = null, withSendNow = false }: { editionId: string; scheduledFor?: string | null; withSendNow?: boolean }) {
  const tr = useUi();
  const locale = intlLocale(useLocale());
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("read");
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [when, setWhen] = useState("");
  const [loading, startLoad] = useTransition();
  const [working, startWork] = useTransition();

  /*
   * Closing drops the preview as well as the dialog.
   *
   * The button's label reads the date off the preview first and the server's own prop second, and
   * the preview is a copy taken when the dialog opened. Keeping it after a send, a date or a
   * cancellation meant the refreshed page said one thing and the button went on saying the other:
   * "Going out Friday" on an invitation nobody was going to send.
   */
  function close() {
    setOpen(false);
    setStep("read");
    setPreview(null);
  }

  /*
   * Two ways in, and both of them still ask twice.
   *
   * Reading it first is the safe order and the default. But an editor who has just set the date,
   * on the screen where the whole invitation is described, means "send it" when they say it — and
   * making them open a preview they have already read to find the button is a step that teaches
   * them to click through previews. So the card offers it directly, landing on the confirmation
   * against the number of people rather than on the send itself.
   */
  function openDialog(at: Step = "read") {
    setOpen(true);
    setStep(at);
    // Read on opening rather than with the page: the email is built from the brief, the note, the
    // last day and the people currently chosen, every one of which lives on a neighbouring screen.
    startLoad(async () => {
      const result = await invitationPreviewAction(editionId);
      if (!result.ok) {
        toast.error(result.error);
        close();
        return;
      }
      setPreview(result.data);
      setWhen(toMinuteInput(result.data.scheduledFor ? new Date(result.data.scheduledFor) : tomorrowMorning()));
      // Nothing to confirm when there is nobody to write to: the preview says why, so show it.
      if (at === "confirm" && !result.data.canSend) setStep("read");
    });
  }

  function send() {
    startWork(async () => {
      const result = await launchCampaignAction(editionId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      close();
      toast.success(result.message);
      router.refresh();
    });
  }

  function schedule() {
    const at = fromMinuteInput(when);
    if (!at) {
      toast.error(tr("Enter a valid date"));
      return;
    }
    startWork(async () => {
      const result = await scheduleInvitationsAction(editionId, at.toISOString());
      if (!result.ok) {
        toast.error(result.error, { description: result.fieldErrors ? Object.values(result.fieldErrors).flat().join(" · ") : undefined });
        return;
      }
      close();
      toast.success(result.message);
      router.refresh();
    });
  }

  function unschedule() {
    startWork(async () => {
      const result = await unscheduleInvitationsAction(editionId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      close();
      toast.success(result.message);
      router.refresh();
    });
  }

  const booked = preview?.scheduledFor ?? scheduledFor;
  const total = preview?.recipients.total ?? 0;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={booked || withSendNow ? "outline" : "default"} data-testid="send-invitations" onClick={() => openDialog()}>
          {booked ? <CalendarClock /> : <Eye />}{" "}
          {booked ? tr("Going out {date}", { date: formatZonedLong(new Date(booked), undefined, locale) }) : tr("Read the invitation")}
        </Button>
        {withSendNow ? (
          <Button size="sm" data-testid="send-invitations-straight-away" loading={loading && step === "confirm"} onClick={() => openDialog("confirm")}>
            <Send /> {tr("Send it now")}
          </Button>
        ) : null}
      </div>

      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent size="lg" className="max-h-[92vh] overflow-y-auto">
          {step === "confirm" ? (
            <>
              <DialogHeader>
                <DialogTitle>{tr("Send it to {count} people?", { count: total })}</DialogTitle>
                <DialogDescription>{tr("They each get their own link straight away. An email that has gone cannot be called back.")}</DialogDescription>
              </DialogHeader>
              {preview ? (
                <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[13px]">
                  <span className="font-medium">{preview.subject}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{preview.recipients.names.slice(0, 6).join(", ")}{total > 6 ? tr(" and {count} more", { count: total - 6 }) : ""}</span>
                </p>
              ) : null}
              <DialogFooter>
                <Button variant="ghost" onClick={() => setStep("read")} disabled={working}>
                  {tr("Not yet")}
                </Button>
                <Button loading={working} data-testid="confirm-send-invitations" onClick={send}>
                  <Send /> {tr("Yes, send it now")}
                </Button>
              </DialogFooter>
            </>
          ) : step === "schedule" ? (
            <>
              <DialogHeader>
                <DialogTitle>{tr("When should it go out?")}</DialogTitle>
                <DialogDescription>{tr("Briefly sends it on its own at that moment, and moves the two reminders to fit what is left.")}</DialogDescription>
              </DialogHeader>
              <input
                type="datetime-local"
                value={when}
                onChange={(event) => setWhen(event.target.value)}
                data-testid="invitation-schedule-at"
                aria-label={tr("When should it go out?")}
                className="tabular h-9 w-full rounded-md border border-border bg-background px-2 text-[13px] focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              />
              {preview ? <p className="text-xs text-muted-foreground">{tr("The last day is {date}, and the invitation has to go out before it.", { date: formatZonedLong(new Date(preview.deadlineAt), undefined, locale) })}</p> : null}
              <DialogFooter>
                <Button variant="ghost" onClick={() => setStep("read")} disabled={working}>
                  {tr("Back")}
                </Button>
                <Button loading={working} data-testid="confirm-schedule-invitations" onClick={schedule}>
                  <CalendarClock /> {booked ? tr("Move it") : tr("Schedule it")}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{tr("This is what they will get")}</DialogTitle>
                <DialogDescription>
                  {booked ? tr("It goes out on its own on {date}, unless you change it here.", { date: formatZonedLong(new Date(booked), undefined, locale) }) : tr("Nothing has been sent. Read it, then send it now or pick a date.")}
                </DialogDescription>
              </DialogHeader>

              {loading || !preview ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-[320px] w-full" />
                </div>
              ) : (
                <>
                  <dl className="grid gap-2 text-xs sm:grid-cols-2">
                    <div className="min-w-0">
                      <dt className="flex items-center gap-1.5 font-medium text-muted-foreground">
                        <Mail className="size-3.5" aria-hidden="true" /> {tr("Subject")}
                      </dt>
                      <dd className="truncate text-[13px] text-foreground">{preview.subject}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="flex items-center gap-1.5 font-medium text-muted-foreground">
                        <Users className="size-3.5" aria-hidden="true" /> {tr("Who gets it")}
                      </dt>
                      <dd className="text-[13px] text-foreground" data-testid="invitation-recipients">
                        {total === 1 ? tr("1 person") : tr("{count} people", { count: total })}
                        {preview.recipients.names.length ? <span className="block truncate text-2xs text-muted-foreground">{preview.recipients.names.join(", ")}{total > preview.recipients.names.length ? tr(" and {count} more", { count: total - preview.recipients.names.length }) : ""}</span> : null}
                      </dd>
                    </div>
                  </dl>

                  {/*
                   * The email in a box of its own. Sandboxed because it is a rendered document
                   * rather than part of this page, and because the newsroom's own styles would
                   * make it look like something no inbox will show.
                   */}
                  <iframe
                    title={tr("This is what they will get")}
                    srcDoc={preview.html}
                    sandbox=""
                    data-testid="invitation-preview"
                    className="h-[360px] w-full rounded-md border border-border bg-white"
                  />

                  {preview.why ? <p className="text-xs text-warning">{preview.why}</p> : null}

                  <DialogFooter className="sm:justify-between">
                    <div className="flex items-center gap-2">
                      {booked ? (
                        <Button variant="ghost" loading={working} data-testid="cancel-schedule-invitations" onClick={unschedule}>
                          <X /> {tr("Cancel the date")}
                        </Button>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" disabled={!preview.canSend || working} data-testid="schedule-invitations" onClick={() => setStep("schedule")}>
                        <CalendarClock /> {booked ? tr("Change the date") : tr("Pick a date")}
                      </Button>
                      <Button disabled={!preview.canSend || working} data-testid="send-invitations-now" onClick={() => setStep("confirm")}>
                        <Send /> {tr("Send it now")}
                      </Button>
                    </div>
                  </DialogFooter>
                </>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
