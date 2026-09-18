"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FieldError, SettingsCard } from "@/components/settings/key-value";
import { saveEditionSettingsAction, type EditionSettingsPatch } from "@/app/(newsroom)/editions/[editionId]/settings/actions";
import { CAMPAIGN_TIMEZONE, zonedParts, zonedTimeToUtc } from "@/lib/campaigns/schedule";
import { PAGE_TEMPLATES } from "@/lib/constants";
import { useUi } from "@/components/i18n/provider";

/** The edition as the server holds it: instants as ISO strings (or null when unset). */
export type EditionSettingsInitial = Omit<EditionSettingsValues, "publicationTargetAt" | "finalReviewAt"> & {
  publicationTargetAt: string | null;
  finalReviewAt: string | null;
};

export type EditionSettingsValues = {
  label: string;
  title: string;
  isSpecialIssue: boolean;
  pageSize: "A4" | "TABLOID" | "LETTER";
  targetPageCount: number;
  pageCountMode: "auto" | "fixed";
  /** "YYYY-MM-DDTHH:mm" in the school's timezone, or "" when unset. */
  publicationTargetAt: string;
  finalReviewAt: string;
  editorInChiefId: string;
  coverHeadline: string;
  coverStandfirst: string;
  tagline: string;
  accentColour: string;
  coverTemplate: string;
  editorial: string;
  notes: string;
};

const PAGE_SIZES = [
  { value: "A4", label: "A4 (210 × 297 mm)" },
  { value: "TABLOID", label: "Tabloid" },
  { value: "LETTER", label: "Letter" },
] as const;

const COVER_TEMPLATES = PAGE_TEMPLATES.filter((t) => t.family === "cover");

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const p = zonedParts(new Date(iso), CAMPAIGN_TIMEZONE);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

function fromLocalInput(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const [, y, m, d, hh, mm] = match;
  return zonedTimeToUtc(Number(y), Number(m), Number(d), Number(hh), Number(mm), 0, CAMPAIGN_TIMEZONE).toISOString();
}

function toValues(initial: EditionSettingsInitial): EditionSettingsValues {
  return { ...initial, publicationTargetAt: toLocalInput(initial.publicationTargetAt), finalReviewAt: toLocalInput(initial.finalReviewAt) };
}

