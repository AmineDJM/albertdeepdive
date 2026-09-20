"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsCard } from "@/components/settings/key-value";
import { GuidedFooter } from "@/components/newsroom/guided-footer";
import { SendInvitations } from "@/components/newsroom/send-invitations";
import { saveAudienceAction } from "@/app/(newsroom)/editions/[editionId]/campaign/actions";
import { endOfZonedDay, formatZonedDay, formatZonedLong, planFromDeadline } from "@/lib/campaigns/schedule";
import { intlLocale } from "@/lib/i18n";
import { useLocale, useUi } from "@/components/i18n/provider";

/**
 * One date, and everything Briefly will do around it — moving as you type.
 *
 * The reminders and the day of grace are not decisions; they follow from the last day. They were
 * shown from whatever had last been saved, so changing the date changed nothing on screen until
 * you saved and the page came back: a card that said "4 Nov" under a field that said 20 September,
 * with a line underneath promising it would catch up later. The consequences are computed from the
 * field now, by the same function the server uses to write them, so the screen cannot predict a
 * schedule different from the one it is about to save.
 */
export function DeadlineForm({
  editionId,
  initialDay,
  opensAt,
  unsent,
  invitationSent,
  scheduledFor,
  canManage,
  closed,
  next,
  nextLabel,
  nextHint,
  title,
  back,
  showInvitation,
}: {
  editionId: string;
  initialDay: string;
  /** When the invitation is set to go out, which is what the reminders are measured from. */
  opensAt: string;
  unsent: boolean;
  invitationSent: boolean;
  scheduledFor: string | null;
  canManage: boolean;
  closed: boolean;
  next: string | null;
  nextLabel: string;
  nextHint: string;
  title: string;
  back?: { href: string; label: string } | null;
  showInvitation: boolean;
}) {
  const tr = useUi();
  const locale = intlLocale(useLocale());
  const router = useRouter();
  const [day, setDay] = useState(initialDay);
  const [saving, startSave] = useTransition();
  const [moving, startMove] = useTransition();
  const readOnly = !canManage || closed;
  const dirty = day !== initialDay;

  const deadlineAt = endOfZonedDay(day);
  const plan = deadlineAt ? planFromDeadline({ opensAt, deadlineAt, unsent }) : null;

  async function persist(): Promise<boolean> {
    const result = await saveAudienceAction(editionId, { deadlineAt: deadlineAt?.toISOString() ?? "" });
    if (!result.ok) {
      toast.error(result.error, { description: result.fieldErrors ? Object.values(result.fieldErrors).flat().join(" · ") : undefined });
      return false;
    }
    return true;
  }

  return (
    <div className="space-y-4">
      <SettingsCard title={tr("The last day")} description={tr("Everything Briefly does on its own hangs off this date.")}>
        <Input type="date" value={day} onChange={(event) => setDay(event.target.value)} disabled={readOnly} aria-label={tr("Last day to contribute")} className="tabular h-8 w-48" />
        {plan ? (
          <>
            <dl className="mt-3 grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-3" data-testid="deadline-consequences">
              <div>
                <dt className="font-medium text-foreground">{tr("First reminder")}</dt>
                <dd>{formatZonedDay(plan.reminder1At, locale)}</dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">{tr("Second reminder")}</dt>
                <dd>{formatZonedDay(plan.reminder2At, locale)}</dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">{tr("Late arrivals until")}</dt>
                <dd>{formatZonedDay(plan.graceEndsAt, locale)}</dd>
              </div>
            </dl>
            {plan.movedOpening ? (
              <p className="mt-2 text-2xs text-warning">{tr("That is sooner than the invitation was due to go out, so it goes out as soon as you save.")}</p>
            ) : null}
            {dirty ? <p className="mt-2 text-2xs text-muted-foreground">{tr("Save to keep this.")}</p> : null}
          </>
        ) : (
          <p className="mt-3 text-xs text-warning">
            {tr("That date is too early: the invitation goes out on {date}, and the last day has to come after it.", { date: formatZonedLong(opensAt, undefined, locale) })}
          </p>
        )}
      </SettingsCard>

      {/*
        * The last screen before anything leaves the building.
        *
        * Who, what and by when have all been answered by now, so this is the moment the invitation
        * exists as a real email — and the moment to read it, date it, or send it. It lives inside
        * this form rather than beside it so that the date it names is the date in the field above,
        * not the one saved an hour ago.
        */}
      {showInvitation ? (
        <SettingsCard
          title={tr("The invitation")}
          description={
            scheduledFor
              ? tr("Briefly sends it on its own on {date}. You can read it, move it, or send it now.", { date: formatZonedLong(plan?.movedOpening ? plan.opensAt : scheduledFor, undefined, locale) })
              : tr("Nothing has gone out. Read what Briefly will send, then send it now or pick a date.")
          }
        >
          <SendInvitations editionId={editionId} scheduledFor={scheduledFor} withSendNow />
        </SettingsCard>
      ) : null}

      <GuidedFooter title={title} hint={dirty ? tr("Not saved yet") : nextHint} back={back}>
        <div className="flex items-center gap-2">
          {!readOnly && dirty ? (
            <Button
              variant="outline"
              loading={saving}
              disabled={!plan}
              onClick={() =>
                startSave(async () => {
                  if (await persist()) {
                    toast.success(tr("Saved"));
                    router.refresh();
                  }
                })
              }
            >
              <Save /> {tr("Save")}
            </Button>
          ) : null}
          {next ? (
            <Button
              size="lg"
              loading={moving}
              data-testid="guided-next-button"
              onClick={() =>
                startMove(async () => {
                  if (!readOnly && dirty && !(await persist())) return;
                  router.push(next);
                })
              }
            >
              {nextLabel} <ArrowRight />
            </Button>
          ) : !invitationSent && showInvitation ? (
            // The path ends here until the invitation goes: there is nothing to look at further on.
            <p className="text-xs text-muted-foreground" data-testid="path-waits-for-invitation">
              {tr("The rest of the edition opens once the invitation has gone.")}
            </p>
          ) : null}
        </div>
      </GuidedFooter>
    </div>
  );
}
