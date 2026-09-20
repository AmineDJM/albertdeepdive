"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SettingsCard } from "@/components/settings/key-value";
import { GuidedFooter } from "./guided-footer";
import { saveAudienceAction } from "@/app/(newsroom)/editions/[editionId]/campaign/actions";
import { endOfZonedDay } from "@/lib/campaigns/schedule";
import type { SelectionMode } from "@/lib/campaigns/selection";
import { cn } from "@/lib/utils";
import { useUi } from "@/components/i18n/provider";

export type SimpleGroup = { id: string; name: string; description: string | null; members: number };

export type AudienceValues = {
  selectionMode: SelectionMode;
  drawCount: number;
  contributorGroupIds: string[];
  /** The closing date, as the calendar day it is in the workspace's timezone. */
  deadlineDay: string;
  introMessage: string;
};

/**
 * Who are you asking, and by when.
 *
 * The campaign screen asked eleven questions: five dates, a campus target per campus, the pools,
 * the selection, the brief, the invitation message and a name for the internal log. Three of them
 * are decisions — which people, how many, and the last day — and the other eight are consequences
 * or logistics. So Standard asks the three, and derives the rest; Advanced still shows all of it,
 * on the same screen, writing the same columns.
 */
export function CampaignSimpleForm({
  editionId,
  initial,
  groups,
  canManage,
  closed,
  next,
  nextLabel,
  nextHint,
  title,
}: {
  editionId: string;
  initial: AudienceValues;
  groups: SimpleGroup[];
  canManage: boolean;
  closed: boolean;
  next: string | null;
  nextLabel: string;
  nextHint: string;
  title: string;
}) {
  const tr = useUi();
  const router = useRouter();
  const [values, setValues] = useState<AudienceValues>(initial);
  const [saving, startSave] = useTransition();
  const [moving, startMove] = useTransition();
  const readOnly = !canManage || closed;
  const dirty = useMemo(() => JSON.stringify(values) !== JSON.stringify(initial), [values, initial]);
  const pool = groups.filter((g) => values.contributorGroupIds.includes(g.id)).reduce((n, g) => n + g.members, 0);

  const choices: { mode: SelectionMode; label: string; hint: string }[] = [
    { mode: "DRAW", label: tr("A few of them"), hint: tr("Briefly draws the number you ask for, skipping whoever was asked last time.") },
    { mode: "GROUP", label: tr("A whole group"), hint: tr("Everybody in the groups ticked below.") },
    { mode: "PEOPLE", label: tr("People I choose"), hint: tr("Exactly the contributors you pick, and nobody else.") },
  ];

  async function persist(): Promise<boolean> {
    const result = await saveAudienceAction(editionId, {
      selectionMode: values.selectionMode,
      drawCount: values.drawCount,
      contributorGroupIds: values.contributorGroupIds,
      deadlineAt: endOfZonedDay(values.deadlineDay)?.toISOString() ?? "",
      introMessage: values.introMessage.trim() || null,
    });
    if (!result.ok) {
      toast.error(result.error, { description: result.fieldErrors ? Object.values(result.fieldErrors).flat().join(" · ") : undefined });
      return false;
    }
    return true;
  }

  return (
    <div className="space-y-4">
      <SettingsCard title={tr("The people")} description={tr("Three ways, and they are the three things a person actually says: these people, this group, or six of them.")}>
        <div className="grid gap-2 sm:grid-cols-3">
          {choices.map((choice) => {
            const picked = values.selectionMode === choice.mode;
            return (
              <label key={choice.mode} className={cn("flex cursor-pointer flex-col gap-1 rounded-md border px-3 py-2.5 transition-colors", picked ? "border-brand/60 bg-brand-soft/30" : "border-border bg-card hover:bg-muted/50", readOnly && "cursor-default opacity-70")}>
                <span className="flex items-center gap-2">
                  <input type="radio" name="who" className="size-3.5 accent-[var(--brand)]" checked={picked} onChange={() => setValues((v) => ({ ...v, selectionMode: choice.mode }))} disabled={readOnly} />
                  <span className="text-[13px] font-medium">{choice.label}</span>
                </span>
                <span className="text-2xs text-muted-foreground">{choice.hint}</span>
              </label>
            );
          })}
        </div>

        {values.selectionMode === "DRAW" ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
            <span>{tr("Ask")}</span>
            <Input
              type="number"
              min={0}
              max={1000}
              value={values.drawCount}
              onChange={(event) => setValues((v) => ({ ...v, drawCount: Math.max(0, Math.min(1000, Number(event.target.value) || 0)) }))}
              disabled={readOnly}
              aria-label={tr("How many contributors to draw")}
              className="tabular h-7 w-20"
            />
            <span className="text-muted-foreground">{pool === 1 ? tr("of the 1 person in the groups below") : tr("of the {count} people in the groups below", { count: pool })}</span>
          </div>
        ) : null}

        {values.selectionMode === "PEOPLE" ? <p className="mt-3 text-xs text-muted-foreground">{tr("Pick them on the contributors screen and only they are asked.")}</p> : null}

        <ul className="mt-3 space-y-1">
          {groups.map((g) => {
            const checked = values.contributorGroupIds.includes(g.id);
            return (
              <li key={g.id}>
                <label className={cn("flex cursor-pointer items-start gap-2.5 rounded-md border px-2.5 py-2 transition-colors", checked ? "border-brand/50 bg-brand-soft/30" : "border-border bg-card hover:bg-muted/50", readOnly && "cursor-default opacity-70")}>
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(on) => setValues((v) => ({ ...v, contributorGroupIds: on === true ? [...v.contributorGroupIds, g.id] : v.contributorGroupIds.filter((id) => id !== g.id) }))}
                    disabled={readOnly}
                    aria-label={g.name}
                    className="mt-0.5"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-medium">{g.name}</span>
                      <span className="tabular text-2xs text-muted-foreground">{g.members}</span>
                    </span>
                    {g.description ? <span className="mt-0.5 block text-2xs text-muted-foreground">{g.description}</span> : null}
                  </span>
                </label>
              </li>
            );
          })}
          {groups.length === 0 ? <li className="text-xs text-muted-foreground">{tr("No contributor group exists yet.")}</li> : null}
        </ul>
      </SettingsCard>

      <SettingsCard title={tr("By when?")} description={tr("The last day to send something in. Briefly reminds them twice before it, and accepts anything late for one more day.")}>
        <Input type="date" value={values.deadlineDay} onChange={(event) => setValues((v) => ({ ...v, deadlineDay: event.target.value }))} disabled={readOnly} aria-label={tr("Last day to contribute")} className="tabular h-8 w-48" />
      </SettingsCard>

      <SettingsCard title={tr("Anything to tell them?")} description={tr("Added at the top of every invitation and reminder email. Leave it empty and Briefly writes it.")}>
        <Textarea
          value={values.introMessage}
          onChange={(event) => setValues((v) => ({ ...v, introMessage: event.target.value }))}
          disabled={readOnly}
          rows={3}
          maxLength={2000}
          placeholder={tr("Tell us what happened around you this month…")}
          aria-label={tr("Invitation message")}
        />
      </SettingsCard>

      <GuidedFooter title={title} hint={dirty ? tr("Not saved yet") : nextHint}>
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
