import Link from "next/link";
import { Star } from "lucide-react";
import type { ArticleDeskRow } from "@/server/editorial/article-list";
import { CampusList } from "./campus-chip";
import { ManualEditMeter, WarningCell } from "./article-desk-table";
import { relativeTime } from "@/lib/utils";

const COLUMNS = [
  { key: "drafting", label: "Drafting", statuses: ["EMPTY", "AI_DRAFT", "IN_EDITING"] },
  { key: "review", label: "In review", statuses: ["READY_FOR_REVIEW"] },
  { key: "approved", label: "Approved", statuses: ["APPROVED"] },
  { key: "locked", label: "Locked", statuses: ["LOCKED"] },
] as const;

/** Kanban-style view of the desk, one column per stage of the article workflow. */
export function ArticleDeskBoard({ rows }: { rows: ArticleDeskRow[] }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
      {COLUMNS.map((col) => {
        const list = rows.filter((r) => (col.statuses as readonly string[]).includes(r.status));
        return (
          <section key={col.key} className="flex min-w-0 flex-col rounded-lg border border-border bg-muted/30">
            <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
              <h3 className="label-caps">{col.label}</h3>
              <span className="tabular text-2xs text-muted-foreground">{list.length}</span>
            </header>
            <ul className="flex flex-col gap-2 p-2">
              {list.length === 0 ? <li className="px-1 py-6 text-center text-2xs text-muted-foreground">Nothing here</li> : null}
              {list.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/articles/${r.id}`}
                    className="block rounded-md border border-border bg-card px-2.5 py-2 shadow-xs transition-colors hover:border-brand/50 hover:bg-accent/30"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        {r.story.isCover ? <Star className="size-3 shrink-0 text-warning" aria-label="Cover story" /> : null}
                        <span className="line-clamp-2 text-[13px] leading-4 font-medium">{r.headline}</span>
                      </span>
                      <WarningCell row={r} />
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        {r.section ? (
                          <>
                            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: r.section.colour ?? "#94a3b8" }} />
                            <span className="truncate text-2xs text-muted-foreground">{r.section.name}</span>
                          </>
                        ) : (
                          <span className="text-2xs text-muted-foreground">No section</span>
                        )}
                      </span>
                      <span className="tabular shrink-0 text-2xs text-muted-foreground">{r.wordCount} w</span>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <CampusList campuses={r.campuses} max={2} />
                      <ManualEditMeter ratio={r.manualEditRatio} />
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-border/60 pt-1.5">
                      <span className="truncate text-2xs text-muted-foreground">{r.assignee?.name ?? "Unassigned"}</span>
                      <span className="shrink-0 text-2xs text-muted-foreground">{relativeTime(r.lastEditedAt ?? r.updatedAt)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

