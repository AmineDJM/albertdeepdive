import Link from "next/link";
import { Suspense } from "react";
import { FileText, LayoutGrid, Rows3 } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { editionSectionsWithCounts } from "@/server/editions/service";
import { listCampusesWithStats } from "@/server/contributors/service";
import { articleAssignees, articleDeskFacets, listArticleDesk } from "@/server/editorial/article-list";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { FilterBar } from "@/components/newsroom/filter-bar";
import { Stat, StatGrid, ProgressBar } from "@/components/newsroom/stat";
import { ArticleDeskTable } from "@/components/newsroom/article-desk-table";
import { ArticleDeskBoard } from "@/components/newsroom/article-desk-board";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { cn, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

const VIEWS = [
  { key: "all", label: "All", facet: "total" as const },
  { key: "drafting", label: "Drafting", facet: "drafting" as const },
  { key: "review", label: "In review", facet: "inReview" as const },
  { key: "approved", label: "Approved", facet: "approved" as const },
];

export default async function ArticleDeskPage({
  params,
  searchParams,
}: {
  params: Promise<{ editionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { editionId } = await params;
  const raw = await searchParams;
  const sp: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw)) sp[key] = Array.isArray(value) ? value[0] : value;

  const status = sp.status ?? "all";
  const view = sp.view === "board" ? "board" : "table";
  const [user, facets, sections, campuses, assignees, rows] = await Promise.all([
    getCurrentUser(),
    articleDeskFacets(editionId),
    editionSectionsWithCounts(editionId),
    listCampusesWithStats(),
    articleAssignees(editionId),
    listArticleDesk(editionId, { q: sp.q, status, sectionId: sp.sectionId, campusId: sp.campusId, assignee: sp.assignee, sort: sp.sort }),
  ]);
  const canEdit = hasPermission(user, "article:edit");
  const base = `/editions/${editionId}/articles`;
  const qs = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `${base}${next.toString() ? `?${next}` : ""}`;
  };
  const hasFilters = Boolean(sp.q || sp.sectionId || sp.campusId || sp.assignee || (status !== "all" && status));
  const done = facets.approved;
  const target = Math.max(facets.total, facets.selectedStories);

  return (
    <>
      <PageHeader
        title="Article desk"
        description={`${facets.total} article${facets.total === 1 ? "" : "s"} · ${formatNumber(facets.words)} words · ${facets.approved} approved${facets.missingDrafts ? ` · ${facets.missingDrafts} selected ${facets.missingDrafts === 1 ? "story has" : "stories have"} no draft` : ""}`}
        actions={
          <div className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
            <Button asChild size="sm" variant={view === "table" ? "outline" : "ghost"} className={cn(view === "table" && "bg-card")}>
              <Link href={qs({ view: undefined })} aria-current={view === "table" ? "true" : undefined}>
                <Rows3 /> Table
              </Link>
            </Button>
            <Button asChild size="sm" variant={view === "board" ? "outline" : "ghost"} className={cn(view === "board" && "bg-card")}>
              <Link href={qs({ view: "board" })} aria-current={view === "board" ? "true" : undefined}>
                <LayoutGrid /> Board
              </Link>
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-2">
        <nav className="flex flex-wrap items-center gap-1" aria-label="Article views">
          {VIEWS.map((v) => (
            <Link
              key={v.key}
              href={qs({ status: v.key === "all" ? undefined : v.key })}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                status === v.key ? "bg-brand-soft text-brand-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {v.label}
              <span className="tabular text-2xs opacity-70">{facets[v.facet]}</span>
            </Link>
          ))}
          {facets.warnings ? (
            <>
              <span className="mx-1 h-4 w-px bg-border" />
              <span className="rounded-md px-2 py-1 text-xs font-medium text-warning">
                {facets.warnings} flagged <span className="tabular text-2xs opacity-70">article{facets.warnings === 1 ? "" : "s"}</span>
              </span>
            </>
          ) : null}
        </nav>
        <span className="text-2xs text-muted-foreground">
          {rows.length} shown{facets.locked ? ` · ${facets.locked} locked for print` : ""}
        </span>
      </div>

      <div className="border-b border-border px-5 py-2">
        <Suspense>
          <FilterBar
            searchPlaceholder="Search headline, standfirst, story…"
            filters={[
              { key: "sectionId", label: "Section", options: [...sections.map((s) => ({ value: s.id, label: s.name })), { value: "none", label: "No section" }] },
              { key: "campusId", label: "Campus", options: [...campuses.map((c) => ({ value: c.id, label: c.name })), { value: "school", label: "School-wide" }] },
              { key: "assignee", label: "Assignee", options: [...assignees.map((a) => ({ value: a.id, label: a.name })), { value: "none", label: "Unassigned" }] },
              {
                key: "sort",
                label: "Sort",
                options: [
                  { value: "status", label: "Workflow status" },
                  { value: "recent", label: "Recently edited" },
                  { value: "words", label: "Longest first" },
                  { value: "manual", label: "Most rewritten" },
                ],
                allLabel: "By section",
              },
            ]}
          />
        </Suspense>
      </div>

      <PageBody className="space-y-4">
        <StatGrid columns={5}>
          <Stat label="Articles" value={facets.total} hint={`${facets.selectedStories} selected stories`} icon={FileText} />
          <Stat label="Approved" value={facets.approved} tone={facets.approved ? "success" : "muted"} hint={facets.locked ? `${facets.locked} locked` : "Ready for layout"} href={qs({ status: "approved" })} />
          <Stat label="In review" value={facets.inReview} tone={facets.inReview ? "warning" : "muted"} hint="Waiting for an editor" href={qs({ status: "review" })} />
          <Stat label="Drafting" value={facets.drafting} hint={facets.missingDrafts ? `${facets.missingDrafts} not started` : "All stories drafted"} href={qs({ status: "drafting" })} />
          <Stat label="Words" value={formatNumber(facets.words)} hint={facets.total ? `${Math.round(facets.words / facets.total)} per article` : "No article yet"} />
        </StatGrid>

        {facets.total ? (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
            <span className="label-caps shrink-0">Progress</span>
            <ProgressBar value={done} max={Math.max(1, target)} tone={done === target ? "success" : "brand"} />
            <span className="tabular shrink-0 text-xs text-muted-foreground">
              {done} / {target} approved
            </span>
          </div>
        ) : null}

        {rows.length === 0 && !hasFilters ? (
          <EmptyState
            icon={FileText}
            title="No article has been drafted yet"
            description={
              facets.selectedStories
                ? `${facets.selectedStories} ${facets.selectedStories === 1 ? "story is" : "stories are"} selected for this edition. Draft them from the stories board and they will appear here.`
                : "Select stories for this edition first; each selected story gets an article."
            }
            action={
              <Link href={`/editions/${editionId}/stories`} className="text-xs text-brand hover:underline">
                Go to the stories board
              </Link>
            }
          />
        ) : view === "board" ? (
          <ArticleDeskBoard rows={rows} />
        ) : (
          <ArticleDeskTable rows={rows} />
        )}

        {canEdit && facets.missingDrafts > 0 && rows.length > 0 ? (
          <p className="text-2xs text-muted-foreground">
            {facets.missingDrafts} selected {facets.missingDrafts === 1 ? "story has" : "stories have"} no draft yet —{" "}
            <Link href={`/editions/${editionId}/stories?status=selected`} className="text-brand hover:underline">
              draft them from the stories board
            </Link>
            .
          </p>
        ) : null}
      </PageBody>
    </>
  );
}
