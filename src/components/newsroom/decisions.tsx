"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, Plus } from "lucide-react";
import { toast } from "sonner";
import { updateEditionAction } from "@/app/(newsroom)/editions/actions";
import { toggleOutputAction } from "@/app/(newsroom)/editions/[editionId]/output-actions";
import { updatePublicationAction } from "@/app/(newsroom)/publications/actions";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useUi } from "@/components/i18n/provider";
import type { OutputFormat } from "@/server/outputs/service";

/**
 * A decision, in one line: what it is, what Briefly chose, and "Change".
 *
 * The Standard edition overview is a short list of these. Each carries the whole decision — the
 * value is the value, not a summary of a screen — so a person reads down the list and changes only
 * what they disagree with. `Change` is a link when the decision lives on another screen and a
 * control when it can be made here, and it is left out for a reader who may not make it.
 */
export function Decision({ label, value, hint, change, tone = "default", children }: { label: string; value: React.ReactNode; hint?: React.ReactNode; change?: { href: string; label?: string } | null; tone?: "default" | "ready" | "attention"; children?: React.ReactNode }) {
  const tr = useUi();
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <span className="w-[112px] shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      <span className={cn("flex min-w-0 flex-1 flex-wrap items-center gap-2 text-[13px]", tone === "attention" && "text-warning", tone === "ready" && "text-foreground")}>
        {tone === "ready" ? <Check className="size-3.5 text-success" aria-hidden="true" /> : null}
        {typeof value === "string" ? <span className="min-w-0 truncate font-medium">{value}</span> : <span className="min-w-0 font-medium">{value}</span>}
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {children}
        {change ? (
          <Link href={change.href} className="rounded-md px-2 py-1 text-xs font-medium text-brand transition-colors duration-150 hover:bg-brand-soft">
            {change.label ?? tr("Change")}
          </Link>
        ) : null}
      </span>
    </li>
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
  const [value, setValue] = useState(toInputDate(current));
  if (locked) return null;
  function save(next: string) {
    setValue(next);
    if (!next) return;
    start(async () => {
      const res = await updateEditionAction(editionId, { publicationTargetAt: new Date(`${next}T10:00:00`) });
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(tr("Publish date changed"));
        router.refresh();
      }
    });
  }
  return (
    <label className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-brand transition-colors duration-150 hover:bg-brand-soft">
      <span>{tr("Change")}</span>
      <input type="date" value={value} onChange={(e) => save(e.target.value)} disabled={pending} aria-label={tr("Publish date")} className="w-[1px] opacity-0" />
    </label>
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
