import { notFound } from "next/navigation";
import Link from "next/link";
import { Bot, Download, FileText, History, ListOrdered, UserRound } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { archiveEditionDetail } from "@/server/archive/read-edition";
import { formatBytes } from "@/server/media/constants";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { DataTable } from "@/components/newsroom/data-table";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { CoverThumbnail } from "@/components/newsroom/cover-thumbnail";
import { CampusChip } from "@/components/newsroom/campus-chip";
import { ArticleStatusBadge, EditionStatusBadge, GenericStatusBadge } from "@/components/newsroom/status-badge";
import { NoAccess } from "@/components/settings/no-access";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { EditionStatus } from "@/lib/editorial/edition-state";
import { storyTypeShort, templateByCode } from "@/lib/constants";
import { enumLabel, formatDate, formatDateTime, formatNumber, relativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ArchiveEditionPage({ params }: { params: Promise<{ editionId: string }> }) {
  const { editionId } = await params;
  const user = await getCurrentUser();
  if (!hasPermission(user, "archive:view")) return <NoAccess title="Archive" permission="archive:view" />;
  if (!UUID.test(editionId)) notFound();
  const detail = await archiveEditionDetail(editionId);
  if (!detail) notFound();
  const { edition, toc, sections, versions, revisions, credited, stats } = detail;
  const published = edition.status === "PUBLISHED" || edition.status === "ARCHIVED";

  return (
    <>
      <PageHeader
        title={edition.title}
        breadcrumbs={[{ label: "Archive", href: "/archive" }, { label: edition.label }]}
        meta={<EditionStatusBadge status={edition.status as EditionStatus} />}
        description={`${edition.issueLabel} · ${stats.articles} articles · ${detail.pageCount ?? edition.targetPageCount} pages · ${formatNumber(stats.words)} words`}
        actions={
          detail.downloads.length ? (
            <>
              {detail.downloads.map((d) => (
                <Button key={d.kind} asChild size="sm" variant="outline">
                  <a href={d.url} download={d.fileName} title={`${d.fileName} · ${formatBytes(d.sizeBytes)}`}>
                    <Download /> {d.kind}
                  </a>
                </Button>
              ))}
            </>
          ) : null
        }
      />
      <PageBody className="space-y-6">
        <section className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
          <div className="rounded-lg border border-border bg-card p-3 shadow-xs">
            <CoverThumbnail url={detail.coverUrl} label={edition.label} issueLabel={edition.issueLabel} headline={edition.coverHeadline} />
            {edition.coverStandfirst ? <p className="mt-2.5 text-2xs leading-relaxed text-muted-foreground">{edition.coverStandfirst}</p> : null}
          </div>
          <div className="space-y-4">
            <StatGrid columns={4}>
              <Stat label="Pages" value={detail.pageCount ?? "—"} hint={`${edition.targetPageCount} targeted`} />
              <Stat label="Articles" value={stats.articles} hint={`${stats.stories} stories · ${sections.length} sections`} />
              <Stat label="Contributors credited" value={credited.length} hint="sourced in at least one article" />
              <Stat label="Media" value={stats.media} hint="assets attached to this issue" />
            </StatGrid>
            <div className="rounded-lg border border-border bg-card p-4 shadow-xs">
              <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
                <div>
                  <dt className="label-caps">Theme</dt>
                  <dd className="mt-0.5 text-[13px]">{edition.tagline ?? edition.coverHeadline ?? <span className="text-muted-foreground italic">No cover theme recorded</span>}</dd>
                </div>
                <div>
                  <dt className="label-caps">{published ? "Published" : "Publication target"}</dt>
                  <dd className="mt-0.5 text-[13px]">{formatDate(published ? edition.publishedAt : edition.publicationTargetAt)}</dd>
                </div>
                <div>
                  <dt className="label-caps">Editor in chief</dt>
                  <dd className="mt-0.5 text-[13px]">{edition.editorInChief ?? "—"}</dd>
                </div>
                <div>
                  <dt className="label-caps">Flatplan</dt>
                  <dd className="mt-0.5 text-[13px]">{detail.planName ? `${detail.planName} · ${toc.length} pages` : "Not planned yet"}</dd>
                </div>
              </dl>
              {edition.editorial ? (
                <div className="mt-4 border-t border-border pt-3">
                  <div className="label-caps mb-1">Editorial</div>
                  <p className="text-[13px] leading-relaxed whitespace-pre-line text-muted-foreground">{edition.editorial}</p>
                </div>
              ) : null}
              {credited.length ? (
                <div className="mt-4 border-t border-border pt-3">
                  <div className="label-caps mb-1.5">Contributors credited</div>
                  <div className="flex flex-wrap items-center gap-1">
                    {credited.map((c) => (
                      <Link key={c.id} href={`/contributors/${c.id}`} title={`${c.articles} article${c.articles === 1 ? "" : "s"}`} className="hover:opacity-80">
                        <CampusChip name={c.name} colour={c.campusColour} size="xs" />
                      </Link>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section>
          <SectionTitle>Table of contents</SectionTitle>
          {toc.length ? (
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <ol className="md:columns-2 md:gap-0 md:[column-rule:1px_solid_var(--border)]">
                {toc.map((entry, i) => (
                  <li key={`${entry.pageNumber}-${i}`} className="flex break-inside-avoid items-center gap-3 border-b border-border px-3 py-1.5 last:border-b-0">
                    <span className="tabular w-7 shrink-0 text-right text-xs font-semibold text-muted-foreground">{entry.pageNumber}</span>
                    <span className="h-5 w-1 shrink-0 rounded-full" style={{ backgroundColor: entry.sectionColour ?? "#9CA3AF" }} aria-hidden />
                    <span className="min-w-0 flex-1">
                      {entry.headline ? (
                        entry.storyId ? (
                          <Link href={`/stories/${entry.storyId}`} className="line-clamp-1 text-[13px] hover:underline">
                            {entry.headline}
                          </Link>
                        ) : (
                          <span className="line-clamp-1 text-[13px]">{entry.headline}</span>
                        )
                      ) : (
                        <span className="text-[13px] text-muted-foreground">{templateByCode(entry.template).name}</span>
                      )}
                      <span className="block truncate text-2xs text-muted-foreground">
                        {entry.sectionName ?? "No section"}
                        {entry.isContinuation ? " · continued" : ""}
                        {entry.extraStories ? ` · +${entry.extraStories} more on this page` : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <EmptyState icon={ListOrdered} title="No flatplan yet" description="The table of contents is generated from the page plan; this issue has not been laid out." compact />
          )}
        </section>

        <section className="space-y-4">
          <SectionTitle>Articles</SectionTitle>
          {sections.length ? (
            sections.map((section) => (
              <div key={section.id}>
                <div className="mb-1.5 flex items-baseline gap-2">
                  <span className="size-2 rounded-full" style={{ backgroundColor: section.colour ?? "#9CA3AF" }} aria-hidden />
                  <h3 className="text-[13px] font-semibold">{section.name}</h3>
                  {section.kicker ? <span className="text-2xs text-muted-foreground">{section.kicker}</span> : null}
                  <span className="tabular ml-auto text-2xs text-muted-foreground">
                    {section.articles.length} article{section.articles.length === 1 ? "" : "s"}
                    {section.targetPages ? ` · ${section.targetPages} pages targeted` : ""}
                  </span>
                </div>
                <DataTable
                  rows={section.articles}
                  rowKey={(a) => a.storyId}
                  onRowHref={(a) => (a.id ? `/articles/${a.id}` : `/stories/${a.storyId}`)}
                  dense
                  columns={[
                    { key: "page", header: "Page", cell: (a) => <span className="tabular text-xs text-muted-foreground">{a.pageNumber ?? "—"}</span>, align: "right", width: "56px" },
                    { key: "headline", header: "Headline", cell: (a) => (
                        <div className="min-w-0">
                          <Link href={a.id ? `/articles/${a.id}` : `/stories/${a.storyId}`} className="line-clamp-1 font-medium hover:underline">
                            {a.headline}
                          </Link>
                          {a.standfirst ? <div className="line-clamp-1 text-2xs text-muted-foreground">{a.standfirst}</div> : null}
                        </div>
                      ) },
                    { key: "type", header: "Type", cell: (a) => <Badge variant="outline">{storyTypeShort(a.storyType)}</Badge> },
                    { key: "byline", header: "Byline", cell: (a) => <span className="text-xs">{a.byline ?? <span className="text-muted-foreground">Newsroom</span>}</span> },
                    { key: "sources", header: "Sources", cell: (a) => <span className="tabular text-xs text-muted-foreground">{a.sources}</span>, align: "right" },
                    { key: "words", header: "Words", cell: (a) => <span className="tabular text-xs text-muted-foreground">{a.wordCount || "—"}</span>, align: "right" },
                    { key: "rev", header: "Rev.", cell: (a) => <span className="tabular text-xs text-muted-foreground">v{a.revision}</span>, align: "right" },
                    { key: "status", header: "Status", cell: (a) => <ArticleStatusBadge status={a.status} /> },
                  ]}
                />
              </div>
            ))
          ) : (
            <EmptyState icon={FileText} title="No article in this issue yet" description="Stories become articles once they are selected and drafted." compact />
          )}
        </section>

        <section>
          <SectionTitle>Version history</SectionTitle>
          <DataTable
            rows={versions}
            rowKey={(v) => v.id}
            dense
            empty={{ title: "No version rendered yet", description: "Each export creates an immutable version with its PDF and Word file.", icon: History }}
            columns={[
              { key: "label", header: "Version", cell: (v) => (
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono text-xs font-medium">{v.label}</span>
                    {v.isImmutable ? <Badge variant="muted">Locked</Badge> : null}
                  </span>
                ) },
              { key: "kind", header: "Kind", cell: (v) => <Badge variant="outline">{enumLabel(v.kind)}</Badge> },
              { key: "status", header: "Status", cell: (v) => <GenericStatusBadge status={v.status} /> },
              { key: "pages", header: "Pages", cell: (v) => <span className="tabular text-xs text-muted-foreground">{v.pageCount ?? "—"}</span>, align: "right" },
              { key: "issues", header: "Issues", cell: (v) => <span className="tabular text-xs text-muted-foreground">{v.issues || "—"}</span>, align: "right" },
              { key: "created", header: "Created", cell: (v) => (
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(v.createdAt)}
                    {v.createdByName ? ` · ${v.createdByName}` : ""}
                  </span>
                ) },
              { key: "files", header: "Files", cell: (v) => (
                  <span className="flex flex-wrap gap-1" data-no-row-link>
                    {v.assets.length ? (
                      v.assets.map((a) => (
                        <Button key={a.id} asChild size="xs" variant="outline">
                          <a href={a.url} download={a.fileName} title={`${a.fileName} · ${formatBytes(a.sizeBytes)}`}>
                            <Download /> {a.kind}
                          </a>
                        </Button>
                      ))
                    ) : (
                      <span className="text-2xs text-muted-foreground">—</span>
                    )}
                  </span>
                ) },
            ]}
          />
        </section>

        <section>
          <SectionTitle>Article revisions</SectionTitle>
          {revisions.length ? (
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <ul className="divide-y divide-border">
                {revisions.map((r) => (
                  <li key={r.id} className="flex items-start gap-3 px-4 py-2">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground" title={r.createdByAi ? "Written by the AI pipeline" : "Edited by a person"}>
                      {r.createdByAi ? <Bot className="size-3" /> : <UserRound className="size-3" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link href={`/articles/${r.articleId}`} className="line-clamp-1 text-[13px] font-medium hover:underline">
                        {r.headline || "(untitled)"}
                      </Link>
                      <p className="truncate text-2xs text-muted-foreground">
                        v{r.version} · {r.changeSummary ?? (r.createdByAi ? "AI draft" : "Edit")} · {r.createdByName ?? (r.createdByAi ? "AI pipeline" : "Unknown")} · {formatNumber(r.wordCount)} words
                      </p>
                    </div>
                    <span className="shrink-0 text-2xs text-muted-foreground" title={formatDateTime(r.createdAt)}>
                      {relativeTime(r.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <EmptyState icon={History} title="No revision recorded" description="Every AI draft and every editorial pass is kept here once articles are written." compact />
          )}
        </section>
      </PageBody>
    </>
  );
}
