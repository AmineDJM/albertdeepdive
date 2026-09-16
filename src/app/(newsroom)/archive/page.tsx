import { Suspense } from "react";
import Link from "next/link";
import { Archive, Search, X } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { archiveFilterOptions, searchArchive, type ArchiveFilters } from "@/server/archive/service";
import { archiveShelf } from "@/server/archive/read-edition";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { FilterBar } from "@/components/newsroom/filter-bar";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { ArchiveEditionCard } from "@/components/newsroom/archive-edition-card";
import { StoryResult } from "@/components/archive/story-result";
import { NoAccess } from "@/components/settings/no-access";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

const FILTER_KEYS = ["q", "editionId", "section", "storyType", "campusId", "person", "organisation", "association"] as const;

export default async function ArchivePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!hasPermission(user, "archive:view")) return <NoAccess title="Archive" permission="archive:view" />;

  const filters: ArchiveFilters = {
    q: sp.q,
    editionId: sp.editionId,
    section: sp.section,
    storyType: sp.storyType,
    campusId: sp.campusId,
    person: sp.person,
    organisation: sp.organisation,
    association: sp.association,
  };
  const [options, results, shelf] = await Promise.all([archiveFilterOptions(), searchArchive(filters), archiveShelf()]);
  const active = FILTER_KEYS.filter((k) => sp[k]?.trim());
  const isFiltered = active.length > 0;
  const visibleShelf = sp.editionId ? shelf.filter((e) => e.id === sp.editionId) : shelf;
  const withDownloads = shelf.filter((e) => e.downloads.length).length;

  function without(key: string) {
    const next = new URLSearchParams();
    for (const k of FILTER_KEYS) if (k !== key && sp[k]) next.set(k, sp[k]!);
    return `/archive${next.toString() ? `?${next.toString()}` : ""}`;
  }

  return (
    <>
      <PageHeader title="Archive" description={`${shelf.length} issue${shelf.length === 1 ? "" : "s"} · ${formatNumber(options.stats.stories)} stories · ${formatNumber(options.stats.people)} people · ${formatNumber(options.stats.organisations)} organisations`} />
      <PageBody className="space-y-6">
        <StatGrid columns={4}>
          <Stat label="Issues" value={shelf.length} hint={`${withDownloads} with a rendered export`} />
          <Stat label="Stories" value={options.stats.stories} hint="selected, written or published" />
          <Stat label="Business Deep Dives" value={options.stats.bdds} hint="structured company cases" />
          <Stat label="People & organisations" value={options.stats.people + options.stats.organisations} hint={`${options.stats.people} people · ${options.stats.organisations} organisations`} />
        </StatGrid>

        <Suspense>
          <FilterBar
            searchPlaceholder="Search headlines, standfirsts, article text, people, companies…"
            filters={[
              { key: "editionId", label: "Issue", options: options.editions.map((e) => ({ value: e.id, label: e.label })), allLabel: "All issues" },
              { key: "section", label: "Section", options: options.sections.map((sec) => ({ value: sec.slug, label: sec.name })) },
              { key: "storyType", label: "Type", options: options.storyTypes.map((t) => ({ value: t.value, label: t.label })) },
              { key: "campusId", label: "Campus", options: options.campuses.map((c) => ({ value: c.id, label: c.name })) },
            ]}
          >
            {(["person", "organisation", "association"] as const)
              .filter((k) => sp[k]?.trim())
              .map((k) => (
                <Link key={k} href={without(k)} className="inline-flex" aria-label={`Remove the ${k} filter`}>
                  <Badge variant="brand" className="gap-1 py-1">
                    {k}: {sp[k]}
                    <X className="size-3" />
                  </Badge>
                </Link>
              ))}
          </FilterBar>
        </Suspense>

        <section>
          <SectionTitle>{sp.editionId ? "Issue" : "Back catalogue"}</SectionTitle>
          {visibleShelf.length ? (
            <div className="grid items-start gap-3 xl:grid-cols-2">
              {visibleShelf.map((edition) => (
                <ArchiveEditionCard key={edition.id} edition={edition} />
              ))}
            </div>
          ) : (
            <EmptyState icon={Archive} title="No issue in the archive yet" description="Editions appear here as soon as they exist; their PDF and Word files appear once a version has been rendered." />
          )}
        </section>

        <section>
          <SectionTitle>
            {isFiltered ? `${results.total} matching article${results.total === 1 ? "" : "s"}` : `Every archived article (${results.total})`}
          </SectionTitle>
          {results.groups.length ? (
            <div className="space-y-4">
              {results.groups.map((group) => (
                <div key={group.editionId} className="overflow-hidden rounded-lg border border-border bg-card">
                  <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
                    <div className="flex items-baseline gap-2">
                      <Link href={`/archive/${group.editionId}`} className="text-[13px] font-semibold hover:underline">
                        {group.label}
                      </Link>
                      <span className="text-2xs text-muted-foreground">{group.issueLabel}</span>
                    </div>
                    <span className="tabular text-2xs text-muted-foreground">{group.stories.length} article{group.stories.length === 1 ? "" : "s"}</span>
                  </div>
                  {group.stories.map((story) => (
                    <StoryResult key={story.id} story={story} />
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Search}
              title={isFiltered ? "Nothing matches this search" : "No article in the archive yet"}
              description={isFiltered ? "Try fewer words, a different spelling, or clear a filter. The search covers headlines, standfirsts, article text, people, organisations and Business Deep Dive companies." : "Articles land here as soon as a story is selected and written."}
            />
          )}
        </section>
      </PageBody>
    </>
  );
}
