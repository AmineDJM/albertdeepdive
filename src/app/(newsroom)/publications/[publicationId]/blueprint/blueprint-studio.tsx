"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, FileUp, Palette, Sparkles, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SettingsCard } from "@/components/settings/key-value";
import { adoptBlueprintAction, designFromBrandAction, readBlueprintAction } from "./actions";
import type { BlueprintProposal } from "@/server/design/blueprint/service";
import { BLUEPRINT_ACCEPT, paperName } from "@/lib/design/blueprint";
import { useUi } from "@/components/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * The model a newsletter is made on.
 *
 * Two ways in, because there are two kinds of customer. One has published for years and has last
 * month's PDF on their desktop: they want the next issue to be recognisably the same publication,
 * and the fastest honest route is to read what they already have. The other has never published
 * anything and has a brand: they want something that looks like their company, composed for them.
 *
 * Both end at the same screen — here is what Briefly understood, here is what it will do with it —
 * and nothing is written until somebody says so. Reading a file is not agreeing to it.
 */

type Rubric = BlueprintProposal["rubrics"][number];

export function BlueprintStudio({
  publicationId,
  publicationName,
  current,
  firstEditionId,
}: {
  publicationId: string;
  publicationName: string;
  /** What the title is made on today, when anybody has said. */
  current: { kind: string; fileName: string | null; summary: string; at: string | null; rubrics: string[] } | null;
  /** An edition to look at it on, when the title has one. */
  firstEditionId: string | null;
}) {
  const tr = useUi();
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [proposal, setProposal] = useState<BlueprintProposal | null>(null);
  const [rubrics, setRubrics] = useState<Rubric[]>([]);
  const [reading, startReading] = useTransition();
  const [adopting, startAdopting] = useTransition();

  function take(next: BlueprintProposal) {
    setProposal(next);
    setRubrics(next.rubrics);
  }

  function read(file: File) {
    const body = new FormData();
    body.set("publicationId", publicationId);
    body.set("file", file);
    startReading(async () => {
      const result = await readBlueprintAction(body);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      take(result.data);
    });
  }

  function fromBrand() {
    startReading(async () => {
      // The pieces Briefly composes well, named in the interface's own language rather than
      // invented by a model: a starting point somebody renames, not a claim about their title.
      const starting = [
        { name: tr("Editor's note"), component: "editors-note" as const },
        { name: tr("The numbers"), component: "numbers" as const },
        { name: tr("People"), component: "people" as const },
        { name: tr("What is coming"), component: "upcoming-events" as const },
      ];
      const result = await designFromBrandAction(publicationId, starting);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      take(result.data);
    });
  }

  function adopt() {
    if (!proposal) return;
    startAdopting(async () => {
      const result = await adoptBlueprintAction(publicationId, { ...proposal, rubrics: rubrics.filter((rubric) => rubric.name.trim()) });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      setProposal(null);
      router.refresh();
    });
  }

  const page = proposal?.evidence.page ?? null;
  const colours = (proposal?.evidence.colours ?? []).slice(0, 6);

  return (
    <div className="space-y-4">
      {current ? (
        <SettingsCard
          title={tr("What this newsletter is made on")}
          description={
            current.kind === "uploaded" && current.fileName
              ? tr("Read from {file}.", { file: current.fileName })
              : current.kind === "brand"
                ? tr("Designed from your brand.")
                : tr("Set by hand.")
          }
        >
          {current.summary ? <p className="text-[13px]">{current.summary}</p> : null}
          {current.rubrics.length ? (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {current.rubrics.map((name) => (
                <li key={name}>
                  <Badge variant="outline">{name}</Badge>
                </li>
              ))}
            </ul>
          ) : null}
        </SettingsCard>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          disabled={reading}
          onClick={() => fileInput.current?.click()}
          data-testid="blueprint-upload"
          className={cn(
            "flex flex-col items-start gap-1.5 rounded-xl border border-dashed border-border bg-card p-4 text-left transition-colors hover:border-brand/60 hover:bg-brand-soft/20 disabled:opacity-60",
          )}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.files?.[0];
            if (file) read(file);
          }}
        >
          <span className="flex items-center gap-2 text-[13px] font-semibold">
            <FileUp className="size-4" /> {tr("Use a newsletter I already have")}
          </span>
          <span className="text-2xs text-muted-foreground">
            {tr("Drop a PDF, a Word file, a PowerPoint, an email export or a picture of a page. Briefly keeps the look and the rubrics, and throws the words away.")}
          </span>
        </button>
        <input
          ref={fileInput}
          type="file"
          accept={BLUEPRINT_ACCEPT}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) read(file);
            event.target.value = "";
          }}
        />

        <button
          type="button"
          disabled={reading}
          onClick={fromBrand}
          data-testid="blueprint-from-brand"
          className="flex flex-col items-start gap-1.5 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-brand/60 hover:bg-brand-soft/20 disabled:opacity-60"
        >
          <span className="flex items-center gap-2 text-[13px] font-semibold">
            <Sparkles className="size-4" /> {tr("Design one from my brand")}
          </span>
          <span className="text-2xs text-muted-foreground">{tr("No file. Briefly composes a model from your colours, your type and how your brand reads.")}</span>
        </button>
      </div>

      {reading ? <p className="text-xs text-muted-foreground">{tr("Reading it…")}</p> : null}

      {proposal ? (
        <SettingsCard
          title={tr("What Briefly understood")}
          description={
            proposal.readBy === "model"
              ? tr("Read from the file and from looking at the pages.")
              : tr("Measured from the file. Nothing here was guessed.")
          }
        >
          <div className="space-y-3">
            {proposal.summary ? <p className="text-[13px]">{proposal.summary}</p> : null}

            <dl className="grid gap-2 text-xs sm:grid-cols-3">
              {page ? (
                <div>
                  <dt className="font-medium text-muted-foreground">{tr("Page")}</dt>
                  <dd className="text-[13px]">{paperName(page.widthPt, page.heightPt) ?? `${Math.round(page.widthPt)} × ${Math.round(page.heightPt)} pt`}</dd>
                </div>
              ) : null}
              {proposal.brand?.fonts.heading ? (
                <div className="min-w-0">
                  <dt className="font-medium text-muted-foreground">{tr("Type")}</dt>
                  <dd className="truncate text-[13px]">{[proposal.brand.fonts.heading, proposal.brand.fonts.body].filter(Boolean).join(" · ")}</dd>
                </div>
              ) : null}
              <div>
                <dt className="font-medium text-muted-foreground">{tr("How sure")}</dt>
                <dd className="text-[13px]">{proposal.confidence === "high" ? tr("Very") : proposal.confidence === "medium" ? tr("Fairly") : tr("Not very — say so if it is wrong")}</dd>
              </div>
            </dl>

            {colours.length ? (
              <div>
                <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Palette className="size-3.5" /> {tr("Colours it uses")}
                </p>
                <ul className="flex flex-wrap gap-1.5" data-testid="blueprint-colours">
                  {colours.map((colour) => (
                    <li key={colour.hex} className="flex items-center gap-1.5 rounded-md border border-border px-1.5 py-1">
                      <span className="size-4 rounded-sm border border-border/60" style={{ background: colour.hex }} aria-hidden="true" />
                      <span className="tabular text-2xs text-muted-foreground">{colour.hex}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">{tr("The rubrics it runs every month")}</p>
              {rubrics.length ? (
                <ul className="space-y-1" data-testid="blueprint-rubrics">
                  {rubrics.map((rubric, at) => (
                    <li key={`${rubric.name}-${at}`} className="flex items-center gap-2">
                      <Input
                        value={rubric.name}
                        onChange={(event) => setRubrics((list) => list.map((one, index) => (index === at ? { ...one, name: event.target.value } : one)))}
                        aria-label={tr("Rubric name")}
                        className="h-8 w-full sm:w-72"
                      />
                      {rubric.purpose ? <span className="hidden truncate text-2xs text-muted-foreground sm:block">{rubric.purpose}</span> : null}
                      <Button type="button" size="sm" variant="ghost" onClick={() => setRubrics((list) => list.filter((_, index) => index !== at))}>
                        {tr("Remove")}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">{tr("None were found. You can add them later on the newsletter.")}</p>
              )}
            </div>

            {proposal.notes.length ? (
              <ul className="space-y-0.5">
                {proposal.notes.map((note) => (
                  <li key={note} className="text-2xs text-muted-foreground">
                    {note}
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button loading={adopting} onClick={adopt} data-testid="blueprint-adopt">
                <Check /> {tr("Make {name} on this", { name: publicationName })}
              </Button>
              <Button variant="ghost" disabled={adopting} onClick={() => setProposal(null)}>
                {tr("Throw it away")}
              </Button>
              {firstEditionId ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/editions/${firstEditionId}/design`}>
                    <Upload className="rotate-180" /> {tr("See it on an edition")}
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>
        </SettingsCard>
      ) : null}
    </div>
  );
}
