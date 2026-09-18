import Link from "next/link";
import { Suspense } from "react";
import { Sparkles } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { editionSectionsWithCounts } from "@/server/editions/service";
import { listStories, pendingClusters, storyBoardFacets } from "@/server/editorial/story-list";
import { listCampusesWithStats } from "@/server/contributors/service";
import { PageBody } from "@/components/newsroom/page-header";
import { FilterBar } from "@/components/newsroom/filter-bar";
import { StoryCard } from "@/components/newsroom/story-card";
import { ClusterPanel } from "@/components/newsroom/cluster-panel";
import { EmptyState } from "@/components/ui/empty-state";
import { STORY_TYPES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

const VIEWS = [
  { key: "all", label: "All", facet: "total" as const },
  { key: "CANDIDATE", label: "Candidates", facet: "candidates" as const },
  { key: "selected", label: "Selected", facet: "selected" as const },
  { key: "APPROVED", label: "Approved", facet: "approved" as const },
  { key: "REJECTED", label: "Rejected", facet: "rejected" as const },
];

export default async function StoriesPage({ params, searchParams }: { params: Promise<{ editionId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const tr = await getUi();
  const { editionId } = await params;
  const sp = await searchParams;
  const status = sp.status ?? "all";
  const [user, sections, facets, campuses, stories, clusters] = await Promise.all([
    getCurrentUser(),
    editionSectionsWithCounts(editionId),
    storyBoardFacets(editionId),
    listCampusesWithStats(),
    listStories(editionId, { ...sp, status }),
    pendingClusters(editionId),
  ]);
  const canEdit = hasPermission(user, "story:edit");
  const base = `/editions/${editionId}/stories`;
  const qs = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `${base}${next.toString() ? `?${next}` : ""}`;
  };

  const bySection = new Map<string, typeof stories>();
  for (const st of stories) {
    const key = st.section?.id ?? "none";
    bySection.set(key, [...(bySection.get(key) ?? []), st]);
  }
  const groupOrder = [...sections.filter((s) => bySection.has(s.id)), ...(bySection.has("none") ? [{ id: "none", name: "Unassigned", colour: null, slug: "none", stories: 0, candidates: 0 }] : [])];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-2">
        <h1 className="sr-only">{tr("Stories")}</h1>
        <nav className="flex flex-wrap items-center gap-1" aria-label={tr("Story views")}>
          {VIEWS.map((v) => (
            <Link
              key={v.key}
              href={qs({ status: v.key === "all" ? undefined : v.key })}
              className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors", status === v.key || (v.key === "all" && status === "all") ? "bg-brand-soft text-brand-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
            >
              {tr(v.label)}
              <span className="tabular text-2xs opacity-70">{facets[v.facet]}</span>
            </Link>
          ))}
          <span className="mx-1 h-4 w-px bg-border" />
          <Link href={qs({ flag: sp.flag === "needs_attention" ? undefined : "needs_attention" })} className={cn("rounded-md px-2 py-1 text-xs font-medium", sp.flag === "needs_attention" ? "bg-warning-soft text-warning" : "text-muted-foreground hover:bg-muted")}>
            {tr("Needs attention")}{" "}<span className="tabular text-2xs opacity-70">{facets.flagged}</span>
          </Link>
          <Link href={qs({ flag: sp.flag === "conflicts" ? undefined : "conflicts" })} className={cn("rounded-md px-2 py-1 text-xs font-medium", sp.flag === "conflicts" ? "bg-destructive/10 text-destructive" : "text-muted-foreground hover:bg-muted")}>
            {tr("Conflicts")}{" "}<span className="tabular text-2xs opacity-70">{facets.conflicts}</span>
          </Link>
        </nav>
      </div>

      <div className="border-b border-border px-5 py-2">
        <Suspense>
          <FilterBar
            searchPlaceholder={tr("Search stories…")}
            filters={[
              { key: "sectionId", label: tr("Section"), options: [...sections.map((s) => ({ value: s.id, label: s.name })), { value: "none", label: tr("Unassigned") }] },
              { key: "campusId", label: tr("Campus"), options: [...campuses.map((c) => ({ value: c.id, label: c.name })), { value: "school", label: tr("School-wide") }] },
              { key: "storyType", label: tr("Type"), options: STORY_TYPES.map((t) => ({ value: t.value, label: tr(t.label) })) },
              { key: "sort", label: tr("Sort"), options: [{ value: "score", label: tr("Score") }, { value: "priority", label: tr("Priority") }, { value: "recent", label: tr("Recently updated") }, { value: "title", label: tr("Title") }], allLabel: tr("By score") },
            ]}
          />
        </Suspense>
      </div>

      <PageBody className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-5">
          {stories.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              title={facets.total === 0 ? "No stories yet" : "No story matches these filters"}
              description={facets.total === 0 ? "Run the AI processing on the inbox to group submissions into story clusters and create story candidates." : "Adjust the filters to see more."}
              action={
                facets.total === 0 ? (
                  <Link href={`/editions/${editionId}/inbox`} className="text-xs text-brand hover:underline">
                    {tr("Go to the inbox")}</Link>
                ) : null
              }
            />
          ) : (
            groupOrder.map((section) => {
              const list = bySection.get(section.id) ?? [];
              if (!list.length) return null;
              return (
                <section key={section.id}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="size-2 rounded-full" style={{ backgroundColor: section.colour ?? "#94a3b8" }} />
                    <h2 className="label-caps">{section.name}</h2>
                    <span className="text-2xs text-muted-foreground">{list.length}</span>
                  </div>
                  <div className="space-y-2">
                    {list.map((story) => (
                      <StoryCard key={story.id} editionId={editionId} story={story} sections={sections} canEdit={canEdit} />
                    ))}
                  </div>
                </section>
              );
            })
          )}
        </div>

        <ClusterPanel editionId={editionId} clusters={clusters.map((c) => ({ id: c.id, title: c.title, status: c.status, score: c.aiScoreTotal, members: c.members.map((m) => ({ id: m.submissionId, title: m.submission.title })) }))} canEdit={canEdit} />
      </PageBody>
    </div>
  );
}
