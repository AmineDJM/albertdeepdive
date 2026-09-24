"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCircle2, Circle, CircleDashed, ExternalLink, Plus } from "lucide-react";
import { toast } from "sonner";
import { setEditionToneAction, updateEditionAction } from "@/app/(newsroom)/editions/actions";
import { toggleOutputAction } from "@/app/(newsroom)/editions/[editionId]/output-actions";
import { updatePublicationAction } from "@/app/(newsroom)/publications/actions";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useUi } from "@/components/i18n/provider";
import type { OutputFormat } from "@/server/outputs/service";

/**
 * A decision, in one line: where it stands, what Briefly chose, and "Configure".
 *
 * The edition's table is a short list of these, and it is the hub of the edition: every row that
 * needs a screen opens it, and that screen's Back comes back here. The mark on the left says at a
 * glance what is settled (green) and what still needs somebody (orange), so the table is also the
 * to-do list. A decision that can be made in one gesture — the language, the date, the formats,
 * the tone — is made in place, without leaving.
 */
export type DecisionStatus = "done" | "todo" | "info";

export function Decision({ label, value, hint, change, status = "info", children }: { label: string; value: React.ReactNode; hint?: React.ReactNode; change?: { href: string; label?: string } | null; status?: DecisionStatus; children?: React.ReactNode }) {
  const tr = useUi();
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" data-status={status}>
      <span className="flex w-[132px] shrink-0 items-center gap-2 text-xs font-medium text-muted-foreground">
        {status === "done" ? (
          <CheckCircle2 className="size-4 shrink-0 text-success" aria-label={tr("Set")} />
        ) : status === "todo" ? (
          <CircleDashed className="size-4 shrink-0 text-warning" aria-label={tr("To configure")} />
        ) : (
          <Circle className="size-4 shrink-0 text-muted-foreground/40" aria-hidden="true" />
        )}
        {label}
      </span>
      <span className={cn("flex min-w-0 flex-1 flex-wrap items-center gap-2 text-[13px]", status === "todo" && "text-warning")}>
        {typeof value === "string" ? <span className="min-w-0 truncate font-medium">{value}</span> : <span className="min-w-0 font-medium">{value}</span>}
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {children}
        {change ? (
          <Link href={change.href} className={cn("rounded-md px-2 py-1 text-xs font-medium transition-colors duration-150", status === "todo" ? "bg-warning-soft text-warning hover:bg-warning/15" : "text-brand hover:bg-brand-soft")}>
            {change.label ?? tr("Configure")}
          </Link>
        ) : null}
      </span>
    </li>
  );
}

const TONES = ["plain", "warm", "precise", "confident", "playful", "formal"] as const;

