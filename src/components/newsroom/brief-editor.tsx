"use client";

import { HelpCircle, Plus, Target, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { SettingsCard } from "@/components/settings/key-value";
import { useUi } from "@/components/i18n/provider";
import { cn } from "@/lib/utils";
import type { Ask, AskKind, EditionBrief } from "@/lib/campaigns/brief";

/**
 * What you are asking them for, which is the half of a campaign that decides what comes back.
 *
 * Everything else about a campaign is logistics — who, when, how many reminders. This is the only
 * part that is editorial, and until now it did not exist: every contributor got the same blank
 * form whatever the month was about.
 *
 * Three things can be said, and they mix, because the mixed one is what editors actually mean:
 * ask everybody a question, assign somebody a topic, and leave the door open for whatever nobody
 * thought to ask about. The door is open by default and closing it is the deliberate act, because
 * the best thing in most issues comes through it.
 */
export function BriefEditor({
  brief,
  onChange,
  readOnly,
  contributors,
}: {
  brief: EditionBrief;
  onChange: (next: EditionBrief) => void;
  readOnly?: boolean;
  contributors: { id: string; name: string }[];
}) {
  const tr = useUi();

  const update = (index: number, patch: Partial<Ask>) =>
    onChange({ ...brief, asks: brief.asks.map((ask, i) => (i === index ? { ...ask, ...patch } : ask)) });

  const add = (kind: AskKind) =>
    onChange({
      ...brief,
      asks: [...brief.asks, { id: `ask-${Date.now()}-${brief.asks.length}`, kind, text: "", required: false, wants: ["TEXT"], contributorId: null }],
    });

  const remove = (index: number) => onChange({ ...brief, asks: brief.asks.filter((_, i) => i !== index) });

  return (
    <SettingsCard
      title={tr("What are you asking for?")}
      description={tr("Questions everybody answers, topics you hand to somebody in particular, or nothing at all — and whatever else they want to tell you.")}
    >
      <ul className="space-y-2">
        {brief.asks.map((ask, index) => (
          <li key={ask.id} className="rounded-md border border-border bg-card p-2.5">
            <div className="flex items-start gap-2">
              <span
                className={cn("mt-1 flex size-6 shrink-0 items-center justify-center rounded-md", ask.kind === "TOPIC" ? "bg-brand-soft text-brand-foreground" : "bg-muted text-muted-foreground")}
                title={ask.kind === "TOPIC" ? tr("A topic") : tr("A question")}
              >
                {ask.kind === "TOPIC" ? <Target className="size-3.5" /> : <HelpCircle className="size-3.5" />}
              </span>
              <span className="min-w-0 flex-1 space-y-1.5">
                <Input
                  value={ask.text}
                  onChange={(event) => update(index, { text: event.target.value })}
                  disabled={readOnly}
                  maxLength={400}
                  placeholder={ask.kind === "TOPIC" ? tr("Cover the new campus opening") : tr("What is the one thing that happened around you this month?")}
                  aria-label={ask.kind === "TOPIC" ? tr("Topic") : tr("Question")}
                  className="h-8"
                />
                <Input
                  value={ask.hint ?? ""}
                  onChange={(event) => update(index, { hint: event.target.value })}
                  disabled={readOnly}
                  maxLength={400}
                  placeholder={tr("A line of guidance, if it helps")}
                  aria-label={tr("Guidance")}
                  className="h-7 text-xs"
                />
                <span className="flex flex-wrap items-center gap-3 text-2xs text-muted-foreground">
                  <label className="flex items-center gap-1.5">
                    <Checkbox checked={ask.wants.includes("TEXT")} onCheckedChange={(v) => update(index, { wants: v === true ? [...new Set([...ask.wants, "TEXT" as const])] : ask.wants.filter((w) => w !== "TEXT") })} disabled={readOnly} />
                    {tr("Words")}
                  </label>
                  <label className="flex items-center gap-1.5">
                    <Checkbox checked={ask.wants.includes("PHOTO")} onCheckedChange={(v) => update(index, { wants: v === true ? [...new Set([...ask.wants, "PHOTO" as const])] : ask.wants.filter((w) => w !== "PHOTO") })} disabled={readOnly} />
                    {tr("A photograph")}
                  </label>
                  {ask.kind === "TOPIC" && contributors.length > 0 ? (
                    <label className="flex items-center gap-1.5">
                      {tr("Ask")}
                      <select
                        value={ask.contributorId ?? ""}
                        onChange={(event) => update(index, { contributorId: event.target.value || null })}
                        disabled={readOnly}
                        className="h-6 rounded-md border border-border bg-card px-1.5 text-2xs"
                        aria-label={tr("Who this topic is for")}
                      >
                        <option value="">{tr("everybody")}</option>
                        {contributors.map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </span>
              </span>
              {!readOnly ? (
                <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)} aria-label={tr("Remove this ask")}>
                  <Trash2 />
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {!readOnly ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => add("QUESTION")}>
            <Plus /> {tr("Add a question")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => add("TOPIC")}>
            <Plus /> {tr("Assign a topic")}
          </Button>
        </div>
      ) : null}

      <label className="mt-3 flex items-start gap-2.5 rounded-md border border-border bg-card px-2.5 py-2">
        <Checkbox checked={brief.openContributions} onCheckedChange={(v) => onChange({ ...brief, openContributions: v === true })} disabled={readOnly} className="mt-0.5" />
        <span className="min-w-0">
          <span className="block text-[13px] font-medium">{tr("Let them propose anything else")}</span>
          <span className="block text-2xs text-muted-foreground">{tr("On by default. The best thing in most issues is the thing nobody thought to ask about.")}</span>
        </span>
      </label>
    </SettingsCard>
  );
}
