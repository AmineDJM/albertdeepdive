"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, RotateCcw, Save, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldError, SettingsCard } from "@/components/settings/key-value";
import { applyCampaignDefaultsAction, saveCampaignAction, type CampaignFormInput } from "@/app/(newsroom)/editions/[editionId]/campaign/actions";
import { CAMPAIGN_TIMEZONE, zonedParts, zonedTimeToUtc } from "@/lib/campaigns/schedule";
import { cn } from "@/lib/utils";
import { useUi } from "@/components/i18n/provider";
import type { SelectionMode } from "@/lib/campaigns/selection";
import type { EditionBrief } from "@/lib/campaigns/brief";

/** The campaign as the server holds it: instants as ISO strings. */
export type CampaignFormInitial = {
  name: string;
  opensAt: string;
  reminder1At: string;
  reminder2At: string;
  deadlineAt: string;
  graceEndsAt: string;
  targets: Record<string, number>;
  contributorGroupIds: string[];
  introMessage: string;
  autoProcess: boolean;
  reinvitePrevious: boolean;
  /** DRAW a number from the pool, invite a whole GROUP, or ask a list of PEOPLE. */
  selectionMode: SelectionMode;
  /** DRAW: how many, when the campaign is not split by campus. */
  drawCount: number;
  /** PEOPLE: exactly who. */
  selectedContributorIds: string[];
  /** What this edition is asking for: questions, assigned topics, and the open door. */
  brief: EditionBrief;
};

/** The same campaign as the form edits it: dates as "YYYY-MM-DDTHH:mm" in the school's timezone. */
export type CampaignFormValues = CampaignFormInitial;

export type CampusOption = { id: string; name: string; colour: string | null; contributors: number };
export type GroupOption = { id: string; name: string; description: string | null; members: number };

const SCHOOL_KEY = "school";

