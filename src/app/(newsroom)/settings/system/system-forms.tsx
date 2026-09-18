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
import { FieldError, SettingsCard } from "@/components/settings/key-value";
import { campaignDefaultsIssues, type AiSettings, type ContactSettings, type MastheadSettings, type PrintSettings, type SettingKey } from "@/server/settings/schemas";
import { AUTOMATION_KEYS, type AutomationKey, type AutomationToggles } from "@/lib/campaigns/automations";
import type { CampaignDefaults } from "@/lib/campaigns/schedule";
import { computeCampaignSchedule, formatZoned, nextEditionMonth, editionLabel } from "@/lib/campaigns/schedule";
import { saveSettingAction } from "./actions";
import { useUi } from "@/components/i18n/provider";

function useSave<T>(key: SettingKey) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]> | null>(null);
  const save = (value: T, after?: () => void) =>
    start(async () => {
      const res = await saveSettingAction(key, value);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? null);
        toast.error(res.error);
        return;
      }
      setErrors(null);
      toast.success(res.message);
      after?.();
      router.refresh();
    });
  return { pending, errors, save };
}

export function MastheadForm({ value }: { value: MastheadSettings }) {
  const tr = useUi();
  const [form, setForm] = useState(value);
  const { pending, errors, save } = useSave<MastheadSettings>("masthead");
  const dirty = JSON.stringify(form) !== JSON.stringify(value);
  return (
    <SettingsCard id="masthead" title={tr("Masthead")} description={tr("Printed on the cover, the running headers and every email.")}>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save(form);
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="masthead-title">{tr("Title")}</Label>
          <Input id="masthead-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="font-display text-[15px]" />
          <FieldError errors={errors} name="title" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="masthead-tagline">{tr("Tagline")}</Label>
          <Input id="masthead-tagline" value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} />
          <FieldError errors={errors} name="tagline" />
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" size="sm" loading={pending} disabled={!dirty}>
            <Save />{" "}{tr("Save masthead")}</Button>
        </div>
      </form>
    </SettingsCard>
  );
}

