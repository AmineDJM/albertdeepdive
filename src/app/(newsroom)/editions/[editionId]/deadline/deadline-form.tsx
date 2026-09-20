"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsCard } from "@/components/settings/key-value";
import { GuidedFooter } from "@/components/newsroom/guided-footer";
import { saveAudienceAction } from "@/app/(newsroom)/editions/[editionId]/campaign/actions";
import { endOfZonedDay } from "@/lib/campaigns/schedule";
import { formatDate } from "@/lib/utils";
import { useUi } from "@/components/i18n/provider";

/**
 * One date, and everything Briefly will do around it.
 *
 * The reminders and the day of grace are not decisions — they follow from the last day — so they
 * are shown rather than asked. Seeing them move when the date moves is what makes the single field
 * believable: an editor who cannot see the consequence of a date tends to set it and check twice.
 */
export function DeadlineForm({
  editionId,
  initialDay,
  reminders,
  graceEndsAt,
  canManage,
  closed,
  next,
  nextLabel,
  nextHint,
  title,
  back,
  invitation,
}: {
  editionId: string;
  initialDay: string;
  reminders: string[];
  graceEndsAt: string;
  canManage: boolean;
  closed: boolean;
  next: string | null;
  nextLabel: string;
  nextHint: string;
  title: string;
  back?: { href: string; label: string } | null;
  /** The invitation card: reading, sending and dating it all happen here, on the last screen before it goes. */
  invitation?: React.ReactNode;
}) {
  const tr = useUi();
  const router = useRouter();
  const [day, setDay] = useState(initialDay);
  const [saving, startSave] = useTransition();
  const [moving, startMove] = useTransition();
  const readOnly = !canManage || closed;
  const dirty = day !== initialDay;

  async function persist(): Promise<boolean> {
    const result = await saveAudienceAction(editionId, { deadlineAt: endOfZonedDay(day)?.toISOString() ?? "" });
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
        <dl className="mt-3 grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-3">
          <div>
            <dt className="font-medium text-foreground">{tr("First reminder")}</dt>
            <dd>{formatDate(new Date(reminders[0]))}</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">{tr("Second reminder")}</dt>
            <dd>{formatDate(new Date(reminders[1]))}</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">{tr("Late arrivals until")}</dt>
            <dd>{formatDate(new Date(graceEndsAt))}</dd>
          </div>
        </dl>
        {dirty ? <p className="mt-2 text-2xs text-muted-foreground">{tr("Briefly moves the reminders with the date once you save.")}</p> : null}
      </SettingsCard>

      {invitation}

      <GuidedFooter title={title} hint={dirty ? tr("Not saved yet") : nextHint} back={back}>
        <div className="flex items-center gap-2">
          {!readOnly && dirty ? (
            <Button
              variant="outline"
              loading={saving}
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
          ) : null}
        </div>
      </GuidedFooter>
    </div>
  );
}
