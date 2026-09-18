"use client";

import { ArrowDownWideNarrow, Ellipsis, GripVertical, Info, Lock, LockOpen, Scissors, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CoverThumbnail } from "@/components/newsroom/cover-thumbnail";
import type { FlatplanPage, FlatplanTemplate } from "@/server/publication/flatplan";
import { cn } from "@/lib/utils";
import { useUi } from "@/components/i18n/provider";

/**
 * One page of the flatplan: a paper-proportioned thumbnail showing what the print engine will put on
 * the page (lead photo, kicker, headline, text density), with the controls that change the plan.
 */

const PAPER = "bg-[#fcfcfa] dark:bg-[#ece9e2]";
const INK = "text-[#10203a]";
const INK_SOFT = "text-[#5b6472]";

export type FlatplanPageCardProps = {
  page: FlatplanPage;
  editionLabel: string;
  issueLabel: string;
  templates: FlatplanTemplate[];
  canEdit: boolean;
  pending?: boolean;
  selected?: boolean;
  dragging?: boolean;
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
  dragHandleRef?: (node: HTMLButtonElement | null) => void;
  onTemplateChange?: (template: string) => void;
  onToggleLock?: () => void;
  onOpen?: () => void;
};

export function FlatplanPageCard({
  page,
  editionLabel,
  issueLabel,
  templates,
  canEdit,
  pending = false,
  selected = false,
  dragging = false,
  dragHandleProps,
  dragHandleRef,
  onTemplateChange,
  onToggleLock,
  onOpen,
}: FlatplanPageCardProps) {
  const tr = useUi();
  const errors = page.warnings.filter((w) => w.severity === "error");
  const warnings = page.warnings.filter((w) => w.severity === "warning");
  const infos = page.warnings.filter((w) => w.severity === "info");
  const engineMade = page.kind === "engine-continuation";
  const families = [...new Set(templates.map((t) => t.family))];
  const fillTone = page.overflow ? "bg-destructive" : page.fill >= 0.9 ? "bg-success" : page.fill >= 0.55 ? "bg-brand" : "bg-warning";
  const hasFill = page.fill > 0 || page.items.length > 0;

  return (
    <div
      id={`page-${page.number}`}
      className={cn(
        "flex scroll-mt-24 flex-col rounded-lg border bg-card shadow-xs transition-shadow",
        selected ? "border-brand ring-2 ring-brand/30" : "border-border",
        engineMade && "border-dashed bg-muted/30",
        dragging && "z-20 opacity-90 shadow-lg ring-2 ring-brand/40",
        pending && "opacity-60",
      )}
    >
      {/* ── header ── */}
      <div className="flex items-center gap-1 border-b border-border px-1.5 py-1">
        {canEdit && !engineMade && !page.isPlanContinuation ? (
          <button
            ref={dragHandleRef}
            type="button"
            className="flex size-5 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing"
            aria-label={`Reorder page ${page.number}`}
            {...dragHandleProps}
          >
            <GripVertical className="size-3.5" />
          </button>
        ) : (
          <span className="size-5 shrink-0" />
        )}
        <span className="flex min-w-0 flex-1 items-center gap-1">
          {page.section?.colour ? <span className="size-2 shrink-0 rounded-[2px]" style={{ background: page.section.colour }} /> : null}
          <span className="truncate text-2xs font-medium text-muted-foreground">{page.section?.name ?? "No section"}</span>
        </span>
        {page.fitLevel > 0 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center text-2xs text-muted-foreground" aria-label={`Copyfit level ${page.fitLevel}`}>
                <ArrowDownWideNarrow className="size-3" />
                {page.fitLevel}
              </span>
            </TooltipTrigger>
            <TooltipContent>{tr("Copyfit: the type was shrunk")}{" "}{page.fitLevel}{" "}{tr("step")}{page.fitLevel === 1 ? "" : "s"} ({(page.fitLevel * 2.5).toFixed(1)}{" "}{tr("%) so the text fits")}</TooltipContent>
          </Tooltip>
        ) : null}
        {page.isLocked ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-brand" aria-label={tr("Locked page")}>
                <Lock className="size-3" />
              </span>
            </TooltipTrigger>
            <TooltipContent>{tr("Locked: re-planning keeps this page and its story here")}</TooltipContent>
          </Tooltip>
        ) : null}
        <span className="tabular shrink-0 pl-0.5 text-[13px] font-semibold">{page.number}</span>
      </div>

      {/* ── the page itself ── */}
      <button
        type="button"
        onClick={onOpen}
        className="group relative block w-full cursor-pointer text-left focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
        aria-label={`Open page ${page.number} (${page.templateName})`}
      >
        <PageSheet page={page} editionLabel={editionLabel} issueLabel={issueLabel} />
        <span className="absolute top-1 right-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <span className="inline-flex size-5 items-center justify-center rounded bg-background/90 text-muted-foreground shadow-xs">
            <Ellipsis className="size-3.5" />
          </span>
        </span>
        {engineMade ? (
          <span className="absolute top-1 left-1 inline-flex items-center gap-1 rounded-sm bg-foreground/80 px-1 py-0.5 text-2xs font-medium text-background">
            <Scissors className="size-2.5" />{" "}{tr("from p.")}{" "}{page.continuationOfNumber ?? "?"}
          </span>
        ) : null}
      </button>

      {/* ── footer ── */}
      <div className="space-y-1 border-t border-border px-1.5 py-1.5">
        <div className="flex items-center gap-1">
          {canEdit && !engineMade && onTemplateChange ? (
            <Select value={page.template} onValueChange={onTemplateChange} disabled={pending}>
              <SelectTrigger size="sm" className="h-6 min-w-0 flex-1 truncate border-transparent bg-muted/60 px-1.5 text-2xs hover:bg-muted" aria-label={`Template of page ${page.number}`}>
                <SelectValue placeholder={tr("Template")} />
              </SelectTrigger>
              <SelectContent>
                {families.map((family) => (
                  <SelectGroup key={family}>
                    <SelectLabel className="capitalize">{family}</SelectLabel>
                    {templates
                      .filter((t) => t.family === family)
                      .map((t) => (
                        <SelectItem key={t.code} value={t.code} className="text-xs">
                          <span className="flex flex-col gap-0.5">
                            <span>{t.name}</span>
                            <span className="text-2xs text-muted-foreground">
                              ≈ {t.capacityWords}{" "}{tr("words ·")}{" "}{t.imageSlots}{" "}{tr("image")}{t.imageSlots === 1 ? "" : "s"}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Badge variant="muted" className="min-w-0 flex-1 justify-start truncate">
              {page.templateName}
            </Badge>
          )}
          {canEdit && !engineMade && onToggleLock ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={onToggleLock}
                  disabled={pending}
                  aria-label={page.isLocked ? `Unlock page ${page.number}` : `Lock page ${page.number}`}
                  aria-pressed={page.isLocked}
                  className={cn(page.isLocked && "text-brand")}
                >
                  {page.isLocked ? <Lock /> : <LockOpen />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{page.isLocked ? "Unlock this page" : "Lock this page so re-planning cannot move it"}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          {hasFill ? (
            <>
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted" role="presentation">
                <span className={cn("block h-full rounded-full", fillTone)} style={{ width: `${Math.min(100, Math.round(page.fill * 100))}%` }} />
              </span>
              <span className={cn("tabular text-2xs", page.overflow ? "font-semibold text-destructive" : "text-muted-foreground")}>{Math.round(page.fill * 100)}%</span>
            </>
          ) : (
            <span className="flex-1 text-2xs text-muted-foreground">{tr("No flowing text")}</span>
          )}
          {errors.length ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-0.5 text-2xs font-semibold text-destructive">
                  <TriangleAlert className="size-3" />
                  {errors.length}
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{errors[0].message}</TooltipContent>
            </Tooltip>
          ) : null}
          {warnings.length ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-0.5 text-2xs font-semibold text-warning">
                  <TriangleAlert className="size-3" />
                  {warnings.length}
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{warnings[0].message}</TooltipContent>
            </Tooltip>
          ) : null}
          {!errors.length && !warnings.length && infos.length ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-0.5 text-2xs text-muted-foreground">
                  <Info className="size-3" />
                  {infos.length}
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{infos[0].message}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** The paper: a schematic of what the template puts on the page, using the real lead photo and headline. */
function PageSheet({ page, editionLabel, issueLabel }: { page: FlatplanPage; editionLabel: string; issueLabel: string }) {
  const tr = useUi();
  const lead = page.images[0] ?? null;
  const item = page.items[0] ?? null;

  if (page.template === "COVER_A" || page.template === "COVER_B") {
    return (
      <div className="p-1.5">
        <CoverThumbnail url={lead?.url ?? null} label={editionLabel} issueLabel={issueLabel} headline={item?.headline ?? null} />
      </div>
    );
  }

  const gallery = page.imageSlots >= 3 || page.template === "PHOTO_STORY";
  const columns = page.templateFamily === "article" && page.capacityWords >= 860 ? 3 : page.template === "SHORTS" || page.template === "NEWS_GRID" ? 2 : page.templateFamily === "front" ? 1 : 2;
  const density = Math.max(0, Math.min(1, page.fill || 0.2));
  const lines = Math.max(3, Math.round(density * 26));

  return (
    <div className="p-1.5">
      <div className={cn("relative flex aspect-[210/297] flex-col gap-1 overflow-hidden rounded-sm border border-border/70 p-2 shadow-inner", PAPER)}>
        <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: page.section?.colour ?? "#10203a" }} />
        {page.continuationOfNumber ? <div className={cn("mt-1 text-[6px] font-semibold tracking-[0.1em] uppercase", INK_SOFT)}>{tr("Continued from page")}{" "}{page.continuationOfNumber}</div> : null}
        {lead ? (
          <figure className={cn("relative mt-1 w-full shrink-0 overflow-hidden rounded-[2px] bg-black/5", gallery ? "aspect-[3/2]" : "aspect-[4/3]")}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lead.url ?? ""} alt="" className="size-full object-cover" loading="lazy" />
            {lead.rightsStatus !== "GREEN" ? (
              <span
                className={cn(
                  "absolute top-0.5 left-0.5 rounded-[2px] px-1 text-[6px] font-bold tracking-wider text-white uppercase",
                  lead.rightsStatus === "RED" ? "bg-destructive" : "bg-warning",
                )}
              >
                {lead.rightsStatus}
              </span>
            ) : null}
          </figure>
        ) : null}
        {gallery && page.images.length > 1 ? (
          <div className="grid shrink-0 grid-cols-3 gap-0.5">
            {page.images.slice(1, 4).map((image) => (
              <span key={image.id} className={cn("relative block aspect-[4/3] overflow-hidden rounded-[2px] bg-black/5", image.rightsStatus === "RED" && "ring-1 ring-destructive")}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.url ?? ""} alt="" className="size-full object-cover" loading="lazy" />
              </span>
            ))}
          </div>
        ) : null}
        {item ? (
          <div className="mt-0.5 shrink-0">
            {item.kicker ? <div className={cn("truncate text-[6px] font-semibold tracking-[0.1em] uppercase", INK_SOFT)}>{item.kicker}</div> : null}
            <div className={cn("font-display line-clamp-3 text-[9px] leading-[1.15] font-semibold", INK)}>{item.headline}</div>
          </div>
        ) : (
          <div className={cn("mt-0.5 line-clamp-2 text-[8px] font-semibold", INK_SOFT)}>{page.templateName}</div>
        )}
        <div className={cn("grid min-h-0 flex-1 gap-1.5 overflow-hidden pt-0.5", columns === 3 ? "grid-cols-3" : columns === 2 ? "grid-cols-2" : "grid-cols-1")}>
          {Array.from({ length: columns }).map((_, col) => (
            <div key={col} className="space-y-[3px]">
              {Array.from({ length: Math.ceil(lines / columns) }).map((_, i) => (
                <span key={i} className="block h-[2px] rounded-full bg-[#10203a]/15" style={{ width: `${82 + ((col * 7 + i * 23) % 18)}%` }} />
              ))}
            </div>
          ))}
        </div>
        {page.items.length > 1 ? <div className={cn("shrink-0 text-[6px] font-medium", INK_SOFT)}>+ {page.items.length - 1}{" "}{tr("more stor")}{page.items.length === 2 ? "y" : "ies"}</div> : null}
      </div>
    </div>
  );
}
