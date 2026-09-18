"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, FileWarning } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SectionTitle } from "@/components/newsroom/page-header";
import { moveSectionAction } from "@/app/(newsroom)/editions/[editionId]/layout/actions";
import type { Flatplan } from "@/server/publication/flatplan";
import { storyTypeShort } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useUi } from "@/components/i18n/provider";

/**
 * Sections in the order they appear in the issue, with the pages they occupy. Moving a section moves
 * its whole run of pages, which is what "reordering the plan" means to an editor.
 */
export function FlatplanRunningOrder({
  editionId,
  sectionRuns,
  stories,
  canEdit,
}: {
  editionId: string;
  sectionRuns: Flatplan["sectionRuns"];
  stories: Flatplan["stories"];
  canEdit: boolean;
}) {
  const tr = useUi();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const unplaced = stories.filter((s) => s.page === null);

  function move(sectionId: string | null, direction: "up" | "down") {
    startTransition(async () => {
      const result = await moveSectionAction(editionId, sectionId, direction);
      if (result.ok) {
        toast.success(result.message ?? "Section moved");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card">
        <div className="px-3 pt-3">
          <SectionTitle>{tr("Running order")}</SectionTitle>
        </div>
        <ul className="divide-y divide-border border-t border-border">
          {sectionRuns.map((run, index) => (
            <li key={run.id ?? `none-${index}`} className="flex items-center gap-2 px-3 py-1.5">
              <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: run.colour ?? "var(--color-muted-foreground)" }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{run.name}</span>
                <span className="tabular block text-2xs text-muted-foreground">
                  {run.firstPage === run.lastPage ? `p. ${run.firstPage}` : `pp. ${run.firstPage}–${run.lastPage}`} · {run.pages} {" "}{tr("page")}{run.pages === 1 ? "" : "s"} · {run.stories} {" "}{tr("stor")}{" "}{run.stories === 1 ? "y" : "ies"}
                </span>
              </span>
              {!run.contiguous ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-warning">
                      <FileWarning className="size-3.5" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{tr("This section’s pages are split across the issue, so it cannot be moved as a block.")}</TooltipContent>
                </Tooltip>
              ) : null}
              {canEdit ? (
                <span className="flex shrink-0">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Move ${run.name} earlier`}
                    disabled={pending || index === 0 || !run.contiguous}
                    onClick={() => move(run.id, "up")}
                  >
                    <ChevronUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Move ${run.name} later`}
                    disabled={pending || index === sectionRuns.length - 1 || !run.contiguous}
                    onClick={() => move(run.id, "down")}
                  >
                    <ChevronDown />
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
          {!sectionRuns.length ? <li className="px-3 py-3 text-xs text-muted-foreground">{tr("No page in the plan yet.")}</li> : null}
        </ul>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <div className="px-3 pt-3">
          <SectionTitle
            action={
              <span className={cn("tabular text-2xs", unplaced.length ? "text-warning" : "text-muted-foreground")}>
                {unplaced.length}/{stories.length}
              </span>
            }
          >
            {tr("Not on the plan")}</SectionTitle>
        </div>
        {unplaced.length ? (
          <ul className="divide-y divide-border border-t border-border">
            {unplaced.map((story) => (
              <li key={story.id} className="px-3 py-1.5">
                <Link href={`/stories/${story.id}`} className="block truncate text-xs font-medium hover:text-brand">
                  {story.title}
                </Link>
                <span className="tabular text-2xs text-muted-foreground">
                  {storyTypeShort(story.storyType)} · {story.wordCount} {" "}{tr("words ·")}{" "}{story.sectionName ?? "no section"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-t border-border px-3 py-3 text-xs text-muted-foreground">{tr("Every selected story has a page.")}</p>
        )}
        {unplaced.length ? (
          <p className="border-t border-border px-3 py-2 text-2xs text-muted-foreground">
            {tr("Re-plan the pages to place them automatically, or pin one to a page from the page inspector.")}</p>
        ) : null}
      </div>
    </div>
  );
}