export function EditionSettingsForm({
  editionId,
  initial,
  editors,
  readOnly,
  meta,
}: {
  editionId: string;
  initial: EditionSettingsInitial;
  editors: { id: string; name: string }[];
  readOnly: boolean;
  /** Facts about the edition that the backend keeps immutable, shown for context. */
  meta: { issueNumber: number; month: string; slug: string; language: string; sections: number };
}) {
  const tr = useUi();
  const router = useRouter();
  const [values, setValues] = useState<EditionSettingsValues>(() => toValues(initial));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | null>(null);
  const [pending, start] = useTransition();
  const pristine = useMemo(() => toValues(initial), [initial]);
  const dirty = JSON.stringify(values) !== JSON.stringify(pristine);

  function set<K extends keyof EditionSettingsValues>(key: K, value: EditionSettingsValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function save() {
    start(async () => {
      const patch: EditionSettingsPatch = {
        label: values.label.trim(),
        title: values.title.trim(),
        isSpecialIssue: values.isSpecialIssue,
        pageSize: values.pageSize,
        targetPageCount: values.targetPageCount,
        pageCountMode: values.pageCountMode,
        publicationTargetAt: fromLocalInput(values.publicationTargetAt),
        finalReviewAt: fromLocalInput(values.finalReviewAt),
        editorInChiefId: values.editorInChiefId || null,
        coverHeadline: values.coverHeadline.trim() || null,
        coverStandfirst: values.coverStandfirst.trim() || null,
        editorial: values.editorial.trim() || null,
        notes: values.notes.trim() || null,
        theme: {
          coverTemplate: values.coverTemplate || undefined,
          accentColour: values.accentColour || undefined,
          tagline: values.tagline.trim() || undefined,
        },
      };
      const res = await saveEditionSettingsAction(editionId, patch);
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

  return (
    <div className="space-y-4">
      <SettingsCard title={tr("Identity")} description={tr("How this issue is named across the newsroom, the exports and the archive.")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="edition-label" className="text-xs">
              {tr("Label")}</Label>
            <Input id="edition-label" value={values.label} onChange={(e) => set("label", e.target.value)} disabled={readOnly} maxLength={60} aria-invalid={Boolean(fieldErrors?.label)} />
            <p className="text-2xs text-muted-foreground">{tr("Short name, e.g. “October 2026”")}</p>
            <FieldError errors={fieldErrors} name="label" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="edition-title" className="text-xs">
              {tr("Title")}</Label>
            <Input id="edition-title" value={values.title} onChange={(e) => set("title", e.target.value)} disabled={readOnly} maxLength={160} aria-invalid={Boolean(fieldErrors?.title)} />
            <p className="text-2xs text-muted-foreground">{tr("Printed on the cover and in the exports")}</p>
            <FieldError errors={fieldErrors} name="title" />
          </div>
        </div>

        <dl className="mt-3 grid gap-x-6 gap-y-2 border-t border-border pt-3 text-xs sm:grid-cols-4">
          <div>
            <dt className="label-caps">{tr("Issue")}</dt>
            <dd className="tabular mt-0.5 font-medium">N°{meta.issueNumber}</dd>
          </div>
          <div>
            <dt className="label-caps">{tr("Month")}</dt>
            <dd className="mt-0.5 font-medium">{meta.month}</dd>
          </div>
          <div>
            <dt className="label-caps">{tr("Language")}</dt>
            <dd className="mt-0.5 font-medium">{meta.language}</dd>
          </div>
          <div>
            <dt className="label-caps">{tr("Slug")}</dt>
            <dd className="mt-0.5 truncate font-mono text-[11px]">{meta.slug}</dd>
          </div>
        </dl>
        <p className="mt-2 text-2xs text-muted-foreground">
          {tr("The issue number, the month and the slug are fixed when the edition is created — they identify it in the archive and in every export. The language is the one its articles are written in and is set per article.")}</p>

        <label className="mt-3 flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2">
          <span className="min-w-0">
            <span className="block text-[13px] font-medium">{tr("Special issue")}</span>
            <span className="block text-2xs text-muted-foreground">{tr("Labelled “Special issue N°")}{meta.issueNumber}{tr("” instead of “Issue N°")}{meta.issueNumber}”.</span>
          </span>
          <Switch checked={values.isSpecialIssue} onCheckedChange={(v) => set("isSpecialIssue", v)} disabled={readOnly} aria-label={tr("Special issue")} />
        </label>
      </SettingsCard>

      <SettingsCard title={tr("Production")} description={`Deadlines are ${CAMPAIGN_TIMEZONE.replace("_", " ")}. The flatplan and the quality gates follow the page target.`}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="edition-final-review" className="text-xs">
              {tr("Final review")}</Label>
            <Input id="edition-final-review" type="datetime-local" value={values.finalReviewAt} onChange={(e) => set("finalReviewAt", e.target.value)} disabled={readOnly} className="tabular" />
            <FieldError errors={fieldErrors} name="finalReviewAt" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="edition-publication" className="text-xs">
              {tr("Publication target")}</Label>
            <Input id="edition-publication" type="datetime-local" value={values.publicationTargetAt} onChange={(e) => set("publicationTargetAt", e.target.value)} disabled={readOnly} className="tabular" />
            <FieldError errors={fieldErrors} name="publicationTargetAt" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="edition-pages" className="text-xs">
              {tr("Target page count")}</Label>
            <Input
              id="edition-pages"
              type="number"
              min={4}
              max={96}
              step={2}
              value={values.targetPageCount}
              onChange={(e) => set("targetPageCount", Math.max(4, Math.min(96, Number(e.target.value) || 0)))}
              disabled={readOnly}
              className="tabular"
              aria-invalid={Boolean(fieldErrors?.targetPageCount)}
            />
            <p className="text-2xs text-muted-foreground">{meta.sections}{" "}{tr("sections planned")}</p>
            <FieldError errors={fieldErrors} name="targetPageCount" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="edition-page-count-mode" className="text-xs">
              {tr("How that number is used")}</Label>
            <NativeSelect
              id="edition-page-count-mode"
              value={values.pageCountMode}
              onChange={(e) => set("pageCountMode", e.target.value as EditionSettingsValues["pageCountMode"])}
              disabled={readOnly}
            >
              <option value="auto">{tr("A ceiling — make the issue as long as the stories need")}</option>
              <option value="fixed">{tr("Exactly this many — a printer has been promised the extent")}</option>
            </NativeSelect>
            <p className="text-2xs text-muted-foreground">
              {values.pageCountMode === "fixed"
                ? tr("Spare photographs get picture pages and stories get more air, so the issue lands on the page count.")
                : tr("Short stories share a page rather than each getting one, so the issue has no half-empty pages.")}{" "}
              {tr("Applied the next time the layout is regenerated.")}
            </p>
            <FieldError errors={fieldErrors} name="pageCountMode" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="edition-page-size" className="text-xs">
              {tr("Page size")}</Label>
            <NativeSelect id="edition-page-size" value={values.pageSize} onChange={(e) => set("pageSize", e.target.value as EditionSettingsValues["pageSize"])} disabled={readOnly}>
              {PAGE_SIZES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </NativeSelect>
            <FieldError errors={fieldErrors} name="pageSize" />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="edition-eic" className="text-xs">
              {tr("Editor in chief")}</Label>
            <NativeSelect id="edition-eic" value={values.editorInChiefId} onChange={(e) => set("editorInChiefId", e.target.value)} disabled={readOnly}>
              <option value="">{tr("Not assigned")}</option>
              {editors.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </NativeSelect>
            <p className="text-2xs text-muted-foreground">{tr("Signs the editorial and approves the issue")}</p>
            <FieldError errors={fieldErrors} name="editorInChiefId" />
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title={tr("Theme and editorial angle")} description={tr("The angle of this issue: what the cover promises and what the editorial says.")}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1 xl:col-span-2">
            <Label htmlFor="edition-tagline" className="text-xs">
              {tr("Issue theme")}</Label>
            <Input id="edition-tagline" value={values.tagline} onChange={(e) => set("tagline", e.target.value)} disabled={readOnly} placeholder={tr("e.g. Data, careers and the campuses that build them")} />
            <p className="text-2xs text-muted-foreground">{tr("One line that sets the angle for the whole issue")}</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="edition-cover-template" className="text-xs">
              {tr("Cover template")}</Label>
            <NativeSelect id="edition-cover-template" value={values.coverTemplate} onChange={(e) => set("coverTemplate", e.target.value)} disabled={readOnly}>
              <option value="">{tr("Chosen at layout time")}</option>
              {COVER_TEMPLATES.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="edition-accent" className="text-xs">
              {tr("Accent colour")}</Label>
            <div className="flex items-center gap-2">
              <input
                id="edition-accent"
                type="color"
                value={values.accentColour || "#10203A"}
                onChange={(e) => set("accentColour", e.target.value)}
                disabled={readOnly}
                className="size-8 shrink-0 cursor-pointer rounded border border-input bg-card p-0.5"
                aria-label={tr("Accent colour")}
              />
              <Input value={values.accentColour} onChange={(e) => set("accentColour", e.target.value)} disabled={readOnly} className="font-mono text-xs" placeholder="#10203A" />
            </div>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="edition-cover-headline" className="text-xs">
              {tr("Cover headline")}</Label>
            <Input id="edition-cover-headline" value={values.coverHeadline} onChange={(e) => set("coverHeadline", e.target.value)} disabled={readOnly} maxLength={200} />
            <FieldError errors={fieldErrors} name="coverHeadline" />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="edition-cover-standfirst" className="text-xs">
              {tr("Cover standfirst")}</Label>
            <Input id="edition-cover-standfirst" value={values.coverStandfirst} onChange={(e) => set("coverStandfirst", e.target.value)} disabled={readOnly} maxLength={400} />
            <FieldError errors={fieldErrors} name="coverStandfirst" />
          </div>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="edition-editorial" className="text-xs">
              {tr("Editorial")}</Label>
            <Textarea id="edition-editorial" value={values.editorial} onChange={(e) => set("editorial", e.target.value)} disabled={readOnly} rows={6} maxLength={4000} placeholder={tr("The editor's letter, printed on the contents page.")} />
            <p className="text-2xs text-muted-foreground">{tr("Printed on the contents page, signed by the editor in chief")}</p>
            <FieldError errors={fieldErrors} name="editorial" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="edition-notes" className="text-xs">
              {tr("Desk notes")}</Label>
            <Textarea id="edition-notes" value={values.notes} onChange={(e) => set("notes", e.target.value)} disabled={readOnly} rows={6} maxLength={2000} placeholder={tr("Internal notes about this issue — never printed.")} />
            <p className="text-2xs text-muted-foreground">{tr("Internal only")}</p>
            <FieldError errors={fieldErrors} name="notes" />
          </div>
        </div>
      </SettingsCard>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/95 px-3 py-2 shadow-xs backdrop-blur">
        <span className="text-xs text-muted-foreground">{readOnly ? "You need the edition:edit permission to change these settings." : dirty ? "Unsaved changes" : "All changes saved"}</span>
        <div className="flex items-center gap-2">
          {dirty && !readOnly ? (
            <Button variant="ghost" size="sm" onClick={() => setValues(pristine)} disabled={pending}>
              {tr("Discard")}</Button>
          ) : null}
          <Button size="sm" onClick={save} loading={pending} disabled={readOnly || !dirty}>
            <Save />{" "}{tr("Save settings")}</Button>
        </div>
      </div>
    </div>
  );
}
