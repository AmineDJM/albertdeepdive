import Link from "next/link";
import { Suspense } from "react";
import { Inbox as InboxIcon } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { getEdition } from "@/server/editions/service";
import { inboxFacets, listInbox, submissionDetail } from "@/server/editorial/inbox";
import { listCampusesWithStats } from "@/server/contributors/service";
import { PageBody } from "@/components/newsroom/page-header";
import { FilterBar } from "@/components/newsroom/filter-bar";
import { InboxList } from "@/components/newsroom/inbox-list";
import { SubmissionDetail } from "@/components/newsroom/submission-detail";
import { ProcessingButton } from "@/components/newsroom/processing-button";
import { EmptyState } from "@/components/ui/empty-state";
import { STORY_TYPES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

const VIEWS = [
  { key: "needs_review", label: "Needs review", facet: "needsReview" as const },
  { key: "new", label: "New", facet: "new" as const },
  { key: "missing_info", label: "Missing info", facet: "missingInfo" as const },
  { key: "potential", label: "Potential", facet: "potential" as const },
  { key: "duplicate", label: "Duplicates", facet: "duplicate" as const },
  { key: "accepted", label: "Accepted", facet: "accepted" as const },
  { key: "rejected", label: "Rejected", facet: "rejected" as const },
  { key: "all", label: "All", facet: "total" as const },
];

export default async function InboxPage({ params, searchParams }: { params: Promise<{ editionId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const tr = await getUi();
  const { editionId } = await params;
  const sp = await searchParams;
  const view = sp.view ?? "needs_review";
  const [user, edition, facets, campuses] = await Promise.all([getCurrentUser(), getEdition(editionId), inboxFacets(editionId), listCampusesWithStats()]);
  const canReview = hasPermission(user, "submission:review");
  const canRunAi = hasPermission(user, "ai:run");
  const { rows, total, page, pages } = await listInbox(editionId, { ...sp, view });
  const detail = sp.submission ? await submissionDetail(sp.submission).catch(() => null) : null;
  const base = `/editions/${editionId}/inbox`;
  const qs = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `${base}${next.toString() ? `?${next}` : ""}`;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-2">
        <h1 className="sr-only">{tr("Inbox —")}{" "}{edition.label}</h1>
        <nav className="flex flex-wrap items-center gap-1" aria-label={tr("Inbox views")}>
          {VIEWS.map((v) => (
            <Link
              key={v.key}
              href={qs({ view: v.key, submission: undefined, page: undefined })}
              className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors", view === v.key ? "bg-brand-soft text-brand-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
            >
              {tr(v.label)}
              <span className="tabular text-2xs opacity-70">{facets[v.facet]}</span>
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          {facets.unprocessed > 0 ? <span className="text-2xs text-warning">{facets.unprocessed} {" "}{tr("not processed")}</span> : null}
          {canRunAi ? <ProcessingButton editionId={editionId} unprocessed={facets.unprocessed} /> : null}
        </div>
      </div>

      <div className="border-b border-border px-5 py-2">
        <Suspense>
          <FilterBar
            searchPlaceholder={tr("Search submissions…")}
            filters={[
              { key: "campusId", label: tr("Campus"), options: [...campuses.map((c) => ({ value: c.id, label: c.name })), { value: "school", label: tr("School-wide") }] },
              { key: "storyType", label: tr("Type"), options: STORY_TYPES.map((t) => ({ value: t.value, label: tr(t.label) })) },
              { key: "hasMedia", label: tr("Media"), options: [{ value: "true", label: tr("With photos") }, { value: "false", label: tr("Without photos") }], allLabel: tr("Any media") },
              { key: "flagged", label: tr("Flags"), options: [{ value: "true", label: tr("Flagged only") }], allLabel: tr("All") },
              { key: "sort", label: tr("Sort"), options: [{ value: "newest", label: tr("Newest") }, { value: "oldest", label: tr("Oldest") }, { value: "importance", label: tr("Importance") }, { value: "type", label: tr("Story type") }], allLabel: tr("Newest first") },
            ]}
          />
        </Suspense>
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
        <div className="flex min-h-0 flex-col border-r border-border">
          {rows.length === 0 && total === 0 && facets.total === 0 ? (
            <PageBody>
              <EmptyState
                icon={InboxIcon}
                title={tr("No contributions yet")}
                description={
                  edition.status === "UPCOMING"
                    ? "The campaign has not opened. Schedule and open it to start collecting stories."
                    : "Contributors have not submitted anything yet. Reminders go out automatically."
                }
              />
            </PageBody>
          ) : (
            <InboxList editionId={editionId} items={rows} selectedId={sp.submission} canReview={canReview} />
          )}
          {pages > 1 ? (
            <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-xs">
              <span className="text-muted-foreground">
                {tr("Page")}{" "}{page} {" "}{tr("of")}{" "}{pages} · {total} {" "}{tr("submissions")}</span>
              <span className="flex gap-1">
                {page > 1 ? (
                  <Link href={qs({ page: String(page - 1) })} className="rounded px-2 py-0.5 hover:bg-muted">
                    {tr("Previous")}</Link>
                ) : null}
                {page < pages ? (
                  <Link href={qs({ page: String(page + 1) })} className="rounded px-2 py-0.5 hover:bg-muted">
                    {tr("Next")}</Link>
                ) : null}
              </span>
            </div>
          ) : null}
        </div>
        <aside className="hidden min-h-0 lg:block">
          {detail ? (
            <SubmissionDetail editionId={editionId} data={detail} canReview={canReview} onClose={qs({ submission: undefined })} />
          ) : (
            <div className="flex h-full items-center justify-center p-8">
              <EmptyState icon={InboxIcon} title={tr("Select a submission")} description={tr("Pick a contribution on the left to read it, check its sources and triage it.")} compact />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
