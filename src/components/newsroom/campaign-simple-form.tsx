"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { SettingsCard } from "@/components/settings/key-value";
import { GuidedFooter } from "./guided-footer";
import { saveAudienceAction } from "@/app/(newsroom)/editions/[editionId]/campaign/actions";
import type { SelectionMode } from "@/lib/campaigns/selection";
import { cn } from "@/lib/utils";
import { useUi } from "@/components/i18n/provider";

export type SimpleGroup = { id: string; name: string; description: string | null; members: number };

export type AudienceValues = {
  selectionMode: SelectionMode;
  drawCount: number;
  contributorGroupIds: string[];
  /** PEOPLE: exactly who is being asked, chosen here rather than on another screen. */
  selectedContributorIds: string[];
};

export type SimplePerson = { id: string; name: string; email: string; groups: string[] };

/**
 * Who are you asking?
 *
 * One question now, where there were three. The last day moved to a screen of its own, because it
 * times the whole month rather than describing the invitation, and the word at the top of the
 * email moved to the screen that asks what you want from people — which is where somebody writing
 * it is already thinking about what to say.
 *
 * What is left is the people, and all three ways of choosing them finish here. "The people I
 * choose" used to send you to the contributor list with no way to bring anybody back; the names
 * are on this screen now, with a search box, because "choose them" and "go and find them
 * somewhere else" are not the same instruction.
 */
export function CampaignSimpleForm({
  editionId,
  initial,
  groups,
  people,
  canManage,
  closed,
  next,
  nextLabel,
  nextHint,
  title,
  back,
}: {
  editionId: string;
  initial: AudienceValues;
  groups: SimpleGroup[];
  people: SimplePerson[];
  canManage: boolean;
  closed: boolean;
  next: string | null;
  nextLabel: string;
  nextHint: string;
  title: string;
  back?: { href: string; label: string } | null;
}) {
  const tr = useUi();
  const router = useRouter();
  const [values, setValues] = useState<AudienceValues>(initial);
  const [saving, startSave] = useTransition();
  const [moving, startMove] = useTransition();
  const readOnly = !canManage || closed;
  const dirty = useMemo(() => JSON.stringify(values) !== JSON.stringify(initial), [values, initial]);
  const pool = groups.filter((g) => values.contributorGroupIds.includes(g.id)).reduce((n, g) => n + g.members, 0);
  const [search, setSearch] = useState("");
  const chosen = new Set(values.selectedContributorIds);
  const needle = search.trim().toLowerCase();
  // The whole list when nobody has typed, narrowed the moment they do; the people already ticked
  // stay visible whatever the search says, so unticking somebody never means finding them again.
  const shown = needle ? people.filter((person) => chosen.has(person.id) || `${person.name} ${person.email} ${person.groups.join(" ")}`.toLowerCase().includes(needle)) : people;

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
      selectedContributorIds: values.selectedContributorIds,
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

        {values.selectionMode === "PEOPLE" ? (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                disabled={readOnly}
                placeholder={tr("Search a name or an address")}
                aria-label={tr("Search the contributors")}
                className="h-8 w-full sm:w-64"
              />
              <span className="text-2xs text-muted-foreground">
                {values.selectedContributorIds.length === 1 ? tr("1 person chosen") : tr("{count} people chosen", { count: values.selectedContributorIds.length })}
              </span>
            </div>
            <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-1">
              {shown.map((person) => {
                const picked = chosen.has(person.id);
                return (
                  <li key={person.id}>
                    <label className={cn("flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors", picked ? "bg-brand-soft/40" : "hover:bg-muted/60", readOnly && "cursor-default opacity-70")}>
                      <Checkbox
                        checked={picked}
                        onCheckedChange={(on) =>
                          setValues((v) => ({
                            ...v,
                            selectedContributorIds: on === true ? [...v.selectedContributorIds, person.id] : v.selectedContributorIds.filter((id) => id !== person.id),
                          }))
                        }
                        disabled={readOnly}
                        aria-label={person.name}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{person.name}</span>
                        <span className="block truncate text-2xs text-muted-foreground">{person.email}</span>
                      </span>
                      {person.groups.length ? <span className="shrink-0 truncate text-2xs text-muted-foreground">{person.groups.join(" · ")}</span> : null}
                    </label>
                  </li>
                );
              })}
              {!shown.length ? <li className="p-3 text-xs text-muted-foreground">{people.length ? tr("Nobody here by that name.") : tr("There are no contributors yet. Add some and they will be here.")}</li> : null}
            </ul>
          </div>
        ) : null}

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