export function ContactForm({ value }: { value: ContactSettings }) {
  const tr = useUi();
  const [form, setForm] = useState(value);
  const { pending, errors, save } = useSave<ContactSettings>("contact");
  const dirty = JSON.stringify(form) !== JSON.stringify(value);
  return (
    <SettingsCard id="contact" title={tr("Contact")} description={tr("Shown in the colophon and the back page.")}>
      <form
        className="grid gap-3 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          save(form);
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="contact-email">{tr("Email")}</Label>
          <Input id="contact-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <FieldError errors={errors} name="email" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contact-website">{tr("Website")}</Label>
          <Input id="contact-website" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder={tr("www.example.com")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contact-instagram">{tr("Instagram")}</Label>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-muted-foreground">@</span>
            <Input id="contact-instagram" value={form.instagram} onChange={(e) => setForm({ ...form, instagram: e.target.value.replace(/^@/, "") })} className="pl-6" />
          </div>
        </div>
        <div className="sm:col-span-3">
          <Button type="submit" size="sm" loading={pending} disabled={!dirty}>
            <Save />{" "}{tr("Save contact")}</Button>
        </div>
      </form>
    </SettingsCard>
  );
}

const DAY_FIELDS: { key: keyof CampaignDefaults; label: string; hint: string }[] = [
  { key: "openDay", label: "Contribution request", hint: "Day the personal links go out" },
  { key: "reminder1Day", label: "Reminder #1", hint: "To contributors who have not submitted" },
  { key: "reminder2Day", label: "Reminder #2", hint: "Last-day reminder; deadline at 23:59" },
  { key: "graceDay", label: "Grace period ends", hint: "Late entries accepted until 23:59" },
  { key: "finalReviewDay", label: "Final review", hint: "Editor in chief signs off at 18:00" },
  { key: "publicationDay", label: "Publication target", hint: "PDF and DOCX ready by 10:00" },
];

export function CampaignDefaultsForm({ value }: { value: CampaignDefaults }) {
  const tr = useUi();
  const [form, setForm] = useState<CampaignDefaults>(value);
  const { pending, errors, save } = useSave<CampaignDefaults>("campaign_defaults");
  const dirty = JSON.stringify(form) !== JSON.stringify(value);
  const issues = useMemo(() => campaignDefaultsIssues(form), [form]);
  const invalid = Object.keys(issues).length > 0;
  const preview = useMemo(() => {
    const next = nextEditionMonth(new Date());
    return { label: editionLabel(next.month, next.year), schedule: computeCampaignSchedule({ ...next, defaults: form }) };
  }, [form]);
  const setDay = (key: keyof CampaignDefaults, raw: string) => setForm((f) => ({ ...f, [key]: raw === "" ? 0 : Math.max(0, Math.min(28, Number(raw))) }));
  return (
    <SettingsCard id="campaign" title={tr("Monthly schedule")} description={tr("Days of the month (school time, Europe/Paris). Editions created automatically use these defaults; existing campaigns keep their dates.")}>
      <form
        className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]"
        onSubmit={(e) => {
          e.preventDefault();
          if (!invalid) save(form);
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="cd-openHour">{tr("Send time")}</Label>
            <NativeSelect id="cd-openHour" value={form.openHour} onChange={(e) => setForm({ ...form, openHour: Number(e.target.value) })}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </NativeSelect>
            <p className="text-2xs text-muted-foreground">{tr("Requests and reminders go out at this hour.")}</p>
          </div>
          {DAY_FIELDS.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={`cd-${f.key}`}>{tr(f.label)}</Label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{tr("Day")}</span>
                <Input id={`cd-${f.key}`} type="number" min={1} max={28} value={form[f.key]} onChange={(e) => setDay(f.key, e.target.value)} className="tabular w-20" aria-invalid={Boolean(issues[f.key] || errors?.[f.key])} />
              </div>
              <p className="text-2xs text-muted-foreground">{tr(f.hint)}</p>
              {issues[f.key] ? <p className="text-2xs text-destructive">{issues[f.key].join(" · ")}</p> : <FieldError errors={errors} name={f.key} />}
            </div>
          ))}
          <div className="sm:col-span-2">
            <Button type="submit" size="sm" loading={pending} disabled={!dirty || invalid}>
              <Save />{" "}{tr("Save schedule")}</Button>
          </div>
        </div>
        <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
          <div className="label-caps mb-2">{tr("Preview ·")}{" "}{preview.label}</div>
          <ol className="space-y-1.5">
            {[
              ["Request", preview.schedule.opensAt],
              ["Reminder #1", preview.schedule.reminder1At],
              ["Reminder #2", preview.schedule.reminder2At],
              ["Deadline", preview.schedule.deadlineAt],
              ["Grace ends", preview.schedule.graceEndsAt],
              ["Final review", preview.schedule.finalReviewAt],
              ["Publication", preview.schedule.publicationTargetAt],
            ].map(([label, at]) => (
              <li key={label as string} className="flex justify-between gap-2">
                <span className="text-muted-foreground">{label as string}</span>
                <span className="tabular">{formatZoned(at as Date, { weekday: "short" })}</span>
              </li>
            ))}
          </ol>
        </div>
      </form>
    </SettingsCard>
  );
}

export function PrintForm({ value }: { value: PrintSettings }) {
  const tr = useUi();
  const [form, setForm] = useState(value);
  const { pending, errors, save } = useSave<PrintSettings>("print");
  const dirty = JSON.stringify(form) !== JSON.stringify(value);
  return (
    <SettingsCard id="print" title={tr("Print defaults")} description={tr("New editions start with these; each edition can override them in its Settings tab.")}>
      <form
        className="grid gap-3 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          save(form);
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="print-size">{tr("Page size")}</Label>
          <NativeSelect id="print-size" value={form.pageSize} onChange={(e) => setForm({ ...form, pageSize: e.target.value as PrintSettings["pageSize"] })}>
            <option value="A4">{tr("A4 — 210 × 297 mm (any campus printer)")}</option>
            <option value="TABLOID">{tr("Tabloid — 279 × 432 mm (newspaper feel)")}</option>
            <option value="LETTER">{tr("Letter — 216 × 279 mm")}</option>
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="print-pages">{tr("Target page count")}</Label>
          <Input id="print-pages" type="number" min={4} max={96} step={2} value={form.targetPageCount} onChange={(e) => setForm({ ...form, targetPageCount: Number(e.target.value) })} className="tabular" />
          <FieldError errors={errors} name="targetPageCount" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="print-font">{tr("Masthead font")}</Label>
          <Input id="print-font" value={form.mastheadFont ?? ""} onChange={(e) => setForm({ ...form, mastheadFont: e.target.value })} placeholder={tr("Fraunces")} />
        </div>
        <div className="sm:col-span-3">
          <Button type="submit" size="sm" loading={pending} disabled={!dirty}>
            <Save />{" "}{tr("Save print defaults")}</Button>
        </div>
      </form>
    </SettingsCard>
  );
}