/** ISO instant → "YYYY-MM-DDTHH:mm" in the school's timezone (what the editor reads everywhere else). */
export function toLocalInput(iso: string): string {
  const p = zonedParts(new Date(iso), CAMPAIGN_TIMEZONE);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** "YYYY-MM-DDTHH:mm" read as school time → ISO instant for the server. */
function fromLocalInput(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return "";
  const [, y, m, d, hh, mm] = match;
  return zonedTimeToUtc(Number(y), Number(m), Number(d), Number(hh), Number(mm), 0, CAMPAIGN_TIMEZONE).toISOString();
}

const DATE_FIELDS = [
  { key: "opensAt", label: "Opens — invitations go out", hint: "Day 1" },
  { key: "reminder1At", label: "Reminder #1", hint: "Day 4" },
  { key: "reminder2At", label: "Reminder #2 — last day", hint: "Day 7" },
  { key: "deadlineAt", label: "Deadline", hint: "End of the last day" },
  { key: "graceEndsAt", label: "Grace period ends", hint: "Day 8 · campaign closes" },
] as const;

type DateKey = (typeof DATE_FIELDS)[number]["key"];

function toValues(initial: CampaignFormInitial): CampaignFormValues {
  return {
    ...initial,
    opensAt: toLocalInput(initial.opensAt),
    reminder1At: toLocalInput(initial.reminder1At),
    reminder2At: toLocalInput(initial.reminder2At),
    deadlineAt: toLocalInput(initial.deadlineAt),
    graceEndsAt: toLocalInput(initial.graceEndsAt),
    targets: { ...initial.targets },
    contributorGroupIds: [...initial.contributorGroupIds],
  };
}

export function CampaignConfigForm({
  editionId,
  initial,
  campuses,
  groups,
  canManage,
  openingLocked,
  closed,
}: {
  editionId: string;
  initial: CampaignFormInitial;
  campuses: CampusOption[];
  groups: GroupOption[];
  canManage: boolean;
  /** The campaign is already open: the service refuses a new opening date. */
  openingLocked: boolean;
  closed: boolean;
}) {
  const tr = useUi();
  const router = useRouter();
  const [values, setValues] = useState<CampaignFormValues>(() => toValues(initial));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | null>(null);
  const [pending, start] = useTransition();
  const [defaultsPending, startDefaults] = useTransition();
  const readOnly = !canManage || closed;

  const pristine = useMemo(() => toValues(initial), [initial]);
  const dirty = JSON.stringify(values) !== JSON.stringify(pristine);

  const targetTotal = Object.values(values.targets).reduce((n, v) => n + (Number.isFinite(v) ? v : 0), 0);
  const selectedPool = groups.filter((g) => values.contributorGroupIds.includes(g.id)).reduce((n, g) => n + g.members, 0);

  function setDate(key: DateKey, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function setTarget(key: string, raw: string) {
    const n = raw === "" ? 0 : Math.max(0, Math.min(1000, Math.round(Number(raw) || 0)));
    setValues((v) => ({ ...v, targets: { ...v.targets, [key]: n } }));
  }

  function toggleGroup(id: string, on: boolean) {
    setValues((v) => ({ ...v, contributorGroupIds: on ? [...v.contributorGroupIds, id] : v.contributorGroupIds.filter((g) => g !== id) }));
  }

  function save() {
    start(async () => {
      const payload: CampaignFormInput = {
        name: values.name.trim() || "Contributions",
        opensAt: fromLocalInput(values.opensAt),
        reminder1At: fromLocalInput(values.reminder1At),
        reminder2At: fromLocalInput(values.reminder2At),
        deadlineAt: fromLocalInput(values.deadlineAt),
        graceEndsAt: fromLocalInput(values.graceEndsAt),
        targets: values.targets,
        contributorGroupIds: values.contributorGroupIds,
        introMessage: values.introMessage.trim() || null,
        autoProcess: values.autoProcess,
        reinvitePrevious: values.reinvitePrevious,
        selectionMode: values.selectionMode,
        drawCount: values.drawCount,
        selectedContributorIds: values.selectedContributorIds,
        brief: values.brief,
      };
      const res = await saveCampaignAction(editionId, payload);
      if (!res.ok) {
        setFieldErrors(res.fieldErrors ?? null);
        toast.error(res.error, { description: res.fieldErrors ? Object.values(res.fieldErrors).flat().join(" · ") : undefined });
        return;
      }
      setFieldErrors(null);
      toast.success(res.message);
      router.refresh();
    });
  }

  function applyDefaults() {
    startDefaults(async () => {
      const res = await applyCampaignDefaultsAction(editionId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <SettingsCard
        title={tr("Schedule")}
        description={`All times are ${CAMPAIGN_TIMEZONE.replace("_", " ")} — the same clock contributors see in their invitation.`}
        action={
          canManage && !openingLocked ? (
            <Button variant="outline" size="sm" onClick={applyDefaults} loading={defaultsPending}>
              <RotateCcw />{" "}{tr("Monthly defaults")}</Button>
          ) : null
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {DATE_FIELDS.map((f) => {
            const disabled = readOnly || (f.key === "opensAt" && openingLocked);
            return (
              <div key={f.key} className="space-y-1">
                <Label htmlFor={`campaign-${f.key}`} className="text-xs">
                  {f.label}
                </Label>
                <Input
                  id={`campaign-${f.key}`}
                  type="datetime-local"
                  value={values[f.key]}
                  onChange={(e) => setDate(f.key, e.target.value)}
                  disabled={disabled}
                  aria-invalid={Boolean(fieldErrors?.[f.key])}
                  className="tabular"
                />
                <p className="text-2xs text-muted-foreground">{disabled && f.key === "opensAt" ? "Locked — the campaign is already open" : f.hint}</p>
                <FieldError errors={fieldErrors} name={f.key} />
              </div>
            );
          })}
          <div className="space-y-1">
            <Label htmlFor="campaign-name" className="text-xs">
              {tr("Campaign name")}</Label>
            <Input id="campaign-name" value={values.name} onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))} disabled={readOnly} maxLength={160} />
            <p className="text-2xs text-muted-foreground">{tr("Internal label, shown in the automation log")}</p>
            <FieldError errors={fieldErrors} name="name" />
          </div>
        </div>
      </SettingsCard>

      <div className="grid gap-4 xl:grid-cols-2">
        <SettingsCard
          title={tr("Contributor pools")}
          description={`${selectedPool} member${selectedPool === 1 ? "" : "s"} in the selected pools — contributors are picked from these groups.`}
        >
          <ul className="space-y-1">
            {groups.map((g) => {
              const checked = values.contributorGroupIds.includes(g.id);
              return (
                <li key={g.id}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-start gap-2.5 rounded-md border px-2.5 py-2 transition-colors",
                      checked ? "border-brand/50 bg-brand-soft/30" : "border-border bg-card hover:bg-muted/50",
                      readOnly && "cursor-default opacity-70",
                    )}
                  >
                    <Checkbox checked={checked} onCheckedChange={(v) => toggleGroup(g.id, v === true)} disabled={readOnly} aria-label={`Invite ${g.name}`} className="mt-0.5" />
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
          <FieldError errors={fieldErrors} name="contributorGroupIds" />
        </SettingsCard>

        <SettingsCard title={tr("Campus targets")} description={`How many contributors to invite per campus — ${targetTotal} in total.`}>
          <ul className="space-y-1.5">
            {[...campuses.map((c) => ({ key: c.id, name: c.name, colour: c.colour, pool: c.contributors })), { key: SCHOOL_KEY, name: "Whole school (no campus)", colour: null, pool: null }].map((row) => (
              <li key={row.key} className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-2.5 py-1.5">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: row.colour ?? "#94a3b8" }} />
                  <span className="truncate text-[13px]">{row.name}</span>
                  {row.pool !== null ? <span className="tabular shrink-0 text-2xs text-muted-foreground">{row.pool}{" "}{tr("active")}</span> : null}
                </span>
                <Input
                  type="number"
                  min={0}
                  max={1000}
                  value={values.targets[row.key] ?? 0}
                  onChange={(e) => setTarget(row.key, e.target.value)}
                  disabled={readOnly}
                  aria-label={`Contributors to invite for ${row.name}`}
                  className="tabular h-7 w-20 shrink-0"
                />
              </li>
            ))}
          </ul>
          <FieldError errors={fieldErrors} name="targets" />
        </SettingsCard>
      </div>

      <SettingsCard
        title={tr("Who are you asking?")}
        description={tr("Three ways, and they are the three things a person actually says: these people, this group, or six of them.")}
      >
        <div className="grid gap-2 sm:grid-cols-3">
          {(
            [
              { mode: "DRAW" as const, label: tr("A few of them"), hint: tr("Briefly draws the number you ask for, skipping whoever was asked last time.") },
              { mode: "GROUP" as const, label: tr("A whole group"), hint: tr("Everybody in the groups ticked below.") },
              { mode: "PEOPLE" as const, label: tr("People I choose"), hint: tr("Exactly the contributors you pick, and nobody else.") },
            ]
          ).map((choice) => {
            const picked = values.selectionMode === choice.mode;
            return (
              <label
                key={choice.mode}
                className={cn(
                  "flex cursor-pointer flex-col gap-1 rounded-md border px-3 py-2.5 transition-colors",
                  picked ? "border-brand/60 bg-brand-soft/30" : "border-border bg-card hover:bg-muted/50",
                  readOnly && "cursor-default opacity-70",
                )}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="selection-mode"
                    className="size-3.5 accent-[var(--brand)]"
                    checked={picked}
                    onChange={() => setValues((v) => ({ ...v, selectionMode: choice.mode }))}
                    disabled={readOnly}
                  />
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
            <span className="text-muted-foreground">{tr("of the people in the groups below. Leave the campus targets at zero to use this number.")}</span>
          </div>
        ) : null}

        {values.selectionMode === "PEOPLE" ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {values.selectedContributorIds.length
              ? `${values.selectedContributorIds.length} ${tr("contributor(s) chosen. Add or remove them from the contributors screen.")}`
              : tr("Nobody chosen yet. Pick contributors from the contributors screen and they will be asked — and only them.")}
          </p>
        ) : null}
      </SettingsCard>

      {/*
        * The brief is a screen now, not a card here.
        *
        * It is the one editorial decision on a page of logistics, and it was edited beside the
        * reminder dates by a Save that wrote all eleven fields at once. This says what it holds
        * and where it is; the form still carries it through untouched so saving the dates cannot
        * blank it.
        */}
      <SettingsCard title={tr("What are you asking for?")} description={tr("Questions everybody answers, topics handed to somebody in particular, and whether they may send anything else.")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-muted-foreground">
            {values.brief.asks.length === 0
              ? tr("Nothing asked in particular — contributors send whatever they like.")
              : values.brief.asks.length === 1
                ? tr("1 thing asked")
                : tr("{count} things asked", { count: values.brief.asks.length })}
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href={`/editions/${editionId}/ask`}>{tr("Change")}</Link>
          </Button>
        </div>
      </SettingsCard>

      <SettingsCard title={tr("Invitation message")} description={tr("Added at the top of every invitation and reminder email.")}>
        <Textarea
          value={values.introMessage}
          onChange={(e) => setValues((v) => ({ ...v, introMessage: e.target.value }))}
          disabled={readOnly}
          rows={3}
          maxLength={2000}
          placeholder={tr("Tell us what happened around you this month…")}
          aria-label={tr("Invitation message")}
        />
        <FieldError errors={fieldErrors} name="introMessage" />
        <label className="mt-3 flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2">
          <span className="min-w-0">
            <span className="block text-[13px] font-medium">{tr("Run the AI processing when the campaign closes")}</span>
            <span className="block text-2xs text-muted-foreground">{tr("Normalises, classifies and clusters every submission as soon as the grace period ends.")}</span>
          </span>
          <Switch checked={values.autoProcess} onCheckedChange={(v) => setValues((s) => ({ ...s, autoProcess: v }))} disabled={readOnly} aria-label={tr("Run the AI processing when the campaign closes")} />
        </label>
        <label className="mt-3 flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-[13px] font-medium">{tr("Re-invite last edition’s contributors")}</span>
            <span className="block text-2xs text-muted-foreground">{tr("Off by default: people invited to the previous edition are held back so the rota moves through the pool. Turn it on to let them take part again.")}</span>
          </span>
          <Switch checked={values.reinvitePrevious} onCheckedChange={(v) => setValues((s) => ({ ...s, reinvitePrevious: v }))} disabled={readOnly} aria-label={tr("Re-invite last edition's contributors")} />
        </label>
      </SettingsCard>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Users className="size-3.5" /> {values.contributorGroupIds.length}{" "}{tr("pool")}{values.contributorGroupIds.length === 1 ? "" : "s"}{" "}{tr("· target")}{" "}{targetTotal}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock className="size-3.5" /> {closed ? "Closed — reopen it to change the dates" : dirty ? "Unsaved changes" : "Saved"}
          </span>
        </p>
        <div className="flex items-center gap-2">
          {dirty && !readOnly ? (
            <Button variant="ghost" size="sm" onClick={() => setValues(pristine)} disabled={pending}>
              {tr("Discard")}</Button>
          ) : null}
          <Button size="sm" onClick={save} loading={pending} disabled={readOnly || !dirty}>
            <Save />{" "}{tr("Save campaign")}</Button>
        </div>
      </div>
    </div>
  );
}
