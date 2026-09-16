"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, FileText, Image as ImageIcon, PenLine, Star, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ArticleStatusBadge, StoryStatusBadge } from "@/components/newsroom/status-badge";
import { CampusList } from "@/components/newsroom/campus-chip";
import { assignSectionAction, draftArticleAction, dropStoryAction, selectStoryAction, setCoverStoryAction } from "@/app/(newsroom)/editions/[editionId]/stories/actions";
import { cn, truncate } from "@/lib/utils";
import { storyTypeShort } from "@/lib/constants";

export type StoryCardData = {
  id: string;
  title: string;
  summary: string | null;
  status: string;
  storyType: string;
  editorialScore: number | null;
  priority: number;
  isCover: boolean;
  isSpotlight: boolean;
  heroUrl: string | null;
  mediaCount: number;
  disputedFacts: number;
  openMissingInformation: { key: string; label: string; severity: string }[];
  warnings: { code: string; message: string; severity: string }[];
  campusList: { id: string; name: string; colour: string | null }[];
  section: { id: string; name: string; colour: string | null } | null;
  article: { id: string; status: string; headline: string; wordCount: number } | null;
  cluster: { id: string; submissionCount: number } | null;
  isSelected: boolean;
};

export function StoryCard({ editionId, story, sections, canEdit }: { editionId: string; story: StoryCardData; sections: { id: string; name: string }[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const flags = story.warnings.length + story.openMissingInformation.length + story.disputedFacts;

  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(res.message ?? "Done");
        router.refresh();
      } else toast.error(res.error ?? "Failed");
    });
  }

  return (
    <div className={cn("flex gap-3 rounded-lg border border-border bg-card p-3 shadow-xs transition-colors hover:border-brand/40", story.isCover && "border-brand/60 ring-1 ring-brand/20")}>
      <Link href={`/stories/${story.id}`} className="hidden shrink-0 sm:block">
        {story.heroUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={story.heroUrl} alt="" className="h-20 w-28 rounded-md border border-border object-cover" />
        ) : (
          <div className="flex h-20 w-28 items-center justify-center rounded-md border border-dashed border-border bg-muted/40 text-2xs text-muted-foreground">No photo</div>
        )}
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <StoryStatusBadge status={story.status} />
          <Badge variant="outline">{storyTypeShort(story.storyType)}</Badge>
          {story.isCover ? (
            <Badge variant="brand">
              <Star className="size-3" /> Cover
            </Badge>
          ) : null}
          {story.isSpotlight ? <Badge variant="info">Spotlight</Badge> : null}
          {story.editorialScore !== null ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="tabular rounded-sm bg-muted px-1 text-2xs font-semibold text-muted-foreground">{story.editorialScore}</span>
              </TooltipTrigger>
              <TooltipContent>Editorial score out of 100</TooltipContent>
            </Tooltip>
          ) : null}
        </div>

        <Link href={`/stories/${story.id}`} className="mt-1 block">
          <h3 className="text-[13px] leading-snug font-semibold hover:underline">{story.article?.headline || story.title}</h3>
          {story.summary ? <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{truncate(story.summary, 170)}</p> : null}
        </Link>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-2xs text-muted-foreground">
          <CampusList campuses={story.campusList} max={3} />
          {story.cluster ? <span>{story.cluster.submissionCount} source{story.cluster.submissionCount === 1 ? "" : "s"}</span> : null}
          <span className="inline-flex items-center gap-0.5">
            <ImageIcon className="size-3" /> {story.mediaCount}
          </span>
          {story.article && story.article.status !== "EMPTY" ? (
            <span className="inline-flex items-center gap-1">
              <FileText className="size-3" />
              <ArticleStatusBadge status={story.article.status} /> {story.article.wordCount}w
            </span>
          ) : (
            <span className="text-warning">No draft</span>
          )}
          {flags ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={cn("inline-flex items-center gap-0.5", story.disputedFacts ? "text-destructive" : "text-warning")}>
                  <AlertTriangle className="size-3" /> {flags}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <ul className="space-y-0.5">
                  {story.disputedFacts ? <li>{story.disputedFacts} disputed fact{story.disputedFacts === 1 ? "" : "s"}</li> : null}
                  {story.warnings.map((w, i) => (
                    <li key={i}>{w.message}</li>
                  ))}
                  {story.openMissingInformation.map((m) => (
                    <li key={m.key}>{m.label}</li>
                  ))}
                </ul>
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>

      {canEdit ? (
        <div className="flex shrink-0 flex-col items-end gap-1.5" data-no-row-link>
          <NativeSelect
            aria-label="Section"
            className="h-7 w-36 text-xs"
            value={story.section?.id ?? ""}
            disabled={pending}
            onChange={(e) => run(() => assignSectionAction(editionId, story.id, e.target.value || null))}
          >
            <option value="">Unassigned</option>
            {sections.map((sec) => (
              <option key={sec.id} value={sec.id}>
                {sec.name}
              </option>
            ))}
          </NativeSelect>
          <div className="flex gap-1">
            {!story.isSelected ? (
              <Button size="xs" variant="outline" disabled={pending} onClick={() => run(() => selectStoryAction(editionId, story.id))}>
                <Check /> Select
              </Button>
            ) : (
              <Button size="xs" variant="ghost" disabled={pending} onClick={() => run(() => dropStoryAction(editionId, story.id))} title="Drop from the issue">
                <X /> Drop
              </Button>
            )}
            {story.isSelected && (!story.article || story.article.status === "EMPTY") ? (
              <Button size="xs" variant="brand" loading={pending} onClick={() => run(() => draftArticleAction(editionId, story.id))}>
                <PenLine /> Draft
              </Button>
            ) : story.article && story.article.status !== "EMPTY" ? (
              <Button size="xs" variant="outline" asChild>
                <Link href={`/articles/${story.article.id}`}>Edit</Link>
              </Button>
            ) : null}
            {!story.isCover && story.isSelected ? (
              <Button size="icon-xs" variant="ghost" title="Make cover story" aria-label="Make cover story" disabled={pending} onClick={() => run(() => setCoverStoryAction(editionId, story.id))}>
                <Star />
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