export function AiForm({ value, provider, modelFast, modelStrong }: { value: AiSettings; provider: string; modelFast: string; modelStrong: string }) {
  const tr = useUi();
  const [budget, setBudget] = useState(value.monthlyBudgetEur);
  const { pending, errors, save } = useSave<AiSettings>("ai");
  const dirty = budget !== value.monthlyBudgetEur;
  return (
    <SettingsCard id="ai" title={tr("AI")} description={tr("Provider and models come from the environment; the budget is a soft monthly ceiling surfaced in Analytics.")}>
      <form
        className="grid gap-3 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          save({ monthlyBudgetEur: budget, provider });
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="ai-budget">{tr("Monthly budget (EUR)")}</Label>
          <Input id="ai-budget" type="number" min={0} step={5} value={budget} onChange={(e) => setBudget(Number(e.target.value))} className="tabular" />
          <FieldError errors={errors} name="monthlyBudgetEur" />
        </div>
        <div className="space-y-1.5">
          <Label>{tr("Provider")}</Label>
          <Input value={provider === "openai" ? "OpenAI (structured outputs)" : "Local deterministic (no key)"} readOnly disabled />
          <p className="text-2xs text-muted-foreground">{tr("AI_PROVIDER in the environment.")}</p>
        </div>
        <div className="space-y-1.5">
          <Label>{tr("Models")}</Label>
          <Input value={`FAST ${modelFast} · STRONG ${modelStrong}`} readOnly disabled className="font-mono text-xs" />
          <p className="text-2xs text-muted-foreground">{tr("AI_MODEL_FAST / AI_MODEL_STRONG.")}</p>
        </div>
        <div className="sm:col-span-3">
          <Button type="submit" size="sm" loading={pending} disabled={!dirty}>
            <Save />{" "}{tr("Save budget")}</Button>
        </div>
      </form>
    </SettingsCard>
  );
}

const AUTOMATION_LABELS: Record<AutomationKey, { label: string; hint: string }> = {
  editionCreation: { label: "Monthly edition creation", hint: "Creates next month's edition and its campaign from the defaults." },
  contributionRequest: { label: "Contribution request", hint: "Emails personal links on the opening day." },
  reminder1: { label: "Reminder #1", hint: "Friendly nudge to those who have not submitted." },
  reminder2: { label: "Reminder #2", hint: "Last-day reminder." },
  gracePeriod: { label: "Grace period", hint: "Late entries for one more day, then the campaign closes." },
  aiProcessing: { label: "AI processing", hint: "Normalises, classifies and clusters submissions after closing." },
  editorialAlert: { label: "Editorial alert", hint: "Tells editors when processing is done." },
  coverageCheck: { label: "Campus coverage check", hint: "Flags under-represented campuses." },
  deadlineAlert: { label: "Deadline alert", hint: "24 hours before the final review." },
};

export function AutomationsForm({ value }: { value: AutomationToggles }) {
  const tr = useUi();
  const [form, setForm] = useState(value);
  const { pending, save } = useSave<AutomationToggles>("automations");
  const dirty = JSON.stringify(form) !== JSON.stringify(value);
  return (
    <SettingsCard id="automations" title={tr("Automations")} description={tr("Disabled steps are recorded as skipped so nothing runs twice when re-enabled.")} action={<Button size="sm" onClick={() => save(form)} loading={pending} disabled={!dirty}><Save />{" "}{tr("Save toggles")}</Button>}>
      <ul className="divide-y divide-border">
        {AUTOMATION_KEYS.map((key) => (
          <li key={key} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <div className="text-[13px] font-medium">{tr(AUTOMATION_LABELS[key].label)}</div>
              <div className="text-2xs text-muted-foreground">{tr(AUTOMATION_LABELS[key].hint)}</div>
            </div>
            <Switch checked={form[key]} onCheckedChange={(v) => setForm({ ...form, [key]: v })} aria-label={tr(AUTOMATION_LABELS[key].label)} />
          </li>
        ))}
      </ul>
    </SettingsCard>
  );
}