/** The tone, changed here: up to three words, saved as they are ticked. */
export function ToneChange({ editionId, current }: { editionId: string; current: string[] }) {
  const tr = useUi();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const words: Record<(typeof TONES)[number], string> = { plain: tr("plain"), warm: tr("warm"), precise: tr("precise"), confident: tr("confident"), playful: tr("playful"), formal: tr("formal") };
  function toggle(word: string) {
    const next = current.includes(word) ? current.filter((w) => w !== word) : [...current, word].slice(-3);
    if (!next.length) return;
    start(async () => {
      const res = await setEditionToneAction(editionId, next);
      if (!res.ok) toast.error(res.error);
      else router.refresh();
    });
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" disabled={pending} data-testid="tone-change" className="rounded-md px-2 py-1 text-xs font-medium text-brand transition-colors duration-150 hover:bg-brand-soft disabled:opacity-60">
          {tr("Change")}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-1">
        <p className="px-2 py-1.5 text-2xs text-muted-foreground">{tr("Up to three words")}</p>
        {TONES.map((word) => (
          <button key={word} type="button" disabled={pending} onClick={() => toggle(word)} className={cn("flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[13px] capitalize hover:bg-muted", current.includes(word) && "font-medium")}>
            {words[word]}
            {current.includes(word) ? <Check className="size-3.5 text-brand" /> : null}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
] as const;

/** The language of the title this edition belongs to. Changing it changes the title, on purpose. */
export function LanguageChange({ publicationId, current }: { publicationId: string; current: string }) {
  const tr = useUi();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  function choose(code: "en" | "fr") {
    setOpen(false);
    if (code === current) return;
    start(async () => {
      const res = await updatePublicationAction(publicationId, { language: code });
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(tr("Language changed"));
        router.refresh();
      }
    });
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" disabled={pending} className="rounded-md px-2 py-1 text-xs font-medium text-brand transition-colors duration-150 hover:bg-brand-soft disabled:opacity-60">
          {tr("Change")}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-1">
        {LANGUAGES.map((lang) => (
          <button key={lang.code} type="button" onClick={() => choose(lang.code)} className={cn("flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[13px] hover:bg-muted", lang.code === current && "font-medium")}>
            {lang.label}
            {lang.code === current ? <Check className="size-3.5 text-brand" /> : null}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function toInputDate(date: Date | null): string {
  if (!date) return "";
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The day the edition goes out. A date field, nothing to open. */
export function PublishDateChange({ editionId, current, locked }: { editionId: string; current: Date | null; locked: boolean }) {
  const tr = useUi();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(toInputDate(current));
  if (locked) return null;
  /*
   * A field you can see, rather than a calendar you have to summon.
   *
   * "Change" used to be a label wrapping a date input one pixel wide and fully transparent. The
   * click focused it and nothing happened: a browser opens its date picker when the calendar
   * button is pressed or a key is typed, never because an invisible field took focus. So the
   * control did nothing at all, which is the worst thing a control can do.
   */
  function save() {
    if (!value) return;
    start(async () => {
      const res = await updateEditionAction(editionId, { publicationTargetAt: new Date(`${value}T10:00:00`) });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setOpen(false);
      toast.success(tr("Publish date changed"));
      router.refresh();
    });
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="rounded-md px-2 py-1 text-xs font-medium text-brand transition-colors duration-150 hover:bg-brand-soft">
          {tr("Change")}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 space-y-2 p-3">
        <label className="block text-xs font-medium text-muted-foreground" htmlFor={`publish-date-${editionId}`}>
          {tr("Publish date")}
        </label>
        <input
          id={`publish-date-${editionId}`}
          type="date"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={pending}
          className="tabular h-8 w-full rounded-md border border-border bg-background px-2 text-[13px] focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        />
        <Button size="sm" className="w-full" disabled={!value} loading={pending} onClick={save}>
          {tr("Save")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

export type OutputChoice = { format: OutputFormat; label: string; enabled: boolean; locked: boolean; publicUrl: string | null };

/**
 * Where the edition goes: the formats that are on, a tick each, and "+ Add format" for the rest.
 * A format already published stays as it is; it went out, and that is part of the record.
 */
export function OutputsChange({ editionId, outputs, canEdit }: { editionId: string; outputs: OutputChoice[]; canEdit: boolean }) {
  const tr = useUi();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<OutputFormat | null>(null);
  const off = outputs.filter((o) => !o.enabled);
  function toggle(format: OutputFormat, enabled: boolean) {
    setBusy(format);
    start(async () => {
      const res = await toggleOutputAction(editionId, format, enabled);
      setBusy(null);
      if (!res.ok) toast.error(res.error);
      else router.refresh();
    });
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {outputs
        .filter((o) => o.enabled)
        .map((o) => (
          <span key={o.format} className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/60 px-2 py-0.5 text-xs font-medium">
            <Check className="size-3 text-success" aria-hidden="true" />
            {o.label}
            {o.publicUrl ? (
              <a href={o.publicUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" aria-label={tr("Open the web page")}>
                <ExternalLink className="size-3" />
              </a>
            ) : null}
            {canEdit && !o.locked ? (
              <button type="button" onClick={() => toggle(o.format, false)} disabled={pending && busy === o.format} className="ml-0.5 text-muted-foreground hover:text-foreground" aria-label={tr("Remove {format}", { format: o.label })}>
                ×
              </button>
            ) : null}
          </span>
        ))}
      {outputs.every((o) => !o.enabled) ? <span className="text-xs text-muted-foreground">{tr("none chosen yet")}</span> : null}
      {canEdit && off.length ? (
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium text-brand transition-colors duration-150 hover:bg-brand-soft">
              <Plus className="size-3" /> {tr("Add format")}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-48 p-1">
            {off.map((o) => (
              <button key={o.format} type="button" onClick={() => toggle(o.format, true)} disabled={pending} className="flex w-full items-center rounded-md px-2 py-1.5 text-[13px] hover:bg-muted disabled:opacity-60">
                {o.label}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      ) : null}
    </span>
  );
}
