"use client";

import { useMemo, useState } from "react";
import { Check, Globe, MousePointerClick, Sparkles } from "lucide-react";
import type { DiscoveredOrganization } from "@/server/tenancy/discovery";
import type { WorkspaceInput } from "./actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useUi } from "@/components/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * What the reading pass found, next to what is already saved.
 *
 * Nothing here applies itself. A field the workspace has not answered yet is ticked, because
 * filling a blank costs nobody anything; a field that already has an answer is shown, unticked,
 * with the current value beside it — replacing somebody's own words with a sentence scraped off
 * their marketing site is exactly the surprise this screen exists to avoid. The logo is not even
 * proposed: the candidates are shown as pictures and a person points at the right one, because
 * only they know which of the six marks in their header is theirs.
 */

function Thumb({ src, selected, onPick, label }: { src: string; selected: boolean; onPick: () => void; label: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label={label}
      aria-pressed={selected}
      className={cn(
        "relative flex h-16 w-24 shrink-0 items-center justify-center rounded-md border bg-card p-2 transition",
        selected ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-foreground/30",
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="max-h-full max-w-full object-contain" onError={() => setFailed(true)} />
      {selected ? <Check className="absolute -right-1.5 -top-1.5 size-4 rounded-full bg-primary p-0.5 text-primary-foreground" /> : null}
    </button>
  );
}

type Row = { key: keyof WorkspaceInput; label: string; found: string; current: string };

export function WebsiteReading({
  reading,
  current,
  onApply,
}: {
  reading: DiscoveredOrganization;
  current: WorkspaceInput;
  onApply: (patch: Partial<WorkspaceInput>) => void;
}) {
  const tr = useUi();
  const value = (key: keyof WorkspaceInput) => String(current[key] ?? "").trim();

  const rows = useMemo<Row[]>(() => {
    const saved = (key: keyof WorkspaceInput) => String(current[key] ?? "").trim();
    const proposals: [keyof WorkspaceInput, string, string | number | null][] = [
      ["name", tr("Name"), reading.name],
      ["headline", tr("Headline"), reading.headline],
      ["description", tr("Description"), reading.description],
      ["type", tr("Kind of organisation"), reading.type],
      ["industry", tr("Industry"), reading.industry],
      ["legalName", tr("Legal name"), reading.legalName],
      ["foundedYear", tr("Founded"), reading.foundedYear],
      ["email", tr("Contact email"), reading.email],
      ["telephone", tr("Telephone"), reading.telephone],
      ["address", tr("Address"), reading.address],
      ["country", tr("Country"), reading.country],
      ["linkedin", "LinkedIn", reading.links.linkedin ?? null],
      ["instagram", "Instagram", reading.links.instagram ?? null],
      ["x", "X", reading.links.x ?? null],
      ["youtube", "YouTube", reading.links.youtube ?? null],
      ["facebook", "Facebook", reading.links.facebook ?? null],
    ];
    return proposals
      .map(([key, label, found]) => ({ key, label, found: found == null ? "" : String(found), current: saved(key) }))
      .filter((row) => row.found && row.found !== row.current);
  }, [reading, current, tr]);

  const [picked, setPicked] = useState<Set<string>>(() => new Set(rows.filter((row) => !row.current).map((row) => String(row.key))));
  const [logo, setLogo] = useState<string | null>(null);
  const [colours, setColours] = useState(false);

  const toggle = (key: string) =>
    setPicked((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const apply = () => {
    const patch: Partial<WorkspaceInput> = {};
    for (const row of rows) {
      if (!picked.has(String(row.key))) continue;
      (patch as Record<string, string>)[row.key as string] = row.found;
    }
    if (logo) patch.logoUrl = logo;
    if (colours && reading.colours.length) {
      patch.primary = reading.colours[0];
      if (reading.colours[1]) patch.accent = reading.colours[1];
    }
    if (reading.faviconUrl && !value("faviconUrl")) patch.faviconUrl = reading.faviconUrl;
    onApply(patch);
  };

  const nothing = !rows.length && !reading.logoCandidates.length && !reading.colours.length;
  const chosen = picked.size + (logo ? 1 : 0) + (colours ? 1 : 0);

  return (
    <div className="space-y-4 rounded-lg border border-primary/30 bg-primary/[0.03] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="label-caps flex-1">{tr("What we read on your website")}</p>
        <Badge variant="muted" className="gap-1">
          <Globe className="size-3" />
          {reading.readBy === "browser" ? tr("Opened in a browser") : tr("Read from the page source")}
        </Badge>
        <Badge variant="muted" className="gap-1">
          <Sparkles className="size-3" />
          {reading.understoodBy === "model" ? tr("Understood by a model") : tr("Matched by rules")}
        </Badge>
      </div>

      {nothing ? (
        <p className="text-xs text-muted-foreground">{tr("Your website gave us nothing we do not already have. Everything below is yours to fill in by hand.")}</p>
      ) : null}

      {reading.logoCandidates.length ? (
        <div className="space-y-2">
          <p className="text-xs font-medium">{tr("Which of these is your logo?")}</p>
          <div className="flex flex-wrap gap-2">
            {reading.logoCandidates.map((candidate) => (
              <Thumb key={candidate.url} src={candidate.url} selected={logo === candidate.url} onPick={() => setLogo(logo === candidate.url ? null : candidate.url)} label={candidate.alt || candidate.url} />
            ))}
          </div>
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <MousePointerClick className="mt-0.5 size-3 shrink-0" />
            {reading.markIsInline
              ? tr("The mark in your header is drawn into the page, so there is no address to point at. Pick one of these, or paste your own below.")
              : tr("Pick one, or paste your own address below. Nothing is chosen for you.")}
          </p>
        </div>
      ) : null}

      {reading.colours.length ? (
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <Checkbox checked={colours} onCheckedChange={() => setColours((c) => !c)} />
          <span>{tr("Use these colours")}</span>
          <span className="flex gap-1">
            {reading.colours.map((colour) => (
              <span key={colour} className="size-4 rounded border border-black/10" style={{ backgroundColor: colour }} title={colour} />
            ))}
          </span>
        </label>
      ) : null}

      {rows.length ? (
        <ul className="divide-y divide-border rounded-md border border-border bg-card">
          {rows.map((row) => (
            <li key={String(row.key)} className="flex items-start gap-3 px-3 py-2">
              <Checkbox className="mt-0.5" checked={picked.has(String(row.key))} onCheckedChange={() => toggle(String(row.key))} id={`read-${String(row.key)}`} />
              <label htmlFor={`read-${String(row.key)}`} className="min-w-0 flex-1 cursor-pointer">
                <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">{row.label}</span>
                <span className="block break-words text-[13px]">{row.found}</span>
                {row.current ? (
                  <span className="block break-words text-xs text-muted-foreground line-through">{row.current}</span>
                ) : null}
              </label>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={apply} disabled={!chosen}>
          {tr("Fill these in")}
        </Button>
        <p className="text-xs text-muted-foreground">{tr("Nothing is saved until you press Save. Every field stays editable.")}</p>
      </div>
    </div>
  );
}
