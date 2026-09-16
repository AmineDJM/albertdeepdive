import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowUpRight, FileText, Quote as QuoteIcon } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { articleWorkbench } from "@/server/editorial/article-view";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { ArticleEditor } from "@/components/newsroom/article-editor";
import { ArticleStatusBadge } from "@/components/newsroom/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { relativeTime, truncate } from "@/lib/utils";
import { storyTypeLabel } from "@/lib/constants";

export const dynamic = "force-dynamic";

const ROLE_LABELS: Record<string, string> = { PRIMARY: "Lead source", SUPPORTING: "Supporting", PHOTO: "Photo", EXTERNAL: "External" };

export default async function ArticlePage({ params }: { params: Promise<{ articleId: string }> }) {
  const { articleId } = await params;
  const user = await getCurrentUser();
  const data = await articleWorkbench(articleId).catch(() => null);
  if (!data) notFound();
  const { article, story, edition, sources, revisions, comments, facts, quotes, disputedFacts } = data;
  const canEdit = hasPermission(user, "article:edit");
  const canApprove = hasPermission(user, "article:approve");

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: edition.label, href: `/editions/${edition.id}` },
          { label: "Stories", href: `/editions/${edition.id}/stories` },
          { label: truncate(story.title, 34), href: `/stories/${story.id}` },
          { label: "Editor" },
        ]}
        title={article.headline || story.title}
        meta={
          <>
            <ArticleStatusBadge status={article.status} />
            <Badge variant="outline">{storyTypeLabel(story.storyType)}</Badge>
            {story.isCover ? <Badge variant="brand">Cover</Badge> : null}
            {article.language !== "en" ? <Badge variant="outline">{article.language.toUpperCase()}</Badge> : null}
          </>
        }
        description={`${story.section?.name ?? "Unassigned section"} · ${article.wordCount} words · revision ${article.currentRevision} · ${sources.length} source${sources.length === 1 ? "" : "s"}`}
        actions={
          <Button size="sm" variant="outline" asChild>
            <Link href={`/stories/${story.id}`}>
              Story file <ArrowUpRight />
            </Link>
          </Button>
        }
      />

      <PageBody className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <ArticleEditor
          article={{
            id: article.id,
            storyId: article.storyId,
            editionId: article.editionId,
            kicker: article.kicker,
            headline: article.headline,
            standfirst: article.standfirst,
            byline: article.byline,
            body: article.body,
            status: article.status,
            wordCount: article.wordCount,
            currentRevision: article.currentRevision,
            headlineAlternatives: article.headlineAlternatives,
            warnings: article.warnings,
            manualEditRatio: article.manualEditRatio,
            lastEditedAt: article.lastEditedAt,
            approvedAt: article.approvedAt,
          }}
          story={{ id: story.id, title: story.title, status: story.status, sectionName: story.section?.name ?? null, editionLabel: edition.label }}
          revisions={revisions}
          comments={comments}
          canEdit={canEdit}
          canApprove={canApprove}
        />

        <aside className="space-y-5">
          <section>
            <SectionTitle>Sources behind this article</SectionTitle>
            <ul className="space-y-2">
              {sources.map((s) => (
                <li key={s.id} className="rounded-md border border-border p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/editions/${edition.id}/inbox?submission=${s.id}`} className="text-xs font-medium hover:underline">
                      {s.title}
                    </Link>
                    <Badge variant={s.role === "PRIMARY" ? "brand" : "outline"} className="shrink-0">
                      {ROLE_LABELS[s.role] ?? s.role}
                    </Badge>
                  </div>
                  <p className="mt-1 text-2xs text-muted-foreground">
                    {s.contributorName ?? "Unknown contributor"} · {storyTypeLabel(s.storyType)} · {relativeTime(s.createdAt)}
                  </p>
                  {s.excerpt ? <p className="mt-1.5 text-2xs leading-relaxed text-muted-foreground">{s.excerpt}</p> : null}
                </li>
              ))}
              {!sources.length ? <li className="rounded-md border border-dashed border-border p-3 text-2xs text-muted-foreground">No submission is linked to this draft yet.</li> : null}
            </ul>
          </section>

          <section>
            <SectionTitle>
              Fact sheet
              {disputedFacts ? <span className="ml-1.5 text-warning">{disputedFacts} disputed</span> : null}
            </SectionTitle>
            {disputedFacts ? (
              <p className="mb-2 flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning-soft/50 p-2 text-2xs">
                <AlertTriangle className="mt-px size-3 shrink-0 text-warning" />
                <span>
                  Unresolved conflicts block export.{" "}
                  <Link href={`/stories/${story.id}`} className="underline">
                    Resolve them on the story file
                  </Link>
                  .
                </span>
              </p>
            ) : null}
            <ul className="space-y-1">
              {facts.slice(0, 14).map((f) => (
                <li key={f.id} className="flex items-start gap-1.5 text-2xs leading-relaxed">
                  <FileText className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                  <span className={f.status === "DISPUTED" ? "text-warning" : f.status === "REJECTED" ? "text-muted-foreground line-through" : undefined}>{f.statement}</span>
                </li>
              ))}
              {!facts.length ? <li className="text-2xs text-muted-foreground">No facts extracted yet.</li> : null}
            </ul>
            {facts.length > 14 ? (
              <Link href={`/stories/${story.id}`} className="mt-1.5 inline-block text-2xs text-muted-foreground underline">
                {facts.length - 14} more on the story file
              </Link>
            ) : null}
          </section>

          <section>
            <SectionTitle>Verbatim quotes</SectionTitle>
            <ul className="space-y-2">
              {quotes.slice(0, 6).map((q) => (
                <li key={q.id} className="rounded-md border border-border p-2.5">
                  <p className="flex items-start gap-1.5 text-2xs italic leading-relaxed">
                    <QuoteIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                    <span>{q.text}</span>
                  </p>
                  {q.speakerName ? <p className="mt-1 text-2xs text-muted-foreground">— {q.speakerName}{q.speakerRole ? `, ${q.speakerRole}` : ""}</p> : null}
                </li>
              ))}
              {!quotes.length ? <li className="text-2xs text-muted-foreground">No quotes captured for this story.</li> : null}
            </ul>
          </section>
        </aside>
      </PageBody>
    </>
  );
}
