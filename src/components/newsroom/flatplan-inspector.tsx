"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ExternalLink, Image as ImageIcon, Lock, Pin, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { SectionTitle } from "@/components/newsroom/page-header";
import { ArticleStatusBadge, RightsBadge, SeverityBadge } from "@/components/newsroom/status-badge";
import type { Flatplan, FlatplanPage, FlatplanTemplate } from "@/server/publication/flatplan";
import { storyTypeLabel } from "@/lib/constants";
import { cn } from "@/lib/utils";

const NONE = "__none";

/** Everything about one page of the flatplan, and every control that changes it. */
export function FlatplanInspector({
  page,
  pages,
  stories,
  templates,
  canEdit,
  pending,
  editionId,
  onClose,
  onTemplateChange,
  onToggleFlag,
  onMove,
  onPinStory,
  onNotes,
  onAddAfter,
  onRemove,
}: {
  page: FlatplanPage | null;
  pages: FlatplanPage[];
  stories: Flatplan["stories"];
  templates: FlatplanTemplate[];
  canEdit: boolean;
  pending: boolean;
  editionId: string;
  onClose: () => void;
  onTemplateChange: (pageId: string, template: string) => void;
  onToggleFlag: (pageId: string, patch: { isLocked?: boolean; isArticleLocked?: boolean; isImageLocked?: boolean }) => void;
  onMove: (pageId: string, direction: "up" | "down") => void;
  onPinStory: (pageId: string, storyId: string | null, pin: boolean) => void;
  onNotes: (pageId: string, notes: string) => void;
  onAddAfter: (pageId: string) => void;
  onRemove: (pageId: string) => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const engineMade = page?.kind === "engine-continuation";
  const anchors = pages.filter((p) => p.anchorIndex !== null);
  const isFirst = page ? anchors[0]?.id === page.id : false;
  const isLast = page ? anchors[anchors.length - 1]?.id === page.id : false;
  const families = [...new Set(templates.map((t) => t.family))];
  const editable = canEdit && !!page && !engineMade;

  return (
    <Sheet open={!!page} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        {page ? (
          <>
            <SheetHeader className="border-b border-border">
              <SheetTitle className="flex items-center gap-2">
                <span className="tabular">Page {page.number}</span>
                <Badge variant={engineMade ? "info" : "muted"}>{page.templateName}</Badge>
                {page.isLocked ? (
                  <Badge variant="brand" className="gap-1">
                    <Lock className="size-3" /> Locked
                  </Badge>
                ) : null}
              </SheetTitle>
              <SheetDescription>
                {page.section ? page.section.name : "No section"} ·{" "}
                {engineMade
                  ? `Created by the paginator to continue page ${page.continuationOfNumber ?? "?"}.`
                  : page.continuationOfNumber
                    ? `Planned as a second page for the story on page ${page.continuationOfNumber}.`
                    : `≈ ${page.capacityWords} words and ${page.imageSlots} image slot${page.imageSlots === 1 ? "" : "s"} in this template.`}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-5 p-4">
              {/* ── fit ── */}
              <div>
                <SectionTitle>Copyfit</SectionTitle>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                  <Row label="Words on the page" value={<span className="tabular">{page.words}</span>} />
                  <Row label="Template budget" value={<span className="tabular">≈ {page.capacityWords}</span>} />
                  <Row
                    label={page.fillSource === "measured" ? "Measured fill" : "Estimated fill"}
                    value={<span className={cn("tabular", page.overflow && "font-semibold text-destructive")}>{Math.round(page.fill * 100)} %</span>}
                  />
                  <Row label="Type shrunk" value={<span className="tabular">{page.fitLevel ? `${(page.fitLevel * 2.5).toFixed(1)} %` : "—"}</span>} />
                  {page.overflowBlocks ? <Row label="Overset blocks" value={<span className="tabular text-destructive">{page.overflowBlocks}</span>} /> : null}
                </dl>
                <p className="mt-1.5 text-2xs text-muted-foreground">
                  {page.fillSource === "measured"
                    ? "The fill is what the print engine measured in the text area of this page; the budget is only the planning estimate used before the pass."
                    : "This page has not been measured yet: the fill is the planning estimate from the template budget."}
                </p>
              </div>

              {/* ── content ── */}
              <div>
                <SectionTitle>On this page</SectionTitle>
                {page.items.length ? (
                  <ul className="space-y-2">
                    {page.items.map((item) => (
                      <li key={item.storyId} className="rounded-md border border-border bg-card p-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            {item.kicker ? <div className="label-caps">{item.kicker}</div> : null}
                            <p className="text-[13px] leading-snug font-medium">{item.headline}</p>
                            <p className="mt-0.5 text-2xs text-muted-foreground">
                              {storyTypeLabel(item.storyType)} · <span className="tabular">{item.wordCount}</span> words
                            </p>
                          </div>
                          {item.articleStatus ? <ArticleStatusBadge status={item.articleStatus} /> : null}
                        </div>
                        <div className="mt-1.5 flex gap-2">
                          <Button asChild size="xs" variant="outline">
                            <Link href={`/stories/${item.storyId}`}>
                              Open story <ExternalLink />
                            </Link>
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">No story is placed on this page.</p>
                )}
              </div>

              {/* ── images ── */}
              {page.images.length ? (
                <div>
                  <SectionTitle>
                    Images <span className="text-muted-foreground">({page.images.length})</span>
                  </SectionTitle>
                  <ul className="grid grid-cols-4 gap-1.5">
                    {page.images.slice(0, 8).map((image) => (
                      <li key={image.id} className={cn("relative overflow-hidden rounded-sm border", image.rightsStatus === "RED" ? "border-destructive" : "border-border")}>
                        <Link href={`/media/${image.id}`} title={image.caption ?? image.fileName ?? "Image"}>
                          {image.url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={image.url} alt={image.caption ?? ""} className="aspect-square size-full object-cover" loading="lazy" />
                          ) : (
                            <span className="flex aspect-square items-center justify-center bg-muted text-muted-foreground">
                              <ImageIcon className="size-4" />
                            </span>
                          )}
                        </Link>
                        {image.rightsStatus !== "GREEN" ? (
                          <span className="absolute inset-x-0 bottom-0 flex justify-center bg-background/85 py-0.5">
                            <RightsBadge status={image.rightsStatus} showLabel={false} />
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {page.images.some((i) => i.rightsStatus === "RED") ? (
                    <p className="mt-1.5 text-2xs text-destructive">An image on this page is marked “do not publish”. The renderer skips it and exports are blocked until it is replaced or cleared.</p>
                  ) : null}
                </div>
              ) : null}

              {/* ── warnings ── */}
              {page.warnings.length ? (
                <div>
                  <SectionTitle>Warnings</SectionTitle>
                  <ul className="space-y-1.5">
                    {page.warnings.map((warning, i) => (
                      <li key={`${warning.code}-${i}`} className="flex items-start gap-2 rounded-md border border-border bg-card p-2 text-xs">
                        <SeverityBadge severity={warning.severity} />
                        <span className="min-w-0 flex-1">{warning.message}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* ── controls ── */}
              {editable ? (
                <div className="space-y-4 border-t border-border pt-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="inspector-template">Template</Label>
                    <Select value={page.template} onValueChange={(value) => onTemplateChange(page.id, value)} disabled={pending}>
                      <SelectTrigger id="inspector-template" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {families.map((family) => (
                          <SelectGroup key={family}>
                            <SelectLabel className="capitalize">{family}</SelectLabel>
                            {templates
                              .filter((t) => t.family === family)
                              .map((t) => (
                                <SelectItem key={t.code} value={t.code}>
                                  <span className="flex flex-col gap-0.5">
                                    <span>{t.name}</span>
                                    <span className="text-2xs text-muted-foreground">{t.description}</span>
                                  </span>
                                </SelectItem>
                              ))}
                          </SelectGroup>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="inspector-story">Pinned story</Label>
                    <Select
                      value={page.items[0]?.storyId ?? NONE}
                      onValueChange={(value) => onPinStory(page.id, value === NONE ? null : value, true)}
                      disabled={pending || page.anchorIndex === null}
                    >
                      <SelectTrigger id="inspector-story" className="w-full">
                        <SelectValue placeholder="No story" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>No story on this page</SelectItem>
                        {stories.some((s) => s.page === null) ? (
                          <SelectGroup>
                            <SelectLabel>Not yet placed</SelectLabel>
                            {stories
                              .filter((s) => s.page === null)
                              .map((s) => (
                                <SelectItem key={s.id} value={s.id}>
                                  {s.title}
                                </SelectItem>
                              ))}
                          </SelectGroup>
                        ) : null}
                        <SelectGroup>
                          <SelectLabel>Already on a page</SelectLabel>
                          {stories
                            .filter((s) => s.page !== null)
                            .map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.title} <span className="text-muted-foreground">· p. {s.page}</span>
                              </SelectItem>
                            ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <p className="text-2xs text-muted-foreground">The story is moved to this page, the page is locked, and re-planning leaves both alone.</p>
                  </div>

                  <div className="space-y-2">
                    <Toggle
                      id="lock-page"
                      label="Lock the page"
                      hint="Keeps this page number and its story when the plan is regenerated."
                      checked={page.isLocked}
                      disabled={pending}
                      onChange={(checked) => onToggleFlag(page.id, { isLocked: checked })}
                    />
                    <Toggle
                      id="lock-article"
                      label="Lock the story choice"
                      hint="The automatic allocation may not swap the story on this page."
                      checked={page.isArticleLocked}
                      disabled={pending}
                      onChange={(checked) => onToggleFlag(page.id, { isArticleLocked: checked })}
                    />
                    <Toggle
                      id="lock-image"
                      label="Lock the images"
                      hint="Keeps the pictures chosen for this page."
                      checked={page.isImageLocked}
                      disabled={pending}
                      onChange={(checked) => onToggleFlag(page.id, { isImageLocked: checked })}
                    />
                  </div>

                  {page.anchorIndex !== null ? (
                    <div className="space-y-2">
                      <Label>Pages</Label>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" disabled={pending || isFirst} onClick={() => onMove(page.id, "up")}>
                          <ArrowUp /> Move earlier
                        </Button>
                        <Button variant="outline" size="sm" disabled={pending || isLast} onClick={() => onMove(page.id, "down")}>
                          <ArrowDown /> Move later
                        </Button>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" disabled={pending} onClick={() => onAddAfter(page.id)}>
                          <Plus /> Add page after
                        </Button>
                        <Button variant="outline" size="sm" disabled={pending || page.isLocked} onClick={() => setConfirmRemove(true)} className="text-destructive hover:text-destructive">
                          <Trash2 /> Remove page
                        </Button>
                      </div>
                      {page.isLocked ? <p className="text-2xs text-muted-foreground">Unlock the page above to remove it.</p> : null}
                    </div>
                  ) : null}

                  <form
                    className="space-y-1.5"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const value = new FormData(event.currentTarget).get("notes");
                      onNotes(page.id, typeof value === "string" ? value : "");
                    }}
                  >
                    <Label htmlFor="inspector-notes">Note for the layout</Label>
                    <Textarea id="inspector-notes" name="notes" key={page.id} defaultValue={page.notes ?? ""} rows={3} maxLength={500} placeholder="e.g. keep the portrait full bleed" />
                    <Button type="submit" size="sm" variant="outline" disabled={pending}>
                      Save note
                    </Button>
                  </form>
                </div>
              ) : (
                <p className="border-t border-border pt-4 text-xs text-muted-foreground">
                  {engineMade
                    ? "This page is created by the print engine when the text overflows. Change the template or the running order of the page it continues to get rid of it."
                    : "You do not have permission to change the layout."}
                </p>
              )}

              <div className="flex items-center gap-2 border-t border-border pt-4">
                <Button asChild size="sm" variant="ghost">
                  <a href={`/print/edition/${editionId}`} target="_blank" rel="noreferrer">
                    Print preview <ExternalLink />
                  </a>
                </Button>
                {page.isLocked ? (
                  <span className="flex items-center gap-1 text-2xs text-muted-foreground">
                    <Pin className="size-3" /> pinned
                  </span>
                ) : null}
              </div>
            </div>

            <AlertDialog open={confirmRemove} onOpenChange={(v) => !pending && setConfirmRemove(v)}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove page {page.number}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The page is deleted from the flat-plan and the pages after it are renumbered. Any story on it goes back to the pool of unplaced stories. You can add a page again or re-plan at any time.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={(event) => {
                      event.preventDefault();
                      setConfirmRemove(false);
                      onRemove(page.id);
                    }}
                  >
                    <Trash2 /> Remove page
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </>
  );
}

function Toggle({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-card px-2.5 py-2">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-[13px]">
          {label}
        </Label>
        <p className="mt-0.5 text-2xs text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}
